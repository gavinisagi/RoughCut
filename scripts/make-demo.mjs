#!/usr/bin/env node
/**
 * Build a presentable demo clip: a dark "talking-head studio" frame (drawn
 * pixel-by-pixel, no deps) + real Chinese speech from Windows TTS, with a
 * deliberate retake (segment 1 is re-said as segment 2) so the transcribe +
 * review pipeline has something真实 to catch.
 *
 *   node scripts/make-demo.mjs [out.mp4]
 *
 * Falls back to tone bursts on non-Windows (frame art still applies).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OUT = resolve(process.argv[2] ?? "demo.mp4");
const W = 1280;
const H = 720;
const SR = 22050;

const LINES = [
  "大家好，今天我们聊聊自动粗剪这个话题。",
  "大家好。今天我们来聊一聊，自动粗剪这个话题。",
  "首先，说说为什么要做这个工具。",
];
const LEAD = 0.5;
const GAPS = [1.3, 0.9];
const TAIL = 0.7;

// ---------------------------------------------------------------- frame art
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Per-variant caption block widths (fake text) — first block is highlighted. */
const CAPTIONS = [
  [92, 58, 140, 74, 110, 48],
  [120, 66, 88, 132, 54],
  [70, 148, 60, 96, 120, 42],
];

function makeFrame(variant) {
  const dy = [0, -4, 3][variant];
  const bg0 = [32, 39, 48];
  const bg1 = [15, 17, 20];
  const body = [44, 51, 61];
  const bodyEdge = [45, 212, 191];
  const px = Buffer.alloc(W * H * 3);

  const headCx = 640;
  const headCy = 298 + dy;
  const headR = 96;
  const shCx = 640;
  const shCy = 585 + dy;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Radial studio backdrop with a soft vignette.
      const d = Math.hypot(x - 640, (y - 290) * 1.15) / 700;
      let c = mix(bg0, bg1, clamp01(d));

      // Silhouette: head circle + shoulders superellipse.
      const hd = Math.hypot(x - headCx, y - headCy);
      const sx = Math.abs(x - shCx) / 250;
      const sy = Math.abs(y - shCy) / 210;
      const sh = Math.pow(sx, 2.6) + Math.pow(sy, 2.6);
      const inHead = hd <= headR;
      const inBody = sh <= 1 && y > headCy;
      if (inHead || inBody) {
        c = body;
        // Teal rim light on the silhouette edge.
        const edge = inHead ? headR - hd : (1 - sh) * 120;
        if (edge < 5) c = mix(bodyEdge, body, clamp01(edge / 5));
      }

      // Caption bar.
      if (y >= 598 && y <= 664) {
        c = mix(c, [8, 10, 12], 0.82);
        if (y >= 622 && y <= 641) {
          let bx = 352;
          for (let i = 0; i < CAPTIONS[variant].length; i++) {
            const bw = CAPTIONS[variant][i];
            if (x >= bx && x < bx + bw) {
              c = i === 0 ? [45, 212, 191] : [205, 212, 221];
            }
            bx += bw + 14;
          }
        }
      }

      // REC dot (top-left) + underline.
      if (Math.hypot(x - 64, y - 54) <= 9) c = [239, 68, 68];
      if (y >= 50 && y <= 53 && x >= 84 && x <= 132) c = [225, 228, 232];

      // Brand mark (bottom-right).
      if (x >= 1186 && x <= 1200 && y >= 664 && y <= 678) c = [59, 130, 246];
      if (y >= 668 && y <= 673 && x >= 1208 && x <= 1246) c = [205, 212, 221];

      const o = (y * W + x) * 3;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
    }
  }
  return px;
}

