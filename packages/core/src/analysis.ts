/**
 * PCM -> per-frame RMS (dBFS) + waveform peaks.
 * Frame grid: hop 10ms, window 20ms (window is centered on hop start; the
 * final partial window is padded implicitly by using fewer samples).
 */
import { extractPcm } from "./ffmpeg.js";
import type { AudioAnalysis } from "./types.js";

export const ANALYSIS_SAMPLE_RATE = 16000;
export const HOP_SEC = 0.01;
export const WINDOW_SEC = 0.02;

const DB_FLOOR = -100;

/** Compute analysis frames from raw s16le mono PCM. Pure math, no IO. */
export function analyzePcm(pcm: Buffer, sampleRate: number): AudioAnalysis {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const hop = Math.round(sampleRate * HOP_SEC);
  const win = Math.round(sampleRate * WINDOW_SEC);
  const frameCount = Math.max(0, Math.ceil(samples.length / hop));

  const rmsDb = new Float32Array(frameCount);
  const peaks = new Float32Array(frameCount * 2);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    const end = Math.min(start + win, samples.length);
    let sumSq = 0;
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      const s = samples[i];
      sumSq += s * s;
      if (s < min) min = s;
      if (s > max) max = s;
    }
    const n = Math.max(1, end - start);
    const rms = Math.sqrt(sumSq / n) / 32768;
    rmsDb[f] = rms > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(rms)) : DB_FLOOR;
    peaks[f * 2] = min / 32768;
    peaks[f * 2 + 1] = max / 32768;
  }

  return {
    sampleRate,
    hopSec: HOP_SEC,
    windowSec: WINDOW_SEC,
    rmsDb,
    peaks,
    durationSec: samples.length / sampleRate,
  };
}

/** Decode the file's audio and analyze it. */
export async function analyzeAudio(path: string): Promise<AudioAnalysis> {
  const pcm = await extractPcm(path, ANALYSIS_SAMPLE_RATE);
  if (pcm.byteLength === 0) {
    throw new Error("No audio data decoded. Does the input have an audio track?");
  }
  return analyzePcm(pcm, ANALYSIS_SAMPLE_RATE);
}
