/// <reference types="vite/client" />
import type { LlmConfig, SpeechSegment, VerdictItem } from "@roughcut/core/pure";
import type { SessionPayload } from "../../main/session";

export interface ExportOpts {
  output?: string;
  audioOutput?: string;
  crf?: number;
  preset?: string;
  writeReport?: boolean;
}

export interface ExportOutcome {
  output: string | null;
  audioOutput: string | null;
  outputDurationSec: number | null;
  elapsedMs: number;
  reportPath: string | null;
}

declare global {
  interface Window {
    roughcut: {
      getPathForFile(file: File): string;
      selectVideo(): Promise<string | null>;
      selectSavePath(defaultPath: string): Promise<string | null>;
      openVideo(path: string): Promise<SessionPayload>;
      exportCut(plan: unknown, opts: ExportOpts): Promise<ExportOutcome>;
      savePlan(plan: unknown, defaultPath: string): Promise<string | null>;
      reveal(path: string): Promise<void>;
      asrAvailable(): Promise<boolean>;
      transcribe(opts: {
        segments: SpeechSegment[];
        whisperModel?: string;
        language?: string;
      }): Promise<{ engine: string; segments: SpeechSegment[] }>;
      llmReviewRun(segments: SpeechSegment[], config: LlmConfig): Promise<VerdictItem[]>;
      onAsrProgress(cb: (ratio: number) => void): () => void;
      onExportProgress(cb: (ratio: number) => void): () => void;
      onProxyReady(cb: (url: string) => void): () => void;
      onProxyProgress(cb: (ratio: number) => void): () => void;
      onThumbsReady(
        cb: (thumbs: { intervalSec: number; images: ArrayBuffer[] }) => void,
      ): () => void;
      onSmokeOpen(cb: (path: string) => void): () => void;
      onSmokePlay(cb: () => void): () => void;
      smokeDone(): Promise<void>;
    };
  }
}

export type { SessionPayload };
