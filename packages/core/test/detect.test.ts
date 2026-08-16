import { describe, expect, it } from "vitest";
import { detectPauses } from "../src/detect.js";
import type { AudioAnalysis } from "../src/types.js";

const HOP = 0.01;

/** Build an AudioAnalysis from [durationSec, dbLevel] runs. */
function makeAnalysis(runs: Array<[number, number]>): AudioAnalysis {
  const frames: number[] = [];
  for (const [dur, db] of runs) {
    const count = Math.round(dur / HOP);
    for (let i = 0; i < count; i++) frames.push(db);
  }
  return {
    sampleRate: 16000,
    hopSec: HOP,
    windowSec: 0.02,
    rmsDb: Float32Array.from(frames),
    peaks: new Float32Array(frames.length * 2),
    durationSec: frames.length * HOP,
  };
}

const OPTS = { thresholdDb: -38, minSilence: 0.45 };
const SPEECH = -20;
const SILENCE = -60;

describe("detectPauses", () => {
  it("returns nothing for continuous speech", () => {
    const a = makeAnalysis([[5, SPEECH]]);
    expect(detectPauses(a, OPTS)).toEqual([]);
  });

  it("finds an interior pause with frame accuracy", () => {
    const a = makeAnalysis([
      [2, SPEECH],
      [0.8, SILENCE],
      [2, SPEECH],
    ]);
    const pauses = detectPauses(a, OPTS);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].start).toBeCloseTo(2.0, 2);
    expect(pauses[0].end).toBeCloseTo(2.8, 2);
  });

  it("ignores silences shorter than minSilence", () => {
    const a = makeAnalysis([
      [2, SPEECH],
      [0.3, SILENCE],
      [2, SPEECH],
    ]);
    expect(detectPauses(a, OPTS)).toEqual([]);
  });

  it("detects head and tail silence touching the edges", () => {
    const a = makeAnalysis([
      [1, SILENCE],
      [2, SPEECH],
      [0.9, SILENCE],
    ]);
    const pauses = detectPauses(a, OPTS);
    expect(pauses).toHaveLength(2);
    expect(pauses[0].start).toBe(0);
    expect(pauses[0].end).toBeCloseTo(1.0, 2);
    expect(pauses[1].start).toBeCloseTo(3.0, 2);
    expect(pauses[1].end).toBeCloseTo(3.9, 2);
  });

  it("treats an all-silent file as one big pause", () => {
    const a = makeAnalysis([[3, SILENCE]]);
    const pauses = detectPauses(a, OPTS);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].start).toBe(0);
    expect(pauses[0].end).toBeCloseTo(3.0, 2);
  });

  it("exactly-minSilence run counts as a pause", () => {
    const a = makeAnalysis([
      [1, SPEECH],
      [0.45, SILENCE],
      [1, SPEECH],
    ]);
    expect(detectPauses(a, OPTS)).toHaveLength(1);
  });
});
