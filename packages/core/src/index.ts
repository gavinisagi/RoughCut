export * from "./types.js";
export * from "./ffmpeg.js";
export * from "./analysis.js";
export * from "./detect.js";
export * from "./plan.js";
export * from "./export.js";
export * from "./transcribe.js";
export * from "./review.js";

import { analyzeAudio } from "./analysis.js";
import { probeMedia } from "./ffmpeg.js";
import { buildPlan } from "./plan.js";
import type { AnalysisParams, AudioAnalysis, CutPlan, MediaInfo } from "./types.js";
import { DEFAULT_PARAMS } from "./types.js";

export interface AnalyzeFileResult {
  media: MediaInfo;
  analysis: AudioAnalysis;
  plan: CutPlan;
}

/** High-level: probe + decode + detect + plan in one call. */
export async function analyzeFile(
  path: string,
  params: Partial<AnalysisParams> = {},
): Promise<AnalyzeFileResult> {
  const merged: AnalysisParams = { ...DEFAULT_PARAMS, ...params };
  const media = await probeMedia(path);
  const analysis = await analyzeAudio(path);
  const plan = buildPlan(media, analysis, merged);
  return { media, analysis, plan };
}
