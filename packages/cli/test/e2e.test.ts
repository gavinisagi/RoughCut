/**
 * End-to-end: synthesize a video with known speech/pause layout, then verify
 * the CLI detects the pauses and exports a file of the expected length.
 * Requires ffmpeg/ffprobe on PATH (same requirement as the product itself).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLI = resolve(__dirname, "..", "bin", "roughcut.js");
const SR = 44100;
/** Speech intervals in seconds; pauses are [2,3.5] (1.5s) and [5.5,6.3] (0.8s). */
const SPEECH: [number, number][] = [
  [0, 2],
  [3.5, 5.5],
  [6.3, 8.3],
];
const DURATION = 8.3;

let dir: string;
let inputPath: string;

function writeWavWithSpeech(path: string): void {
  const total = Math.round(DURATION * SR);
  const samples = new Int16Array(total);
  for (const [s, e] of SPEECH) {
    const from = Math.round(s * SR);
    const to = Math.min(total, Math.round(e * SR));
    for (let i = from; i < to; i++) {
      samples[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / SR) * 0.4 * 32767);
    }
  }
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  Buffer.from(samples.buffer).copy(buf, 44);
  writeFileSync(path, buf);
}

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status ?? -1 };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "roughcut-e2e-"));
  const wav = join(dir, "speech.wav");
  writeWavWithSpeech(wav);
  inputPath = join(dir, "input.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30",
      "-i", wav,
      "-t", String(DURATION),
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      inputPath,
    ],
    { stdio: "pipe" },
  );
}, 60_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("roughcut CLI e2e", () => {
  it("probe reports the synthesized media", () => {
    const { stdout, status } = runCli(["probe", inputPath, "--json"]);
    expect(status).toBe(0);
    const media = JSON.parse(stdout);
    expect(media.durationSec).toBeGreaterThan(8.2);
    expect(media.durationSec).toBeLessThan(8.5);
    expect(media.video.codec).toBe("h264");
    expect(media.audio.codec).toBe("aac");
  });

  it("analyze finds both pauses at the right places", () => {
    const { stdout, status } = runCli(["analyze", inputPath, "--json"]);
    expect(status).toBe(0);
    const plan = JSON.parse(stdout);
    expect(plan.schemaVersion).toBe(1);
    expect(plan.cuts).toHaveLength(2);

    const [c1, c2] = plan.cuts;
    expect(c1.pause[0]).toBeCloseTo(2.0, 1);
    expect(c1.pause[1]).toBeCloseTo(3.5, 1);
    expect(c1.removedDuration).toBeCloseTo(1.2, 1);
    expect(c2.pause[0]).toBeCloseTo(5.5, 1);
    expect(c2.pause[1]).toBeCloseTo(6.3, 1);
    expect(c2.removedDuration).toBeCloseTo(0.5, 1);

    // After cutting, both pauses shrink to targetGap (0.3s default).
    expect(plan.stats.removedDuration).toBeCloseTo(1.7, 1);
    expect(plan.keepSegments.length).toBe(3);
  });

  it("respects a custom target gap", () => {
    const { stdout, status } = runCli([
      "analyze", inputPath, "--json", "--target-gap", "0.5",
    ]);
    expect(status).toBe(0);
    const plan = JSON.parse(stdout);
    // Removed = (1.5 - 0.5) + (0.8 - 0.5) = 1.3
    expect(plan.stats.removedDuration).toBeCloseTo(1.3, 1);
  });

  it("accepts negative threshold via space and equals syntax", () => {
    for (const args of [
      ["analyze", inputPath, "--json", "--threshold", "-50"],
      ["analyze", inputPath, "--json", "--threshold=-50"],
    ]) {
      const { stdout, status } = runCli(args);
      expect(status).toBe(0);
      expect(JSON.parse(stdout).params.thresholdDb).toBe(-50);
    }
  });

  it("cut exports a tightened video plus report", () => {
    const out = join(dir, "out.mp4");
    const report = join(dir, "report.json");
    const { status, stderr } = runCli([
      "cut", inputPath, "-o", out, "--report", report, "--preset", "ultrafast",
    ]);
    expect(status, stderr).toBe(0);
    expect(existsSync(out)).toBe(true);

    const probed = JSON.parse(runCli(["probe", out, "--json"]).stdout);
    // Expected 8.3 - 1.7 = 6.6s, allow encoder/frame tolerance.
    expect(probed.durationSec).toBeGreaterThan(6.4);
    expect(probed.durationSec).toBeLessThan(6.85);

    const rep = JSON.parse(readFileSync(report, "utf8"));
    expect(rep.schemaVersion).toBe(1);
    expect(rep.cuts).toHaveLength(2);
    expect(rep.export.output).toBe(out);
  });

  it("cut --plan honors a hand-disabled cut (stale keepSegments recomputed)", () => {
    const planPath = join(dir, "plan.json");
    const a = runCli(["analyze", inputPath, "--json", "-o", planPath]);
    expect(a.status).toBe(0);
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    // Contract: cuts are the source of truth. Flipping `enabled` is all a
    // hand edit needs; the CLI recomputes keepSegments/stats on load.
    plan.cuts[0].enabled = false;
    writeFileSync(planPath, JSON.stringify(plan), "utf8");

    const out = join(dir, "out-plan.mp4");
    const r = runCli(["cut", inputPath, "-o", out, "--plan", planPath, "--preset", "ultrafast"]);
    expect(r.status, r.stderr).toBe(0);
    const probed = JSON.parse(runCli(["probe", out, "--json"]).stdout);
    // Only the 0.5s cut applies: 8.3 - 0.5 = 7.8
    expect(probed.durationSec).toBeGreaterThan(7.6);
    expect(probed.durationSec).toBeLessThan(8.05);
  });

  it("audio-only export works", () => {
    const outWav = join(dir, "out.wav");
    const r = runCli(["cut", inputPath, "--audio", outWav]);
    expect(r.status, r.stderr).toBe(0);
    const probed = JSON.parse(runCli(["probe", outWav, "--json"]).stdout);
    expect(probed.durationSec).toBeGreaterThan(6.4);
    expect(probed.durationSec).toBeLessThan(6.85);
  });
});
