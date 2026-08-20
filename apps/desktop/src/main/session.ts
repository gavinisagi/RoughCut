/**
 * One media session at a time: probe + analysis + preview assets in a temp dir.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANALYSIS_SAMPLE_RATE,
  analyzeAudio,
  chromiumCanPlay,
  extractThumbnails,
  extractWav,
  makeProxy,
  probeMedia,
  type MediaInfo,
} from "@roughcut/core";

export interface ThumbsPayload {
  intervalSec: number;
  /** JPEG bytes, index i covers time i*intervalSec. */
  images: ArrayBuffer[];
}

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
  /** rcmedia:// URL the <video> can safely play now, or null while a proxy builds. */
  videoUrl: string | null;
  /**
   * rcmedia:// URL of the original file whenever it has video. The renderer
   * may probe hardware decode support (e.g. HEVC on Windows) and use this
   * directly instead of waiting for the proxy.
   */
  originalVideoUrl: string | null;
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
  /** Source path of the currently open media (for transcribe etc.). */
  currentPath: string | null = null;

  async open(
    path: string,
    onProxyReady: (url: string) => void,
    onProxyProgress?: (ratio: number) => void,
    onThumbsReady?: (thumbs: ThumbsPayload) => void,
  ): Promise<SessionPayload> {
    this.dispose();
    this.tempDir = mkdtempSync(join(tmpdir(), "roughcut-gui-"));
    const token = ++this.proxyToken;
    this.currentPath = path;

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
    // A proxy is needed when Chromium can't decode the codec at all, and also
    // for high-res sources: seeking a 4K file freezes the picture for hundreds
    // of ms at every segment boundary, which reads as "video not playing".
    // Playback uses the small short-GOP proxy; the original serves export.
    const highRes = media.video ? media.video.width * media.video.height > 1920 * 1088 : false;
    let videoUrl: string | null = null;
    let proxyPending = false;

    if (media.video && playable && !highRes) {
      videoUrl = toMediaUrl(path);
    } else if (media.video) {
      if (playable) videoUrl = toMediaUrl(path); // play original until proxy lands
      proxyPending = true;
      const proxyPath = join(this.tempDir, "proxy.mp4");
      // Fire and forget; notify the renderer when done (stale opens ignored).
      void makeProxy(path, proxyPath, {
        expectedDurationSec: media.durationSec,
        onProgress: (ratio) => {
          if (token === this.proxyToken) onProxyProgress?.(ratio);
        },
      })
        .then(() => {
          if (token === this.proxyToken) onProxyReady(toMediaUrl(proxyPath));
        })
        .catch((err) => {
          console.error("proxy generation failed:", err);
        });
    }

    // Filmstrip thumbnails in the background: instant low-res scrub preview
    // regardless of whether the <video> element can keep up.
    if (media.video && onThumbsReady) {
      const thumbsDir = join(this.tempDir, "thumbs");
      mkdirSync(thumbsDir);
      void extractThumbnails(path, thumbsDir, { durationSec: media.durationSec })
        .then(({ intervalSec, count }) => {
          if (token !== this.proxyToken) return;
          const images: ArrayBuffer[] = [];
          for (let i = 1; i <= count; i++) {
            const buf = readFileSync(join(thumbsDir, `thumb_${String(i).padStart(5, "0")}.jpg`));
            images.push(
              buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
            );
          }
          onThumbsReady({ intervalSec, images });
        })
        .catch((err) => {
          console.error("thumbnail extraction failed:", err);
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
      originalVideoUrl: media.video ? toMediaUrl(path) : null,
      proxyPending,
    };
  }

  dispose(): void {
    this.proxyToken++;
    this.currentPath = null;
    if (this.tempDir) {
      const dir = this.tempDir;
      this.tempDir = null;
      try {
        // Windows keeps proxy/preview files locked while the <video> element
        // still holds them (window closing, or re-import); retry briefly and
        // otherwise leave the leftovers to the OS temp cleaner. Cleanup must
        // never crash the main process.
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
      } catch (err) {
        console.warn(`temp cleanup failed for ${dir} (left to OS):`, err);
      }
    }
  }
}
