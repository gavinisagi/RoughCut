/**
 * Pause list -> CutPlan. Pure functions (contract: no IO, times in seconds).
 *
 * Semantics (see docs/DESIGN.md):
 * - After cutting, each pause lasts exactly targetGap seconds.
 * - Of that gap, at least padAfter hugs the previous speech tail and at least
 *   padBefore hugs the next speech onset; leftover is split evenly.
 * - Kept gap audio comes from the original noise floor on both sides of the
 *   removed interval (never inserted digital silence).
 */
import type {
  AnalysisParams,
  AudioAnalysis,
  Cut,
  CutPlan,
  MediaInfo,
  Pause,
  PlanStats,
  SpeechSegment,
  Transcript,
} from "./types.js";
import { SCHEMA_VERSION } from "./types.js";
import { detectPauses } from "./detect.js";

/** Ignore pause cuts that would remove less than this (imperceptible). */
const MIN_REMOVE_SEC = 0.05;
/** Segment cuts are user-ordered removals; only skip truly degenerate ones. */
const MIN_SEGMENT_REMOVE_SEC = 0.01;
/** A pause starting/ending within this of the timeline edge counts as head/tail. */
const EDGE_EPS = 0.02;
/** Intervals closer than this are merged when building virtual pauses. */
const TOUCH_EPS = 1e-4;

interface GapKeep {
  keepAfter: number;
  keepBefore: number;
}

function splitGap(params: AnalysisParams, targetGapOverride?: number): GapKeep {
  const targetGap = targetGapOverride ?? params.targetGap;
  const { padAfter, padBefore } = params;
  const padSum = padAfter + padBefore;
  // If pads don't fit into targetGap, scale them down proportionally.
  const effAfter = padSum > targetGap && padSum > 0 ? (padAfter * targetGap) / padSum : padAfter;
  const effBefore = padSum > targetGap && padSum > 0 ? (padBefore * targetGap) / padSum : padBefore;
  const spare = Math.max(0, targetGap - effAfter - effBefore);
  return { keepAfter: effAfter + spare / 2, keepBefore: effBefore + spare / 2 };
}

/** A pause interval, possibly containing dropped speech segments. */
interface VirtualPause extends Pause {
  segmentIds: number[];
  /** Length of true silence at the interval's start/end (kept audio must be
   * room tone, never dropped speech — invariant 3). */
  leadGap: number;
  trailGap: number;
}

function cutFromVirtualPause(
  vp: VirtualPause,
  params: AnalysisParams,
  durationSec: number,
): Omit<Cut, "id"> | null {
  const isSegment = vp.segmentIds.length > 0;
  const atHead = vp.start <= EDGE_EPS;
  const atTail = vp.end >= durationSec - EDGE_EPS;
  if (atHead && atTail) return null; // nothing sensible to keep

  const gap = vp.end - vp.start;
  // Segment removals must execute even when the merged interval is short:
  // compress the effective gap so half of it survives as room tone.
  const effTarget =
    isSegment && gap <= params.targetGap ? Math.max(gap * 0.5, 0.02) : undefined;
  const split = splitGap(params, effTarget);
  // Kept audio may only come from silence, never from a dropped segment.
  const keepAfter = Math.min(split.keepAfter, vp.leadGap);
  const keepBefore = Math.min(split.keepBefore, vp.trailGap);

  let removeStart: number;
  let removeEnd: number;
  if (atHead) {
    removeStart = 0;
    removeEnd = vp.end - keepBefore;
  } else if (atTail) {
    removeStart = vp.start + keepAfter;
    removeEnd = durationSec;
  } else {
    if (!isSegment && gap <= params.targetGap) return null;
    removeStart = vp.start + keepAfter;
    removeEnd = vp.end - keepBefore;
  }

  const removed = removeEnd - removeStart;
  if (removed < (isSegment ? MIN_SEGMENT_REMOVE_SEC : MIN_REMOVE_SEC)) return null;

  return {
    kind: isSegment ? "segment" : "pause",
    pause: [round3(vp.start), round3(vp.end)],
    remove: [round3(removeStart), round3(removeEnd)],
    removedDuration: round3(removed),
    enabled: true,
    ...(isSegment ? { segmentIds: [...vp.segmentIds] } : {}),
  };
}

function cutsFromVirtualPauses(
  virtualPauses: VirtualPause[],
  params: AnalysisParams,
  durationSec: number,
): Cut[] {
  const cuts: Cut[] = [];
  let id = 1;
  for (const vp of virtualPauses) {
    const cut = cutFromVirtualPause(vp, params, durationSec);
    if (cut) cuts.push({ id: id++, ...cut });
  }
  return cuts;
}

