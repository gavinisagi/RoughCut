/**
 * CutPlan JSON is the contract shared by core, CLI and GUI (see CLAUDE.md).
 * All times are seconds (float). Bump SCHEMA_VERSION on breaking changes.
 */

export const SCHEMA_VERSION = 1;

export interface VideoStreamInfo {
  codec: string;
  width: number;
  height: number;
  fps: number;
}

export interface AudioStreamInfo {
  codec: string;
  sampleRate: number;
  channels: number;
}

export interface MediaInfo {
  path: string;
  format: string;
  durationSec: number;
  sizeBytes: number;
  video: VideoStreamInfo | null;
  audio: AudioStreamInfo | null;
}

/** Detection / planning parameters. All seconds unless suffixed Db. */
export interface AnalysisParams {
  /** Total pause duration after cutting (e.g. 0.3). Pauses shorter than this are left alone. */
  targetGap: number;
  /** Minimum silence run to be treated as a pause worth cutting. */
  minSilence: number;
  /** Frames with RMS below this (dBFS) count as silence. */
  thresholdDb: number;
  /** Portion of targetGap that must sit before the next speech onset. */
  padBefore: number;
  /** Portion of targetGap that must sit after the previous speech tail. */
  padAfter: number;
}

export const DEFAULT_PARAMS: AnalysisParams = {
  targetGap: 0.3,
  minSilence: 0.45,
  thresholdDb: -38,
  padBefore: 0.06,
  padAfter: 0.15,
};

/** Result of RMS analysis over mono PCM. */
export interface AudioAnalysis {
  /** Analysis sample rate (Hz), typically 16000. */
  sampleRate: number;
  /** Hop between frames in seconds (e.g. 0.01). */
  hopSec: number;
  /** RMS window length in seconds (e.g. 0.02). */
  windowSec: number;
  /** Per-frame RMS level in dBFS. */
  rmsDb: Float32Array;
  /** Interleaved per-frame [min,max] sample values normalized to [-1,1], for waveform drawing. */
  peaks: Float32Array;
  /** Audio duration derived from decoded sample count. */
  durationSec: number;
}

/** A detected silence run considered a pause. */
export interface Pause {
  start: number;
  end: number;
}

export interface Cut {
  id: number;
  /** The detected pause this cut shrinks: [start, end]. */
  pause: [number, number];
  /** The interval actually removed from the timeline: [start, end]. */
  remove: [number, number];
  removedDuration: number;
  /** Disabled cuts stay in the list (contract: never delete, see CLAUDE.md). */
  enabled: boolean;
}

export interface PlanStats {
  originalDuration: number;
  outputDuration: number;
  removedDuration: number;
  /** Number of enabled cuts. */
  cutCount: number;
  /** Total detected pauses (enabled + disabled + too-short-to-cut are not included; only cuts). */
  totalCuts: number;
}

export interface CutPlan {
  schemaVersion: number;
  generator: string;
  createdAt: string;
  input: MediaInfo;
  params: AnalysisParams;
  cuts: Cut[];
  /** Intervals of the source timeline kept in the output, honoring cut.enabled. */
  keepSegments: [number, number][];
  stats: PlanStats;
}

export interface ExportOptions {
  /** Output video path (.mp4). Omit for audio-only export. */
  output?: string;
  /** Optional standalone audio output (.wav / .m4a / .aac). */
  audioOutput?: string;
  crf?: number;
  preset?: string;
  audioBitrate?: string;
  /** Overwrite existing outputs. */
  overwrite?: boolean;
  onProgress?: (ratio: number) => void;
}

export interface ExportResult {
  output: string | null;
  audioOutput: string | null;
  /** Duration of the produced file as reported by ffprobe. */
  outputDurationSec: number | null;
  elapsedMs: number;
}

/** Cut report written next to exports: the plan plus export outcome. */
export interface CutReport extends CutPlan {
  export: {
    output: string | null;
    audioOutput: string | null;
    outputDurationSec: number | null;
    expectedDurationSec: number;
    elapsedMs: number;
  };
}

export type ProgressCallback = (ratio: number) => void;
