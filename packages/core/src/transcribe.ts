/**
 * whisper.cpp runner + transcript-to-segment alignment.
 * Contract (CLAUDE.md invariant 4): every whisper-cli invocation goes through
 * here. Lookup: ROUGHCUT_WHISPER env (binary or its directory) -> PATH.
 * The model file is user-provided: ROUGHCUT_WHISPER_MODEL env or option.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractWav } from "./ffmpeg.js";
import type { ProgressCallback, SpeechSegment } from "./types.js";

const isWindows = process.platform === "win32";
const CANDIDATES = ["whisper-cli", "whisper-cpp", "main"];

let cachedWhisper: string | null = null;

function exeName(base: string): string {
  return isWindows ? `${base}.exe` : base;
}

export function whisperPath(): string {
  if (cachedWhisper) return cachedWhisper;
  const env = process.env.ROUGHCUT_WHISPER;
  if (env && env.trim()) {
    const p = env.trim();
    if (existsSync(p) && statSync(p).isDirectory()) {
      for (const c of CANDIDATES) {
        const candidate = join(p, exeName(c));
        if (existsSync(candidate)) return (cachedWhisper = candidate);
      }
    } else if (existsSync(p)) {
      return (cachedWhisper = p);
    }
    throw new Error(`ROUGHCUT_WHISPER points at "${p}" but no whisper binary was found there.`);
  }
  for (const c of CANDIDATES) {
    const probe = spawnSync(exeName(c), ["--help"], { stdio: "ignore" });
    if (!probe.error) return (cachedWhisper = exeName(c));
  }
  throw new Error(
    "whisper-cli not found. Install whisper.cpp (https://github.com/ggml-org/whisper.cpp), " +
      "put whisper-cli on PATH or set ROUGHCUT_WHISPER, and download a model " +
      "(e.g. ggml-large-v3-turbo.bin) referenced via ROUGHCUT_WHISPER_MODEL.",
  );
}

export function whisperAvailable(): boolean {
  try {
    whisperPath();
    return true;
  } catch {
    return false;
  }
}

export function defaultWhisperModel(): string | null {
  const m = process.env.ROUGHCUT_WHISPER_MODEL;
  return m && existsSync(m) ? m : null;
}

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscribeOptions {
  /** Path to a ggml/gguf model file. Falls back to ROUGHCUT_WHISPER_MODEL. */
  model?: string;
  /** ISO language code, e.g. "zh"; "auto" lets whisper detect. */
  language?: string;
  onProgress?: ProgressCallback;
}

/** Run whisper.cpp on the file's audio and return timestamped segments. */
export async function transcribeAudio(
  inputPath: string,
  opts: TranscribeOptions = {},
): Promise<{ segments: WhisperSegment[]; engine: string }> {
  const bin = whisperPath();
  const model = opts.model ?? defaultWhisperModel();
  if (!model) {
    throw new Error(
      "No whisper model. Pass --whisper-model / set ROUGHCUT_WHISPER_MODEL to a ggml model file " +
        "(download: https://huggingface.co/ggerganov/whisper.cpp).",
    );
  }
  if (!existsSync(model)) throw new Error(`Whisper model not found: ${model}`);

  const tmp = mkdtempSync(join(tmpdir(), "roughcut-asr-"));
  try {
    const wav = join(tmp, "audio.wav");
    await extractWav(inputPath, wav, 16000); // whisper.cpp expects 16 kHz
    const outBase = join(tmp, "out");
    const args = [
      "-m", model,
      "-f", wav,
      "-l", opts.language ?? "auto",
      "-oj",
      "-of", outBase,
      "--print-progress",
    ];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, { windowsHide: true });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderr += text;
        if (stderr.length > 65536) stderr = stderr.slice(-32768);
        const m = /progress\s*=\s*(\d+)%/.exec(text);
        if (m && opts.onProgress) opts.onProgress(Math.min(1, Number(m[1]) / 100));
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`whisper exited with code ${code}:\n${stderr.slice(-1500)}`)),
      );
    });
    opts.onProgress?.(1);

    const jsonPath = `${outBase}.json`;
    if (!existsSync(jsonPath)) throw new Error("whisper produced no JSON output");
    const data = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      transcription?: Array<{ offsets?: { from: number; to: number }; text?: string }>;
    };
    const segments: WhisperSegment[] = (data.transcription ?? [])
      .filter((t) => t.offsets && typeof t.text === "string")
      .map((t) => ({
        start: t.offsets!.from / 1000,
        end: t.offsets!.to / 1000,
        text: t.text!,
      }));
    const modelName = model.split(/[\\/]/).pop() ?? model;
    return { segments, engine: `whisper-cli/${modelName}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Assign whisper text to detected speech segments by maximum time overlap
 * (whisper's own segmentation follows voice activity, so crossings are rare).
 * Pure function.
 */
export function alignTranscript(
  whisper: WhisperSegment[],
  segments: SpeechSegment[],
): SpeechSegment[] {
  const texts = new Map<number, string[]>();
  for (const w of whisper) {
    if (!w.text.trim()) continue;
    let best: SpeechSegment | null = null;
    let bestOverlap = 0;
    for (const s of segments) {
      const overlap = Math.min(w.end, s.end) - Math.max(w.start, s.start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = s;
      }
    }
    if (!best && segments.length > 0) {
      // No overlap at all (timestamp drift): snap to the nearest midpoint.
      const mid = (w.start + w.end) / 2;
      best = segments.reduce((a, b) =>
        Math.abs((a.start + a.end) / 2 - mid) <= Math.abs((b.start + b.end) / 2 - mid) ? a : b,
      );
    }
    if (best) {
      const list = texts.get(best.id);
      if (list) list.push(w.text);
      else texts.set(best.id, [w.text]);
    }
  }
  return segments.map((s) => {
    const joined = (texts.get(s.id) ?? []).join("").trim();
    return { ...s, text: joined.length > 0 ? joined : null };
  });
}
