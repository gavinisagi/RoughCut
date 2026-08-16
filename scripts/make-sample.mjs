#!/usr/bin/env node
/**
 * Generate a sample talking-head-like clip with known pauses, for demos and
 * GUI smoke tests. Speech = 440Hz tone bursts, pauses = silence.
 *
 *   node scripts/make-sample.mjs [out.mp4]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OUT = resolve(process.argv[2] ?? "sample.mp4");
const SR = 44100;
const SPEECH = [
  [0, 2.0],
  [3.5, 5.5],   // pause before: 1.5s
  [6.3, 8.3],   // pause before: 0.8s
];
const DURATION = 8.3;

const total = Math.round(DURATION * SR);
const samples = new Int16Array(total);
for (const [s, e] of SPEECH) {
  const from = Math.round(s * SR);
  const to = Math.min(total, Math.round(e * SR));
  for (let i = from; i < to; i++) {
    // Amplitude-modulated tone reads better on the waveform than a flat sine.
    const t = i / SR;
    const env = 0.55 + 0.45 * Math.sin(2 * Math.PI * 2.1 * t);
    samples[i] = Math.round(Math.sin(2 * Math.PI * 440 * t) * 0.38 * env * 32767);
  }
}

const dataSize = samples.length * 2;
const wav = Buffer.alloc(44 + dataSize);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + dataSize, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(dataSize, 40);
Buffer.from(samples.buffer).copy(wav, 44);

const tmp = mkdtempSync(join(tmpdir(), "roughcut-sample-"));
try {
  const wavPath = join(tmp, "speech.wav");
  writeFileSync(wavPath, wav);
  execFileSync(
    process.env.ROUGHCUT_FFMPEG ?? "ffmpeg",
    [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
      "-i", wavPath,
      "-t", String(DURATION),
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k",
      OUT,
    ],
    { stdio: "inherit" },
  );
  console.log(`sample -> ${OUT}  (pauses at 2.0-3.5s and 5.5-6.3s)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
