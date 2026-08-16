import { describe, expect, it } from "vitest";
import {
  buildCuts,
  computeKeepSegments,
  computeStats,
  withCutEnabled,
  assertPlan,
} from "../src/plan.js";
import { buildFilterScript } from "../src/export.js";
import type { AnalysisParams, Cut, CutPlan } from "../src/types.js";
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
    { id: 1, pause: [10, 12], remove: [10.2, 11.9], removedDuration: 1.7, enabled: true },
    { id: 2, pause: [20, 22], remove: [20.2, 21.9], removedDuration: 1.7, enabled: true },
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
