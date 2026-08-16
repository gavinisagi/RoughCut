/**
 * One media session at a time: probe + analysis + preview assets in a temp dir.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANALYSIS_SAMPLE_RATE,
  analyzeAudio,
  chromiumCanPlay,
  extractWav,
  makeProxy,
  probeMedia,
  type MediaInfo,
} from "@roughcut/core";

export interface SessionPayload {
  media: MediaInfo;
  sampleRate: number;
  hopSec: number;
  windowSec: number;
  analysisDurationSec: number;
  rmsDb: Float32Array;
  peaks: Float32Array;
  /**
   * Raw bytes of the mono preview WAV for Web Audio decode. Passed over IPC
   * because fetch() to custom schemes is CORS-blocked from file:// pages.
   */
  previewWav: ArrayBuffer;
  /** rcmedia:// URL the <video> can play now, or null while a proxy builds. */
  videoUrl: string | null;
  /** True when a preview proxy is being generated in the background. */
  proxyPending: boolean;
}

export function toMediaUrl(path: string): string {
  return `rcmedia://media/${encodeURIComponent(path)}`;
}

export function fromMediaUrl(url: string): string {
  const prefix = "rcmedia://media/";
  if (!url.startsWith(prefix)) throw new Error(`Bad media url: ${url}`);
  return decodeURIComponent(url.slice(prefix.length));
}

export class MediaSession {
  private tempDir: string | null = null;
  private proxyToken = 0;

  async open(
    path: string,
    onProxyReady: (url: string) => void,
  ): Promise<SessionPayload> {
    this.dispose();
    this.tempDir = mkdtempSync(join(tmpdir(), "roughcut-gui-"));
    const token = ++this.proxyToken;

    const media = await probeMedia(path);
    if (!media.audio) throw new Error("该文件没有音轨，无法按语音停顿剪辑。");

    const analysis = await analyzeAudio(path);

    const previewWavPath = join(this.tempDir, "preview.wav");
    await extractWav(path, previewWavPath, 44100);
    const wavBuf = readFileSync(previewWavPath);
    const previewWav = wavBuf.buffer.slice(
      wavBuf.byteOffset,
      wavBuf.byteOffset + wavBuf.byteLength,
    ) as ArrayBuffer;

    const playable = media.video ? chromiumCanPlay(media.video.codec) : false;
    let videoUrl: string | null = null;
    let proxyPending = false;

    if (media.video && playable) {
      videoUrl = toMediaUrl(path);
    } else if (media.video) {
      proxyPending = true;
      const proxyPath = join(this.tempDir, "proxy.mp4");
      // Fire and forget; notify the renderer when done (stale opens ignored).
      void makeProxy(path, proxyPath, { expectedDurationSec: media.durationSec })
        .then(() => {
          if (token === this.proxyToken) onProxyReady(toMediaUrl(proxyPath));
        })
        .catch((err) => {
          console.error("proxy generation failed:", err);
        });
    }

    return {
      media,
      sampleRate: ANALYSIS_SAMPLE_RATE,
      hopSec: analysis.hopSec,
      windowSec: analysis.windowSec,
      analysisDurationSec: analysis.durationSec,
      rmsDb: analysis.rmsDb,
      peaks: analysis.peaks,
      previewWav,
      videoUrl,
      proxyPending,
    };
  }

  dispose(): void {
    this.proxyToken++;
    if (this.tempDir) {
      rmSync(this.tempDir, { recursive: true, force: true });
      this.tempDir = null;
    }
  }
}
