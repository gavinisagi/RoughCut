import { create } from "zustand";
import {
  DEFAULT_PARAMS,
  applyVerdicts,
  buildPlan,
  detectPauses,
  extractSpeechSegments,
  ruleReview,
  withCutEnabled,
  withSegmentDropped,
  withTranscript,
  type AnalysisParams,
  type AudioAnalysis,
  type CutPlan,
  type LlmConfig,
  type Transcript,
} from "@roughcut/core/pure";
import type { SessionPayload } from "./env";
import { clipRanges, engine, rangesFrom } from "./audio/PreviewEngine";

export type PlayMode = "idle" | "compact" | "cut" | "raw";
export type SideTab = "params" | "review";

export interface AppSettings {
  whisperCli: string;
  whisperModel: string;
  language: string;
  llmBaseUrl: string;
  llmKey: string;
  llmModel: string;
}

const SETTINGS_KEY = "roughcut-settings";

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    // corrupted settings: fall through to defaults
  }
  return defaultSettings();
}

function defaultSettings(): AppSettings {
  return {
    whisperCli: "",
    whisperModel: "",
    language: "auto",
    llmBaseUrl: "",
    llmKey: "",
    llmModel: "",
  };
}

export function llmConfigOf(s: AppSettings): LlmConfig | null {
  return s.llmBaseUrl && s.llmKey && s.llmModel
    ? { baseUrl: s.llmBaseUrl, apiKey: s.llmKey, model: s.llmModel }
    : null;
}

export interface ExportState {
  open: boolean;
  running: boolean;
  ratio: number;
  done: { output: string | null; audioOutput: string | null; reportPath: string | null } | null;
  error: string | null;
}

/** Can Chromium play this codec directly (hardware decoders included)? */
function probeDirectPlayback(codec: string | undefined): boolean {
  if (!codec) return false;
  const candidates: Record<string, string[]> = {
    hevc: ['video/mp4; codecs="hvc1.1.6.L153.B0"', 'video/mp4; codecs="hev1.1.6.L153.B0"'],
    h265: ['video/mp4; codecs="hvc1.1.6.L153.B0"'],
  };
  const mimes = candidates[codec.toLowerCase()];
  if (!mimes) return false;
  const v = document.createElement("video");
  return mimes.some((m) => v.canPlayType(m) !== "");
}

export interface Thumbs {
  intervalSec: number;
  bitmaps: ImageBitmap[];
}

/** Nearest thumbnail for an original-time position. */
export function thumbAt(thumbs: Thumbs | null, timeSec: number): ImageBitmap | null {
  if (!thumbs || thumbs.bitmaps.length === 0) return null;
  const idx = Math.min(
    thumbs.bitmaps.length - 1,
    Math.max(0, Math.round(timeSec / thumbs.intervalSec)),
  );
  return thumbs.bitmaps[idx];
}

interface RoughcutState {
  session: SessionPayload | null;
  videoUrl: string | null;
  /** Proxy URL once built. Playback prefers it: low-res but instant seeks. */
  proxyUrl: string | null;
  /** Proxy that arrived mid-playback; applied when playback stops. */
  pendingVideoUrl: string | null;
  proxyProgress: number | null;
  /** Low-res filmstrip for instant scrub preview (NLE-style). */
  thumbs: Thumbs | null;
  loading: string | null;
  error: string | null;
  params: AnalysisParams;
  plan: CutPlan | null;
  selectedCutId: number | null;
  /** Segment highlighted/expanded in the review list. */
  selectedSegmentId: number | null;
  playhead: number;
  playMode: PlayMode;
  exportState: ExportState;
  activeTab: SideTab;
  settings: AppSettings;
  settingsOpen: boolean;
  asrBusy: "transcribe" | "review" | null;
  asrProgress: number;
  asrError: string | null;

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
  /** Return to idle, applying any proxy that arrived mid-playback. */
  settlePlayback(): void;
  jumpCut(direction: 1 | -1): void;
  proxyReady(url: string): void;
  setProxyProgress(ratio: number): void;
  thumbsReady(payload: { intervalSec: number; images: ArrayBuffer[] }): Promise<void>;
  /** Called when the <video> errors on the original file: fall back to proxy. */
  videoFailed(): void;
  setExportState(patch: Partial<ExportState>): void;
  runExport(opts: { output: string; alsoAudio: boolean; crf: number; preset: string }): Promise<void>;
  savePlan(): Promise<void>;
  dismissError(): void;

