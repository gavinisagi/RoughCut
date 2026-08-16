/**
 * CutPlan -> exported media via ffmpeg trim/atrim + concat.
 * The filtergraph is always written to a temp file and passed with
 * -filter_complex_script (contract: Windows command-line length limit).
 * Precise cutting requires re-encoding (contract: never stream-copy cuts).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeMedia, runFfmpeg } from "./ffmpeg.js";
import type { CutPlan, CutReport, ExportOptions, ExportResult } from "./types.js";

/** Build the filtergraph text for the kept segments. */
export function buildFilterScript(
  keepSegments: [number, number][],
  opts: { video: boolean; audio: boolean },
): string {
  if (keepSegments.length === 0) throw new Error("Nothing to keep: keepSegments is empty");
  if (!opts.video && !opts.audio) throw new Error("At least one of video/audio required");

  const lines: string[] = [];
  const concatInputs: string[] = [];
  keepSegments.forEach(([s, e], i) => {
    if (opts.video) {
      lines.push(`[0:v]trim=start=${fmt(s)}:end=${fmt(e)},setpts=PTS-STARTPTS[v${i}]`);
    }
    if (opts.audio) {
      lines.push(`[0:a]atrim=start=${fmt(s)}:end=${fmt(e)},asetpts=PTS-STARTPTS[a${i}]`);
    }
    concatInputs.push(
      opts.video && opts.audio ? `[v${i}][a${i}]` : opts.video ? `[v${i}]` : `[a${i}]`,
    );
  });
  const n = keepSegments.length;
  const v = opts.video ? 1 : 0;
  const a = opts.audio ? 1 : 0;
  const outs = `${opts.video ? "[vout]" : ""}${opts.audio ? "[aout]" : ""}`;
  lines.push(`${concatInputs.join("")}concat=n=${n}:v=${v}:a=${a}${outs}`);
  return lines.join(";\n");
}

function fmt(sec: number): string {
  return sec.toFixed(3);
}

/** Execute the export described by plan + options. */
export async function exportCut(plan: CutPlan, opts: ExportOptions): Promise<ExportResult> {
  const started = Date.now();
  const { input, keepSegments } = plan;
  if (!opts.output && !opts.audioOutput) {
    throw new Error("Provide output and/or audioOutput");
  }
  const hasVideo = Boolean(input.video);
  const hasAudio = Boolean(input.audio);
  if (!hasAudio) throw new Error("Input has no audio track; nothing to cut by");
  const expected = plan.stats.outputDuration;

  const tmp = mkdtempSync(join(tmpdir(), "roughcut-"));
  try {
    if (opts.output) {
      const script = buildFilterScript(keepSegments, { video: hasVideo, audio: true });
      const scriptPath = join(tmp, "graph.txt");
      writeFileSync(scriptPath, script, "utf8");

      const args = [
        "-v", "error", "-stats",
        opts.overwrite === false ? "-n" : "-y",
        "-i", input.path,
        "-filter_complex_script", scriptPath,
      ];
      if (hasVideo) {
        args.push(
          "-map", "[vout]",
          "-c:v", "libx264",
          "-crf", String(opts.crf ?? 18),
          "-preset", opts.preset ?? "veryfast",
          "-pix_fmt", "yuv420p",
        );
      }
      args.push(
        "-map", "[aout]",
        "-c:a", "aac",
        "-b:a", opts.audioBitrate ?? "192k",
      );
      if (hasVideo) args.push("-movflags", "+faststart");
      args.push(opts.output);

      await runFfmpeg(args, {
        expectedDurationSec: expected,
        onProgress: opts.onProgress
          ? (r) => opts.onProgress!(opts.audioOutput ? r * 0.9 : r)
          : undefined,
      });
    }

    if (opts.audioOutput) {
      const script = buildFilterScript(keepSegments, { video: false, audio: true });
      const scriptPath = join(tmp, "graph-audio.txt");
      writeFileSync(scriptPath, script, "utf8");
      const lower = opts.audioOutput.toLowerCase();
      const codecArgs = lower.endsWith(".wav")
        ? ["-c:a", "pcm_s16le"]
        : lower.endsWith(".flac")
          ? ["-c:a", "flac"]
          : ["-c:a", "aac", "-b:a", opts.audioBitrate ?? "192k"];
      await runFfmpeg(
        [
          "-v", "error", "-stats",
          opts.overwrite === false ? "-n" : "-y",
          "-i", input.path,
          "-filter_complex_script", scriptPath,
          "-map", "[aout]",
          ...codecArgs,
          opts.audioOutput,
        ],
        {
          expectedDurationSec: expected,
          onProgress: opts.onProgress
            ? (r) => opts.onProgress!(opts.output ? 0.9 + r * 0.1 : r)
            : undefined,
        },
      );
    }

    let outputDurationSec: number | null = null;
    const primary = opts.output ?? opts.audioOutput;
    if (primary) {
      try {
        outputDurationSec = (await probeMedia(primary)).durationSec;
      } catch {
        outputDurationSec = null;
      }
    }

    return {
      output: opts.output ?? null,
      audioOutput: opts.audioOutput ?? null,
      outputDurationSec,
      elapsedMs: Date.now() - started,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Assemble the report written next to exports. */
export function buildReport(plan: CutPlan, result: ExportResult): CutReport {
  return {
    ...plan,
    export: {
      output: result.output,
      audioOutput: result.audioOutput,
      outputDurationSec: result.outputDurationSec,
      expectedDurationSec: plan.stats.outputDuration,
      elapsedMs: result.elapsedMs,
    },
  };
}
