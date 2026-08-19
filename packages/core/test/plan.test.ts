import { describe, expect, it } from "vitest";
import {
  buildCuts,
  buildCutsFromSegments,
  computeKeepSegments,
  computeStats,
  extractSpeechSegments,
  withCutEnabled,
  withSegmentDropped,
  withTranscript,
  assertPlan,
} from "../src/plan.js";
import { buildFilterScript } from "../src/export.js";
import type { AnalysisParams, Cut, CutPlan, Pause, SpeechSegment } from "../src/types.js";
import { DEFAULT_PARAMS, SCHEMA_VERSION } from "../src/types.js";

const P: AnalysisParams = { ...DEFAULT_PARAMS }; // gap .3, minSil .45, -38dB, padB .06, padA .15

describe("buildCuts interior pauses", () => {
  it("shrinks a long pause to exactly targetGap with pad split", () => {
    // spare = .3 - .15 - .06 = .09 -> keepAfter = .195, keepBefore = .105
    const cuts = buildCuts([{ start: 10, end: 11.63 }], P, 60);
    expect(cuts).toHaveLength(1);
    const c = cuts[0];
    expect(c.remove[0]).toBeCloseTo(10.195, 3);
    expect(c.remove[1]).toBeCloseTo(11.525, 3);
    expect(c.removedDuration).toBeCloseTo(1.33, 3);
    // Post-cut gap = pause length - removed = targetGap.
    expect(11.63 - 10 - c.removedDuration).toBeCloseTo(P.targetGap, 3);
  });

  it("leaves pauses at or below targetGap alone", () => {
    expect(buildCuts([{ start: 10, end: 10.29 }], P, 60)).toHaveLength(0);
    expect(buildCuts([{ start: 10, end: 10.3 }], P, 60)).toHaveLength(0);
  });

  it("drops imperceptible removals (< 50ms)", () => {
    expect(buildCuts([{ start: 10, end: 10.34 }], P, 60)).toHaveLength(0);
  });

  it("scales pads proportionally when they exceed targetGap", () => {
    const tight: AnalysisParams = { ...P, targetGap: 0.15 };
    const cuts = buildCuts([{ start: 10, end: 12 }], tight, 60);
    expect(cuts).toHaveLength(1);
    const kept = 2 - cuts[0].removedDuration;
    expect(kept).toBeCloseTo(0.15, 3);
    // padAfter share: .15/.21 * .15 ≈ .1071 kept after speech tail
    expect(cuts[0].remove[0] - 10).toBeCloseTo((0.15 * 0.15) / 0.21, 3);
  });
});

describe("buildCuts edges", () => {
  it("trims head silence keeping only the lead-in", () => {
    const cuts = buildCuts([{ start: 0, end: 2 }], P, 60);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].remove[0]).toBe(0);
    // keepBefore = .105
    expect(cuts[0].remove[1]).toBeCloseTo(2 - 0.105, 3);
  });

  it("trims tail silence keeping only the tail-out", () => {
    const cuts = buildCuts([{ start: 55, end: 60 }], P, 60);
    expect(cuts).toHaveLength(1);
    // keepAfter = .195
    expect(cuts[0].remove[0]).toBeCloseTo(55.195, 3);
    expect(cuts[0].remove[1]).toBe(60);
  });

  it("skips an all-silence file entirely", () => {
    expect(buildCuts([{ start: 0, end: 60 }], P, 60)).toHaveLength(0);
  });
});

describe("keepSegments and stats", () => {
  const cuts: Cut[] = [
    { id: 1, kind: "pause", pause: [10, 12], remove: [10.2, 11.9], removedDuration: 1.7, enabled: true },
    { id: 2, kind: "pause", pause: [20, 22], remove: [20.2, 21.9], removedDuration: 1.7, enabled: true },
  ];

  it("computes the complement of enabled cuts", () => {
    const keep = computeKeepSegments(cuts, 30);
    expect(keep).toEqual([
      [0, 10.2],
      [11.9, 20.2],
      [21.9, 30],
    ]);
  });

  it("honors disabled cuts", () => {
    const one = cuts.map((c) => (c.id === 2 ? { ...c, enabled: false } : c));
    const keep = computeKeepSegments(one, 30);
    expect(keep).toEqual([
      [0, 10.2],
      [11.9, 30],
    ]);
  });

  it("stats add up", () => {
    const keep = computeKeepSegments(cuts, 30);
    const stats = computeStats(cuts, keep, 30);
    expect(stats.outputDuration).toBeCloseTo(30 - 3.4, 3);
    expect(stats.removedDuration).toBeCloseTo(3.4, 3);
    expect(stats.cutCount).toBe(2);
  });

  it("withCutEnabled recomputes downstream fields", () => {
    const plan: CutPlan = {
      schemaVersion: SCHEMA_VERSION,
      generator: "test",
      createdAt: "now",
      input: {
        path: "x", format: "mp4", durationSec: 30, sizeBytes: 0, video: null,
        audio: { codec: "aac", sampleRate: 48000, channels: 1 },
      },
      params: P,
      cuts,
      keepSegments: computeKeepSegments(cuts, 30),
      stats: computeStats(cuts, computeKeepSegments(cuts, 30), 30),
    };
    const toggled = withCutEnabled(plan, 1, false);
    expect(toggled.cuts.find((c) => c.id === 1)?.enabled).toBe(false);
    expect(toggled.stats.cutCount).toBe(1);
    expect(toggled.stats.removedDuration).toBeCloseTo(1.7, 3);
    // Original plan untouched (immutability).
    expect(plan.cuts.find((c) => c.id === 1)?.enabled).toBe(true);
  });
});

