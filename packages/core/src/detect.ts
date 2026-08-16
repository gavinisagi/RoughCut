/**
 * Silence-run detection over RMS frames. Pure functions (contract: no IO).
 */
import type { AudioAnalysis, Pause } from "./types.js";

export interface DetectOptions {
  thresholdDb: number;
  minSilence: number;
}

/**
 * Find silence runs of at least minSilence seconds.
 * Frame i covers [i*hop, (i+1)*hop) on the timeline for boundary purposes;
 * runs touching the ends of the timeline are clamped to [0, duration].
 */
export function detectPauses(analysis: AudioAnalysis, opts: DetectOptions): Pause[] {
  const { rmsDb, hopSec, durationSec } = analysis;
  const n = rmsDb.length;
  const pauses: Pause[] = [];
  let runStart = -1;

  for (let i = 0; i <= n; i++) {
    const silent = i < n && rmsDb[i] < opts.thresholdDb;
    if (silent && runStart < 0) {
      runStart = i;
    } else if (!silent && runStart >= 0) {
      let start = runStart * hopSec;
      let end = i * hopSec;
      if (runStart === 0) start = 0;
      if (i === n) end = durationSec;
      // Epsilon guards float error in frame-grid arithmetic (e.g. 145*0.01-100*0.01).
      if (end - start >= opts.minSilence - 1e-6) {
        pauses.push({ start, end: Math.min(end, durationSec) });
      }
      runStart = -1;
    }
  }
  return pauses;
}
