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
} from "./types.js";
import { SCHEMA_VERSION } from "./types.js";
import { detectPauses } from "./detect.js";

/** Ignore cuts that would remove less than this (imperceptible, adds noise). */
const MIN_REMOVE_SEC = 0.05;
/** A pause starting/ending within this of the timeline edge counts as head/tail. */
const EDGE_EPS = 0.02;

interface GapKeep {
  keepAfter: number;
  keepBefore: number;
}

function splitGap(params: AnalysisParams): GapKeep {
  const { targetGap, padAfter, padBefore } = params;
  const padSum = padAfter + padBefore;
  // If pads don't fit into targetGap, scale them down proportionally.
  const effAfter = padSum > targetGap && padSum > 0 ? (padAfter * targetGap) / padSum : padAfter;
  const effBefore = padSum > targetGap && padSum > 0 ? (padBefore * targetGap) / padSum : padBefore;
  const spare = Math.max(0, targetGap - effAfter - effBefore);
  return { keepAfter: effAfter + spare / 2, keepBefore: effBefore + spare / 2 };
}

/** Build cuts from detected pauses. */
export function buildCuts(pauses: Pause[], params: AnalysisParams, durationSec: number): Cut[] {
  const { keepAfter, keepBefore } = splitGap(params);
  const cuts: Cut[] = [];
  let id = 1;

  for (const pause of pauses) {
    const atHead = pause.start <= EDGE_EPS;
    const atTail = pause.end >= durationSec - EDGE_EPS;
    if (atHead && atTail) continue; // whole file is silence; nothing sensible to keep

    let removeStart: number;
    let removeEnd: number;
    if (atHead) {
      // Head silence: keep only the lead-in before the first speech.
      removeStart = 0;
      removeEnd = pause.end - keepBefore;
    } else if (atTail) {
      // Tail silence: keep only the tail-out after the last speech.
      removeStart = pause.start + keepAfter;
      removeEnd = durationSec;
    } else {
      if (pause.end - pause.start <= params.targetGap) continue;
      removeStart = pause.start + keepAfter;
      removeEnd = pause.end - keepBefore;
    }

    const removed = removeEnd - removeStart;
    if (removed < MIN_REMOVE_SEC) continue;

    cuts.push({
      id: id++,
      pause: [round3(pause.start), round3(pause.end)],
      remove: [round3(removeStart), round3(removeEnd)],
      removedDuration: round3(removed),
      enabled: true,
    });
  }
  return cuts;
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
  generator = "roughcut@0.1.0",
): CutPlan {
  // Timeline authority is the container duration; fall back to decoded audio.
  const durationSec = input.durationSec > 0 ? input.durationSec : analysis.durationSec;
  const pauses = detectPauses(analysis, {
    thresholdDb: params.thresholdDb,
    minSilence: params.minSilence,
  });
  const cuts = buildCuts(pauses, params, durationSec);
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
  };
}

/** Return a new plan with one cut toggled, keepSegments/stats recomputed. */
export function withCutEnabled(plan: CutPlan, cutId: number, enabled: boolean): CutPlan {
  const cuts = plan.cuts.map((c) => (c.id === cutId ? { ...c, enabled } : c));
  const durationSec = plan.stats.originalDuration;
  const keepSegments = computeKeepSegments(cuts, durationSec);
  return { ...plan, cuts, keepSegments, stats: computeStats(cuts, keepSegments, durationSec) };
}

/**
 * Recompute derived fields (keepSegments, stats) from cuts. Cuts are the
 * source of truth; a hand-edited plan only needs `enabled` flags changed.
 */
export function normalizePlan(plan: CutPlan): CutPlan {
  const durationSec =
    plan.input.durationSec > 0 ? plan.input.durationSec : plan.stats.originalDuration;
  const keepSegments = computeKeepSegments(plan.cuts, durationSec);
  return { ...plan, keepSegments, stats: computeStats(plan.cuts, keepSegments, durationSec) };
}

/** Validate a plan loaded from JSON (CLI --plan / GUI open). */
export function assertPlan(value: unknown): CutPlan {
  const plan = value as CutPlan;
  if (!plan || typeof plan !== "object") throw new Error("Plan is not an object");
  if (plan.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported plan schemaVersion ${String(plan.schemaVersion)} (expected ${SCHEMA_VERSION})`,
    );
  }
  if (!Array.isArray(plan.cuts) || !Array.isArray(plan.keepSegments)) {
    throw new Error("Plan is missing cuts/keepSegments arrays");
  }
  return plan;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