  setActiveTab(tab: SideTab): void;
  setSettingsOpen(open: boolean): void;
  saveSettings(patch: Partial<AppSettings>): void;
  runTranscribe(): Promise<void>;
  runReview(): Promise<void>;
  toggleSegmentDropped(id: number): void;
  applyAllRecommended(): void;
  playSegment(id: number): void;
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
  proxyUrl: null,
  pendingVideoUrl: null,
  proxyProgress: null,
  thumbs: null,
  loading: null,
  error: null,
  params: { ...DEFAULT_PARAMS },
  plan: null,
  selectedCutId: null,
  selectedSegmentId: null,
  playhead: 0,
  playMode: "idle",
  exportState: { open: false, running: false, ratio: 0, done: null, error: null },
  activeTab: "params",
  settings: loadSettings(),
  settingsOpen: false,
  asrBusy: null,
  asrProgress: 0,
  asrError: null,

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
      // If the main process deemed the codec unplayable, probe whether this
      // machine can hardware-decode it (HEVC on Windows commonly works) and
      // use the original file directly instead of waiting for the proxy.
      let videoUrl = session.videoUrl;
      if (!videoUrl && session.originalVideoUrl && probeDirectPlayback(session.media.video?.codec)) {
        videoUrl = session.originalVideoUrl;
      }
      set({
        session,
        videoUrl,
        proxyUrl: null,
        pendingVideoUrl: null,
        proxyProgress: session.proxyPending ? 0 : null,
        thumbs: null,
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
    // Once transcribed, segment structure comes from the transcript: gap
    // parameters stay live, threshold/minSilence need a re-transcribe.
    const transcript = get().plan?.transcript;
    const plan = buildPlan(
      session.media,
      analysisOf(session),
      params,
      "roughcut-gui@0.2.0",
      transcript,
    );
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
      onEnd: () => get().settlePlayback(),
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
      onEnd: () => get().settlePlayback(),
    });
    set({ playMode: "cut" });
  },

  playRaw(from) {
    const { session } = get();
    if (!session) return;
    const start = from ?? get().playhead;
    engine.play([[start, session.media.durationSec || session.analysisDurationSec]], {
      onTime: (t) => set({ playhead: t }),
      onEnd: () => get().settlePlayback(),
    });
    set({ playMode: "raw" });
  },

  stopPlayback() {
    engine.stop();
    get().settlePlayback();
  },

  settlePlayback() {
    set((s) => ({
      playMode: "idle",
      videoUrl: s.pendingVideoUrl ?? s.videoUrl,
      pendingVideoUrl: null,
    }));
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

  proxyReady(url) {
    set((s) => {
      // Playback always prefers the short-GOP proxy (instant seeks). Switching
      // src mid-playback would glitch, so defer until playback stops.
      if (s.playMode !== "idle") {
        return { proxyUrl: url, proxyProgress: null, pendingVideoUrl: url };
      }
      return { proxyUrl: url, proxyProgress: null, videoUrl: url };
    });
  },

  setProxyProgress(ratio) {
    set({ proxyProgress: ratio });
  },

  async thumbsReady(payload) {
    const bitmaps = await Promise.all(
      payload.images.map((bytes) =>
        createImageBitmap(new Blob([bytes], { type: "image/jpeg" })),
      ),
    );
    set({ thumbs: { intervalSec: payload.intervalSec, bitmaps } });
  },

  videoFailed() {
    set((s) => {
      // Original-file playback failed (probe was wrong): fall back to the
      // proxy when it exists, else show the placeholder until proxy-ready.
      if (s.videoUrl && s.videoUrl === s.session?.originalVideoUrl) {
        return { videoUrl: s.proxyUrl };
      }
      return {};
    });
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

  setActiveTab(tab) {
    set({ activeTab: tab });
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open });
  },

  saveSettings(patch) {
    set((s) => {
      const settings = { ...s.settings, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        // non-fatal
      }
      return { settings };
    });
  },

  async runTranscribe() {
    const { session, params, plan } = get();
    if (!session || !plan) return;
    set({ asrBusy: "transcribe", asrProgress: 0, asrError: null });
    try {
      const pauses = detectPauses(analysisOf(session), {
        thresholdDb: params.thresholdDb,
        minSilence: params.minSilence,
      });
      const segments = extractSpeechSegments(pauses, plan.stats.originalDuration);
      const { settings } = get();
      const result = await window.roughcut.transcribe({
        segments,
        whisperCli: settings.whisperCli || undefined,
        whisperModel: settings.whisperModel || undefined,
        language: settings.language || "auto",
      });
      const transcript: Transcript = {
        engine: result.engine,
        language: settings.language !== "auto" ? settings.language : undefined,
        reviewedBy: null,
        segments: result.segments,
      };
      set({ plan: withTranscript(get().plan!, transcript), asrBusy: null, activeTab: "review" });
    } catch (err) {
      set({ asrBusy: null, asrError: err instanceof Error ? err.message : String(err) });
    }
  },

  async runReview() {
    const { plan, settings } = get();
    const transcript = plan?.transcript;
    if (!plan || !transcript) return;
    const withText = transcript.segments.filter((s) => s.text);
    if (withText.length === 0) {
      set({ asrError: "没有可审查的转录文本" });
      return;
    }
    set({ asrBusy: "review", asrError: null });
    try {
      const llm = llmConfigOf(settings);
      const verdicts = llm
        ? await window.roughcut.llmReviewRun(withText, llm)
        : ruleReview(withText);
      const reviewed: Transcript = {
        ...transcript,
        reviewedBy: llm ? llm.model : "similarity-rule",
        segments: applyVerdicts(transcript.segments, verdicts),
      };
      set({ plan: withTranscript(get().plan!, reviewed), asrBusy: null });
    } catch (err) {
      set({ asrBusy: null, asrError: err instanceof Error ? err.message : String(err) });
    }
  },

  toggleSegmentDropped(id) {
    const { plan } = get();
    if (!plan?.transcript) return;
    const seg = plan.transcript.segments.find((s) => s.id === id);
    if (!seg) return;
    set({ plan: withSegmentDropped(plan, id, !seg.dropped) });
  },

  applyAllRecommended() {
    const { plan } = get();
    const transcript = plan?.transcript;
    if (!plan || !transcript) return;
    const next: Transcript = {
      ...transcript,
      segments: transcript.segments.map((s) =>
        s.verdict === "drop" ? { ...s, dropped: true } : s,
      ),
    };
    set({ plan: withTranscript(plan, next) });
  },

  playSegment(id) {
    const { plan } = get();
    const seg = plan?.transcript?.segments.find((s) => s.id === id);
    if (!seg) return;
    set({ selectedSegmentId: id, playhead: Math.max(0, seg.start - 0.15) });
    engine.play([[Math.max(0, seg.start - 0.15), seg.end + 0.15]], {
      onTime: (t) => set({ playhead: t }),
      onEnd: () => get().settlePlayback(),
    });
    set({ playMode: "cut" });
  },
}));
