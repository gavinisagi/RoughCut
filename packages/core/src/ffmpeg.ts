/**
 * Single entry point for all ffmpeg/ffprobe invocations (contract: no bare
 * spawns elsewhere, see CLAUDE.md). Lookup order: ROUGHCUT_FFMPEG env var
 * (path to ffmpeg binary or its directory) -> system PATH.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MediaInfo, ProgressCallback } from "./types.js";

const isWindows = process.platform === "win32";

let cachedFfmpeg: string | null = null;
let cachedFfprobe: string | null = null;

function exeName(base: string): string {
  return isWindows ? `${base}.exe` : base;
}

function resolveTool(base: "ffmpeg" | "ffprobe"): string {
  const env = process.env.ROUGHCUT_FFMPEG;
  if (env && env.trim()) {
    const p = env.trim();
    // Allow pointing at either the ffmpeg binary itself or its directory.
    if (existsSync(p) && statSync(p).isDirectory()) {
      const candidate = join(p, exeName(base));
      if (existsSync(candidate)) return candidate;
    } else if (base === "ffmpeg" && existsSync(p)) {
      return p;
    } else {
      // ROUGHCUT_FFMPEG points at the ffmpeg binary; derive sibling ffprobe.
      const dir = p.replace(/[\\/][^\\/]+$/, "");
      const candidate = join(dir, exeName(base));
      if (existsSync(candidate)) return candidate;
    }
  }
  const probe = spawnSync(exeName(base), ["-version"], { stdio: "ignore" });
  if (probe.error) {
    throw new Error(
      `${base} not found. Install FFmpeg (winget install Gyan.FFmpeg / scoop install ffmpeg / https://ffmpeg.org) ` +
        `or set ROUGHCUT_FFMPEG to the ffmpeg binary or its directory.`,
    );
  }
  return exeName(base);
}

export function ffmpegPath(): string {
  if (!cachedFfmpeg) cachedFfmpeg = resolveTool("ffmpeg");
  return cachedFfmpeg;
}

export function ffprobePath(): string {
  if (!cachedFfprobe) cachedFfprobe = resolveTool("ffprobe");
  return cachedFfprobe;
}

export interface RunResult {
  code: number;
  stderr: string;
}

/** Run ffmpeg, optionally reporting progress parsed from stderr `time=`. */
export function runFfmpeg(
  args: string[],
  opts: { expectedDurationSec?: number; onProgress?: ProgressCallback } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (stderr.length > 262144) stderr = stderr.slice(-131072);
      if (opts.onProgress && opts.expectedDurationSec && opts.expectedDurationSec > 0) {
        const m = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(text);
        if (m) {
          const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          opts.onProgress(Math.min(1, sec / opts.expectedDurationSec));
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        opts.onProgress?.(1);
        resolve({ code: 0, stderr });
      } else {
        reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.slice(-2000)}`));
      }
    });
  });
}

/** ffprobe a media file into MediaInfo. */
export async function probeMedia(path: string): Promise<MediaInfo> {
  if (!existsSync(path)) throw new Error(`Input not found: ${path}`);
  const args = [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    path,
  ];
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffprobePath(), args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`ffprobe failed (${code}): ${stderr.slice(-1000)}`)),
    );
  });
  const data = JSON.parse(out) as {
    format?: { format_name?: string; duration?: string; size?: string };
    streams?: Array<Record<string, unknown>>;
  };
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && s.disposition_attached_pic !== 1);
  const a = streams.find((s) => s.codec_type === "audio");

  const parseFps = (rate: unknown): number => {
    if (typeof rate !== "string") return 0;
    const [num, den] = rate.split("/").map(Number);
    return den ? num / den : num || 0;
  };

  let durationSec = Number(data.format?.duration ?? 0);
  if (!durationSec) {
    const sd = (v?.duration ?? a?.duration) as string | undefined;
    durationSec = Number(sd ?? 0);
  }

  return {
    path,
    format: data.format?.format_name ?? "unknown",
    durationSec,
    sizeBytes: Number(data.format?.size ?? 0),
    video: v
      ? {
          codec: String(v.codec_name ?? "unknown"),
          width: Number(v.width ?? 0),
          height: Number(v.height ?? 0),
          fps: parseFps(v.avg_frame_rate ?? v.r_frame_rate),
        }
      : null,
    audio: a
      ? {
          codec: String(a.codec_name ?? "unknown"),
          sampleRate: Number(a.sample_rate ?? 0),
          channels: Number(a.channels ?? 0),
        }
      : null,
  };
}

/** Decode the audio track to mono s16le PCM at the given rate, in memory. */
export function extractPcm(path: string, sampleRate: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "error",
      "-i", path,
      "-vn",
      "-ac", "1",
      "-ar", String(sampleRate),
      "-f", "s16le",
      "-",
    ];
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`PCM extraction failed (${code}): ${stderr.slice(-1000)}`));
    });
  });
}

/** Extract a mono WAV (for Web Audio preview decode). */
export async function extractWav(
  path: string,
  outPath: string,
  sampleRate = 44100,
): Promise<void> {
  await runFfmpeg([
    "-v", "error",
    "-y",
    "-i", path,
    "-vn",
    "-ac", "1",
    "-ar", String(sampleRate),
    "-c:a", "pcm_s16le",
    outPath,
  ]);
}

/** Codecs Chromium can play inside Electron without a proxy. */
export function chromiumCanPlay(codec: string | undefined): boolean {
  if (!codec) return false;
  return ["h264", "vp8", "vp9", "av1"].includes(codec.toLowerCase());
}

export interface ThumbnailResult {
  /** Seconds between consecutive thumbnails (frame i covers i*intervalSec). */
  intervalSec: number;
  /** Number of thumbnails written (thumb_00001.jpg ... zero-padded, 1-based). */
  count: number;
}

/**
 * Extract a strip of low-res JPEG thumbnails for instant scrub preview
 * (NLE-style filmstrip). Interval adapts to duration, capped at ~600 frames.
 */
export async function extractThumbnails(
  path: string,
  outDir: string,
  opts: { durationSec: number; height?: number; onProgress?: ProgressCallback } = { durationSec: 0 },
): Promise<ThumbnailResult> {
  const height = opts.height ?? 120;
  const duration = Math.max(0.001, opts.durationSec);
  const intervalSec = Math.min(2, Math.max(0.5, duration / 300));
  await runFfmpeg(
    [
      "-v", "error", "-stats",
      "-y",
      "-hwaccel", "auto",
      "-i", path,
      "-vf", `fps=${1 / intervalSec},scale=-2:${height}`,
      "-q:v", "6",
      "-f", "image2",
      join(outDir, "thumb_%05d.jpg"),
    ],
    { expectedDurationSec: duration, onProgress: opts.onProgress },
  );
  const count = readdirSync(outDir).filter((f) => /^thumb_\d+\.jpg$/.test(f)).length;
  return { intervalSec, count };
}

/** Create a small H.264 preview proxy for sources Chromium cannot decode. */
export async function makeProxy(
  path: string,
  outPath: string,
  opts: { height?: number; expectedDurationSec?: number; onProgress?: ProgressCallback } = {},
): Promise<void> {
  const height = opts.height ?? 480;
  await runFfmpeg(
    [
      "-v", "error",
      "-y",
      "-i", path,
      "-vf", `scale=-2:${height}`,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "fastdecode",
      "-crf", "28",
      // Short GOP so the preview player can seek instantly at cut boundaries.
      "-g", "30",
      "-keyint_min", "30",
      "-pix_fmt", "yuv420p",
      "-an",
      "-movflags", "+faststart",
      outPath,
    ],
    { expectedDurationSec: opts.expectedDurationSec, onProgress: opts.onProgress },
  );
}