/** Build cuts from detected pauses (v1 path, no transcript). */
export function buildCuts(pauses: Pause[], params: AnalysisParams, durationSec: number): Cut[] {
  return cutsFromVirtualPauses(
    // A plain pause is silence end to end.
    pauses.map((p) => ({
      ...p,
      segmentIds: [],
      leadGap: p.end - p.start,
      trailGap: p.end - p.start,
    })),
    params,
    durationSec,
  );
}

/** Speech segments = complement of detected pauses over [0, duration]. */
export function extractSpeechSegments(pauses: Pause[], durationSec: number): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  let cursor = 0;
  let id = 1;
  const push = (start: number, end: number) => {
    if (end - start > TOUCH_EPS) {
      segments.push({ id: id++, start: round3(start), end: round3(end), text: null, dropped: false });
    }
  };
  for (const p of pauses) {
    push(cursor, p.start);
    cursor = Math.max(cursor, p.end);
  }
  push(cursor, durationSec);
  return segments;
}

/**
 * Merge inter-segment gaps (pauses of any length) with dropped segments into
 * virtual pauses. Consecutive dropped segments and the pauses between them
 * collapse into one interval carrying all their segment ids.
 */
export function mergeDroppedSegments(
  segments: SpeechSegment[],
  durationSec: number,
): VirtualPause[] {
  interface Item {
    start: number;
    end: number;
    segmentIds: number[];
  }
  const items: Item[] = [];
  // Gaps around/between segments are pause material (including sub-minSilence
  // gaps: they matter when a neighbour segment is dropped).
  let cursor = 0;
  for (const seg of segments) {
    if (seg.start - cursor > TOUCH_EPS) {
      items.push({ start: cursor, end: seg.start, segmentIds: [] });
    }
    if (seg.dropped) {
      items.push({ start: seg.start, end: seg.end, segmentIds: [seg.id] });
    }
    cursor = Math.max(cursor, seg.end);
  }
  if (durationSec - cursor > TOUCH_EPS) {
    items.push({ start: cursor, end: durationSec, segmentIds: [] });
  }

  items.sort((a, b) => a.start - b.start);
  const merged: VirtualPause[] = [];
  for (const item of items) {
    const isGap = item.segmentIds.length === 0;
    const len = item.end - item.start;
    const last = merged[merged.length - 1];
    if (last && item.start <= last.end + TOUCH_EPS) {
      last.end = Math.max(last.end, item.end);
      last.segmentIds.push(...item.segmentIds);
      // The chain's trailing-silence length is set by its final element.
      last.trailGap = isGap ? len : 0;
    } else {
      merged.push({
        start: item.start,
        end: item.end,
        segmentIds: [...item.segmentIds],
        leadGap: isGap ? len : 0,
        trailGap: isGap ? len : 0,
      });
    }
  }
  return merged;
}

/** Build cuts from a transcript's segments (v2 path; honors dropped flags). */
export function buildCutsFromSegments(
  segments: SpeechSegment[],
  params: AnalysisParams,
  durationSec: number,
): Cut[] {
  return cutsFromVirtualPauses(mergeDroppedSegments(segments, durationSec), params, durationSec);
}

/** Complement of enabled removed intervals over [0, durationSec]. */
export function computeKeepSegments(cuts: Cut[], durationSec: number): [number, number][] {
  const removes = cuts
    .filter((c) => c.enabled)
    .map((c) => c.remove)
    .sort((a, b) => a[0] - b[0]);

  const keep: [number, number][] = [];
  let cursor = 0;
  for (const [rs, re] of removes) {
    const s = Math.max(0, Math.min(rs, durationSec));
    const e = Math.max(0, Math.min(re, durationSec));
    if (s > cursor + 1e-4) keep.push([round3(cursor), round3(s)]);
    cursor = Math.max(cursor, e);
  }
  if (durationSec > cursor + 1e-4) keep.push([round3(cursor), round3(durationSec)]);
  return keep;
}

export function computeStats(
  cuts: Cut[],
  keepSegments: [number, number][],
  durationSec: number,
): PlanStats {
  const outputDuration = keepSegments.reduce((acc, [s, e]) => acc + (e - s), 0);
  return {
    originalDuration: round3(durationSec),
    outputDuration: round3(outputDuration),
    removedDuration: round3(durationSec - outputDuration),
    cutCount: cuts.filter((c) => c.enabled).length,
    totalCuts: cuts.length,
  };
}

