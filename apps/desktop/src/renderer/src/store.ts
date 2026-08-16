import { create } from "zustand";
import {
  DEFAULT_PARAMS,
  buildPlan,
  withCutEnabled,
  type AnalysisParams,
  type AudioAnalysis,
  type CutPlan,
} from "@roughcut/core/pure";
import type { SessionPayload } from "./env";
import { clipRanges, engine, rangesFrom } from "./audio/PreviewEngine";

export type PlayMode = "idle" | "compact" | "cut" | "raw";

export interface ExportState {
  open: boolean;
  running: boolean;
  ratio: number;
  done: { output: string | null; audioOutput: string | null; reportPath: string | null } | null;
  error: string | null;
}

interface RoughcutState {
  session: SessionPayload | null;
  videoUrl: string | null;
  loading: string | null;
  error: string | null;
  params: AnalysisParams;
  plan: CutPlan | null;
  selectedCutId: number | null;
  playhead: number;
  playMode: PlayMode;
  exportState: ExportState;

  importVideo(): Promise<void>;
  openPath(path: string): Promise<void>;
  setParam<K extends keyof AnalysisParams>(key: K, value: AnalysisParams[K]): void;
  recompute(): void;
  toggleCut(id: number): void;
  selectCut(id: number | null): void;
  seek(t: number): void;
  playCompact(from?: number): void;
  playCut(id: number): void;
  playRaw(from?: number): void;
  stopPlayback(): void;
  jumpCut(direction: 1 | -1): void;
  setVideoUrl(url: string): void;
  setExportState(patch: Partial<ExportState>): void;
  runExport(opts: { output: string; alsoAudio: boolean; crf: number; preset: string }): Promise<void>;
  savePlan(): Promise<void>;
  dismissError(): void;
}

function analysisOf(session: SessionPayload): AudioAnalysis {
  return {
    sampleRate: session.sampleRate,
    hopSec: session.hopSec,
    windowSec: session.windowSec,
    rmsDb: session.rmsDb,
    peaks: session.peaks,
    durationSec: session.analysisDurationSec,
  };
}

let recomputeTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<RoughcutState>((set, get) => ({
  session: null,
  videoUrl: null,
  loading: null,
  error: null,
  params: { ...DEFAULT_PARAMS },
  plan: null,
  selectedCutId: null,
  playhead: 0,
  playMode: "idle",
  exportState: { open: false, running: false, ratio: 0, done: null, error: null },

  async importVideo() {
    const path = await window.roughcut.selectVideo();
    if (path) await get().openPath(path);
  },

  async openPath(path) {
    const name = path.split(/[\\/]/).pop() ?? path;
    set({ loading: `正在分析 ${name} …`, error: null });
    engine.unload();
    try {
      const session = await window.roughcut.openVideo(path);
      set({
        session,
        videoUrl: session.videoUrl,
        playhead: 0,
        selectedCutId: null,
        playMode: "idle",
      });
      // Analyze immediately with current params: instant feedback on import.
      get().recompute();
      set({ loading: `正在准备试听音频 …` });
      await engine.load(session.previewWav);
      set({ loading: null });
    } catch (err) {
      set({
        loading: null,
        error: err instanceof Error ? err.message : String(err),
        session: null,
        plan: null,
      });
    }
  },

  setParam(key, value) {
    set((s) => ({ params: { ...s.params, [key]: value } }));
    if (recomputeTimer) clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(() => get().recompute(), 250);
  },

  recompute() {
    const { session, params } = get();
    if (!session) return;
    const plan = buildPlan(session.media, analysisOf(session), params, "roughcut-gui@0.1.0");
    const selected = get().selectedCutId;
    set({
      plan,
      selectedCutId: selected !== null && plan.cuts.some((c) => c.id === selected) ? selected : null,
    });
  },

  toggleCut(id) {
    const { plan } = get();
    if (!plan) return;
    const cut = plan.cuts.find((c) => c.id === id);
    if (!cut) return;
    set({ plan: withCutEnabled(plan, id, !cut.enabled) });
  },

  selectCut(id) {
    set({ selectedCutId: id });
    if (id !== null) {
      const cut = get().plan?.cuts.find((c) => c.id === id);
      if (cut) set({ playhead: Math.max(0, cut.remove[0] - 1.2) });
    }
  },

  seek(t) {
    set({ playhead: t });
    if (get().playMode !== "idle") {
      // Restart current playback style from the new position.
      const mode = get().playMode;
      if (mode === "compact") get().playCompact(t);
      else get().playRaw(t);
    }
  },

  playCompact(from) {
    const { plan, session } = get();
    if (!plan || !session) return;
    const start = from ?? get().playhead;
    engine.play(rangesFrom(plan.keepSegments, start), {
      onTime: (t) => set({ playhead: t }),
      onEnd: () => set({ playMode: "idle" }),
    });
    set({ playMode: "compact" });
  },

  playCut(id) {
    const { plan } = get();
    if (!plan) return;
    const cut = plan.cuts.find((c) => c.id === id);
    if (!cut) return;
    set({ selectedCutId: id });
    const win: [number, number] = [cut.remove[0] - 1.2, cut.remove[1] + 1.2];
    const segments = cut.enabled
      ? plan.keepSegments
      : // For a disabled cut the window is contiguous source audio.
        ([[Math.max(0, win[0]), win[1]]] as [number, number][]);
    engine.play(clipRanges(segments, win[0], win[1]), {
      onTime: (t) => set({ playhead: t }),
      onEnd: () => set({ playMode: "idle" }),
    });
    set({ playMode: "cut" });
  },

  playRaw(from) {
    const { session } = get();
    if (!session) return;
    const start = from ?? get().playhead;
    engine.play([[start, session.media.durationSec || session.analysisDurationSec]], {
      onTime: (t) => set({ playhead: t }),
      onEnd: () => set({ playMode: "idle" }),
    });
    set({ playMode: "raw" });
  },

  stopPlayback() {
    engine.stop();
    set({ playMode: "idle" });
  },

  jumpCut(direction) {
    const { plan, selectedCutId } = get();
    if (!plan || plan.cuts.length === 0) return;
    const ids = plan.cuts.map((c) => c.id);
    let next: number;
    if (selectedCutId === null) {
      next = direction === 1 ? ids[0] : ids[ids.length - 1];
    } else {
      const idx = ids.indexOf(selectedCutId);
      next = ids[Math.min(ids.length - 1, Math.max(0, idx + direction))];
    }
    get().selectCut(next);
    get().playCut(next);
  },

  setVideoUrl(url) {
    set({ videoUrl: url });
  },

  setExportState(patch) {
    set((s) => ({ exportState: { ...s.exportState, ...patch } }));
  },

  async runExport(opts) {
    const { plan } = get();
    if (!plan) return;
    get().stopPlayback();
    get().setExportState({ running: true, ratio: 0, done: null, error: null });
    const off = window.roughcut.onExportProgress((ratio) => get().setExportState({ ratio }));
    try {
      const audioOutput = opts.alsoAudio ? opts.output.replace(/\.mp4$/i, "") + ".wav" : undefined;
      const result = await window.roughcut.exportCut(plan, {
        output: opts.output,
        audioOutput,
        crf: opts.crf,
        preset: opts.preset,
      });
      get().setExportState({
        running: false,
        ratio: 1,
        done: {
          output: result.output,
          audioOutput: result.audioOutput,
          reportPath: result.reportPath,
        },
      });
    } catch (err) {
      get().setExportState({
        running: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      off();
    }
  },

  async savePlan() {
    const { plan, session } = get();
    if (!plan || !session) return;
    const base = session.media.path.replace(/\.[^.]+$/, "");
    await window.roughcut.savePlan(plan, `${base}.roughcut.json`);
  },

  dismissError() {
    set({ error: null });
  },
}));