describe("assertPlan", () => {
  it("rejects wrong schemaVersion", () => {
    expect(() => assertPlan({ schemaVersion: 999, cuts: [], keepSegments: [] })).toThrow(
      /schemaVersion/,
    );
  });

  it("migrates v1 plans: kind backfilled, version bumped", () => {
    const v1 = {
      schemaVersion: 1,
      cuts: [{ id: 1, pause: [2, 3.5], remove: [2.2, 3.4], removedDuration: 1.2, enabled: false }],
      keepSegments: [[0, 2.2]],
    };
    const plan = assertPlan(v1);
    expect(plan.schemaVersion).toBe(SCHEMA_VERSION);
    expect(plan.cuts[0].kind).toBe("pause");
    expect(plan.cuts[0].enabled).toBe(false);
  });
});

describe("speech segments and dropped-segment merging (v2)", () => {
  // Timeline: speech 0-2, pause 2-3.5, speech 3.5-5.5, pause 5.5-6.3, speech 6.3-8.3.
  const DUR = 8.3;
  const pauses: Pause[] = [
    { start: 2, end: 3.5 },
    { start: 5.5, end: 6.3 },
  ];
  const baseSegments = (): SpeechSegment[] => extractSpeechSegments(pauses, DUR);

  it("extractSpeechSegments is the pause complement", () => {
    const segs = baseSegments();
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [0, 2],
      [3.5, 5.5],
      [6.3, 8.3],
    ]);
    expect(segs.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("with nothing dropped, the segment path matches the pause path exactly", () => {
    expect(buildCutsFromSegments(baseSegments(), P, DUR)).toEqual(buildCuts(pauses, P, DUR));
  });

  it("dropping the middle segment merges both pauses into one segment cut", () => {
    const segs = baseSegments().map((s) => (s.id === 2 ? { ...s, dropped: true } : s));
    const cuts = buildCutsFromSegments(segs, P, DUR);
    expect(cuts).toHaveLength(1);
    const c = cuts[0];
    expect(c.kind).toBe("segment");
    expect(c.segmentIds).toEqual([2]);
    expect(c.pause).toEqual([2, 6.3]);
    // keepAfter .195 / keepBefore .105 -> post-cut gap is exactly targetGap.
    expect(c.remove[0]).toBeCloseTo(2.195, 3);
    expect(c.remove[1]).toBeCloseTo(6.195, 3);
    expect(6.3 - 2 - c.removedDuration).toBeCloseTo(P.targetGap, 3);
  });

  it("dropping the first segment merges with the head", () => {
    const segs = baseSegments().map((s) => (s.id === 1 ? { ...s, dropped: true } : s));
    const cuts = buildCutsFromSegments(segs, P, DUR);
    expect(cuts).toHaveLength(2);
    expect(cuts[0].kind).toBe("segment");
    expect(cuts[0].remove[0]).toBe(0);
    expect(cuts[0].remove[1]).toBeCloseTo(3.5 - 0.105, 3);
    expect(cuts[1].kind).toBe("pause");
  });

  it("dropping the last segment merges to the tail", () => {
    const segs = baseSegments().map((s) => (s.id === 3 ? { ...s, dropped: true } : s));
    const cuts = buildCutsFromSegments(segs, P, DUR);
    expect(cuts).toHaveLength(2);
    const tail = cuts[1];
    expect(tail.kind).toBe("segment");
    expect(tail.remove[0]).toBeCloseTo(5.695, 3);
    expect(tail.remove[1]).toBe(DUR);
  });

  it("consecutive dropped segments collapse with everything between them", () => {
    const segs = baseSegments().map((s) => (s.id >= 2 ? { ...s, dropped: true } : s));
    const cuts = buildCutsFromSegments(segs, P, DUR);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].kind).toBe("segment");
    expect(cuts[0].segmentIds).toEqual([2, 3]);
    expect(cuts[0].pause).toEqual([2, 8.3]);
    expect(cuts[0].remove[0]).toBeCloseTo(2.195, 3);
    expect(cuts[0].remove[1]).toBe(DUR);
  });

  it("short merged intervals still cut, keeping only true silence", () => {
    const segs: SpeechSegment[] = [
      { id: 1, start: 0, end: 1, text: null, dropped: false },
      { id: 2, start: 1.05, end: 1.15, text: null, dropped: true },
      { id: 3, start: 1.2, end: 3, text: null, dropped: false },
    ];
    const cuts = buildCutsFromSegments(segs, P, 3);
    expect(cuts).toHaveLength(1);
    const c = cuts[0];
    expect(c.kind).toBe("segment");
    // Kept lead is clamped to the 0.05s of real silence before the segment,
    // so the removal starts exactly where the dropped speech starts.
    expect(c.remove[0]).toBeCloseTo(1.05, 3);
    // The dropped speech interval is fully inside the removal.
    expect(c.remove[1]).toBeGreaterThanOrEqual(1.15);
  });

  it("withSegmentDropped rebuilds and preserves a disabled pause cut", () => {
    const segs = baseSegments();
    const cuts = buildCutsFromSegments(segs, P, DUR);
    const keep = computeKeepSegments(cuts, DUR);
    let plan: CutPlan = {
      schemaVersion: SCHEMA_VERSION,
      generator: "test",
      createdAt: "now",
      input: {
        path: "x", format: "mp4", durationSec: DUR, sizeBytes: 0, video: null,
        audio: { codec: "aac", sampleRate: 48000, channels: 1 },
      },
      params: P,
      cuts,
      keepSegments: keep,
      stats: computeStats(cuts, keep, DUR),
      transcript: { engine: "test", reviewedBy: null, segments: segs },
    };
    // User vetoes the first pause cut (2-3.5), then drops the last segment.
    plan = withCutEnabled(plan, plan.cuts[0].id, false);
    const next = withSegmentDropped(plan, 3, true);
    const pauseCut = next.cuts.find((c) => c.kind === "pause" && c.pause[0] === 2);
    expect(pauseCut?.enabled).toBe(false);
    const segCut = next.cuts.find((c) => c.kind === "segment");
    expect(segCut?.segmentIds).toEqual([3]);
    // Un-drop restores the original two-pause layout.
    const restored = withSegmentDropped(next, 3, false);
    expect(restored.cuts.filter((c) => c.kind === "segment")).toHaveLength(0);
    expect(restored.cuts.find((c) => c.pause[0] === 2)?.enabled).toBe(false);
  });

  it("withTranscript attaches and recomputes", () => {
    const segs = baseSegments().map((s) => (s.id === 2 ? { ...s, dropped: true } : s));
    const cuts = buildCuts(pauses, P, DUR);
    const keep = computeKeepSegments(cuts, DUR);
    const plan: CutPlan = {
      schemaVersion: SCHEMA_VERSION,
      generator: "test",
      createdAt: "now",
      input: {
        path: "x", format: "mp4", durationSec: DUR, sizeBytes: 0, video: null,
        audio: { codec: "aac", sampleRate: 48000, channels: 1 },
      },
      params: P,
      cuts,
      keepSegments: keep,
      stats: computeStats(cuts, keep, DUR),
    };
    const withT = withTranscript(plan, { engine: "test", reviewedBy: null, segments: segs });
    expect(withT.cuts.some((c) => c.kind === "segment")).toBe(true);
    expect(withT.stats.outputDuration).toBeCloseTo(DUR - 4.0, 2);
  });
});

describe("buildFilterScript", () => {
  it("emits trim/atrim chains and concat for A/V", () => {
    const script = buildFilterScript(
      [
        [0, 10.2],
        [11.9, 30],
      ],
      { video: true, audio: true },
    );
    expect(script).toContain("[0:v]trim=start=0.000:end=10.200,setpts=PTS-STARTPTS[v0]");
    expect(script).toContain("[0:a]atrim=start=11.900:end=30.000,asetpts=PTS-STARTPTS[a1]");
    expect(script).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]");
  });

  it("supports audio-only graphs", () => {
    const script = buildFilterScript([[0, 5]], { video: false, audio: true });
    expect(script).toContain("concat=n=1:v=0:a=1[aout]");
    expect(script).not.toContain("[0:v]");
  });

  it("rejects empty keep lists", () => {
    expect(() => buildFilterScript([], { video: true, audio: true })).toThrow(/empty/);
  });
});