/** Full pipeline: analysis frames + params -> CutPlan. */
export function buildPlan(
  input: MediaInfo,
  analysis: AudioAnalysis,
  params: AnalysisParams,
  generator = "roughcut@0.2.0",
  transcript?: Transcript,
): CutPlan {
  // Timeline authority is the container duration; fall back to decoded audio.
  const durationSec = input.durationSec > 0 ? input.durationSec : analysis.durationSec;
  const pauses = detectPauses(analysis, {
    thresholdDb: params.thresholdDb,
    minSilence: params.minSilence,
  });
  const cuts = transcript
    ? buildCutsFromSegments(transcript.segments, params, durationSec)
    : buildCuts(pauses, params, durationSec);
  const keepSegments = computeKeepSegments(cuts, durationSec);
  return {
    schemaVersion: SCHEMA_VERSION,
    generator,
    createdAt: new Date().toISOString(),
    input,
    params,
    cuts,
    keepSegments,
    stats: computeStats(cuts, keepSegments, durationSec),
    ...(transcript ? { transcript } : {}),
  };
}

/**
 * Rebuild cuts/keepSegments/stats from the transcript's dropped flags.
 * Pause-kind cuts inherit `enabled` from the previous plan by matching their
 * pause interval; segment-kind cuts always execute.
 */
export function rebuildPlanFromTranscript(plan: CutPlan): CutPlan {
  if (!plan.transcript) return normalizePlan(plan);
  const durationSec =
    plan.input.durationSec > 0 ? plan.input.durationSec : plan.stats.originalDuration;
  const cuts = buildCutsFromSegments(plan.transcript.segments, plan.params, durationSec);
  for (const cut of cuts) {
    if (cut.kind !== "pause") continue;
    const old = plan.cuts.find(
      (o) =>
        o.kind === "pause" &&
        Math.abs(o.pause[0] - cut.pause[0]) < 0.005 &&
        Math.abs(o.pause[1] - cut.pause[1]) < 0.005,
    );
    if (old) cut.enabled = old.enabled;
  }
  const keepSegments = computeKeepSegments(cuts, durationSec);
  return { ...plan, cuts, keepSegments, stats: computeStats(cuts, keepSegments, durationSec) };
}

/** Toggle one speech segment's dropped flag and rebuild the plan. */
export function withSegmentDropped(plan: CutPlan, segmentId: number, dropped: boolean): CutPlan {
  if (!plan.transcript) return plan;
  const transcript: Transcript = {
    ...plan.transcript,
    segments: plan.transcript.segments.map((s) =>
      s.id === segmentId ? { ...s, dropped } : s,
    ),
  };
  return rebuildPlanFromTranscript({ ...plan, transcript });
}

/** Attach a transcript to a plan and rebuild derived fields. */
export function withTranscript(plan: CutPlan, transcript: Transcript): CutPlan {
  return rebuildPlanFromTranscript({ ...plan, transcript });
}

/** Return a new plan with one cut toggled, keepSegments/stats recomputed. */
export function withCutEnabled(plan: CutPlan, cutId: number, enabled: boolean): CutPlan {
  const cuts = plan.cuts.map((c) => (c.id === cutId ? { ...c, enabled } : c));
  const durationSec = plan.stats.originalDuration;
  const keepSegments = computeKeepSegments(cuts, durationSec);
  return { ...plan, cuts, keepSegments, stats: computeStats(cuts, keepSegments, durationSec) };
}

/**
 * Recompute derived fields from the sources of truth: transcript dropped
 * flags (when present) rebuild the cuts; cuts' enabled flags always apply.
 * A hand-edited plan only needs `enabled`/`dropped` flags changed.
 */
export function normalizePlan(plan: CutPlan): CutPlan {
  if (plan.transcript) return rebuildPlanFromTranscript(plan);
  const durationSec =
    plan.input.durationSec > 0 ? plan.input.durationSec : plan.stats.originalDuration;
  const keepSegments = computeKeepSegments(plan.cuts, durationSec);
  return { ...plan, keepSegments, stats: computeStats(plan.cuts, keepSegments, durationSec) };
}

/**
 * Validate a plan loaded from JSON (CLI --plan / GUI open).
 * v1 plans are migrated in place: cuts gain kind:"pause"; output is always v2.
 */
export function assertPlan(value: unknown): CutPlan {
  const plan = value as CutPlan;
  if (!plan || typeof plan !== "object") throw new Error("Plan is not an object");
  if (plan.schemaVersion !== SCHEMA_VERSION && plan.schemaVersion !== 1) {
    throw new Error(
      `Unsupported plan schemaVersion ${String(plan.schemaVersion)} (expected 1 or ${SCHEMA_VERSION})`,
    );
  }
  if (!Array.isArray(plan.cuts) || !Array.isArray(plan.keepSegments)) {
    throw new Error("Plan is missing cuts/keepSegments arrays");
  }
  if (plan.schemaVersion === 1) {
    return {
      ...plan,
      schemaVersion: SCHEMA_VERSION,
      cuts: plan.cuts.map((c) => ({ ...c, kind: c.kind ?? "pause" })),
    };
  }
  return plan;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