/** Minimal 24-bit BMP writer (bottom-up, BGR, 4-byte row padding). */
function writeBmp(path, rgb) {
  const rowSize = Math.ceil((3 * W) / 4) * 4;
  const dataSize = rowSize * H;
  const buf = Buffer.alloc(54 + dataSize);
  buf.write("BM", 0);
  buf.writeUInt32LE(54 + dataSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(W, 18);
  buf.writeInt32LE(H, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(dataSize, 34);
  for (let y = 0; y < H; y++) {
    const row = 54 + (H - 1 - y) * rowSize;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      buf[row + x * 3] = rgb[o + 2];
      buf[row + x * 3 + 1] = rgb[o + 1];
      buf[row + x * 3 + 2] = rgb[o];
    }
  }
  writeFileSync(path, buf);
}

// ---------------------------------------------------------------- speech
/** Windows TTS via System.Speech; returns mono s16 PCM at SR. */
function ttsPcm(tmp, text, index) {
  const wavPath = join(tmp, `tts_${index}.wav`);
  const script = join(tmp, `tts_${index}.ps1`);
  writeFileSync(
    script,
    [
      "Add-Type -AssemblyName System.Speech",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1",
      "if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }",
      "$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)",
      `$s.SetOutputToWaveFile('${wavPath.replace(/'/g, "''")}', $fmt)`,
      "$s.Rate = 0",
      `$s.Speak([IO.File]::ReadAllText('${join(tmp, `tts_${index}.txt`)}', [Text.Encoding]::UTF8))`,
      "$s.Dispose()",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(tmp, `tts_${index}.txt`), text, "utf8");
  const res = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
    stdio: "pipe",
  });
  if (res.status !== 0) {
    throw new Error(`TTS failed: ${res.stderr?.toString("utf8").slice(0, 400)}`);
  }
  const wav = readFileSync(wavPath);
  const data = wav.indexOf(Buffer.from("data"));
  if (data < 0) throw new Error("TTS wav has no data chunk");
  const size = wav.readUInt32LE(data + 4);
  return wav.subarray(data + 8, data + 8 + size);
}

/** Fallback speech: amplitude-modulated tone burst. */
function tonePcm(durSec, freq) {
  const n = Math.round(durSec * SR);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.3 * t);
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * t) * 0.35 * env * 32767), i * 2);
  }
  return buf;
}

function silencePcm(durSec) {
  return Buffer.alloc(Math.round(durSec * SR) * 2);
}

function wavFromPcm(pcm) {
  const buf = Buffer.alloc(44 + pcm.length);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + pcm.length, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(pcm.length, 40);
  pcm.copy(buf, 44);
  return buf;
}

// ---------------------------------------------------------------- assemble
const tmp = mkdtempSync(join(tmpdir(), "roughcut-demo-"));
try {
  const useTts = process.platform === "win32";
  const speech = LINES.map((line, i) => {
    if (useTts) {
      try {
        return ttsPcm(tmp, line, i);
      } catch (err) {
        console.warn(`TTS unavailable (${err.message.split("\n")[0]}); using tones`);
      }
    }
    return tonePcm(2.2 + i * 0.4, 300 + i * 80);
  });

  const durs = speech.map((p) => p.length / 2 / SR);
  const pcm = Buffer.concat([
    silencePcm(LEAD), speech[0],
    silencePcm(GAPS[0]), speech[1],
    silencePcm(GAPS[1]), speech[2],
    silencePcm(TAIL),
  ]);
  const wavPath = join(tmp, "speech.wav");
  writeFileSync(wavPath, wavFromPcm(pcm));

  // Frame switches at pause midpoints (mimics restarting a take).
  const t1 = LEAD + durs[0] + GAPS[0] / 2;
  const t2 = durs[1] + GAPS[0] / 2 + GAPS[1] / 2;
  const t3 = durs[2] + GAPS[1] / 2 + TAIL;
  const frames = [0, 1, 2].map((v) => {
    const p = join(tmp, `frame_${v}.bmp`);
    writeBmp(p, makeFrame(v));
    return p;
  });

  execFileSync(
    process.env.ROUGHCUT_FFMPEG ?? "ffmpeg",
    [
      "-v", "error", "-y",
      "-loop", "1", "-t", t1.toFixed(3), "-i", frames[0],
      "-loop", "1", "-t", t2.toFixed(3), "-i", frames[1],
      "-loop", "1", "-t", t3.toFixed(3), "-i", frames[2],
      "-i", wavPath,
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0,fps=30,format=yuv420p[v]",
      "-map", "[v]", "-map", "3:a",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "160k",
      "-shortest",
      OUT,
    ],
    { stdio: "inherit" },
  );
  const total = LEAD + durs[0] + GAPS[0] + durs[1] + GAPS[1] + durs[2] + TAIL;
  console.log(
    `demo -> ${OUT}\n` +
      `  speech: ${durs.map((d) => d.toFixed(1)).join("s / ")}s (${useTts ? "Windows TTS" : "tones"})\n` +
      `  pauses: ${GAPS.join("s, ")}s · total ~${total.toFixed(1)}s\n` +
      `  segment 1 is a deliberate retake of segment 2 — review should flag it.`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
