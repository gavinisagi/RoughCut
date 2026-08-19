import { readFileSync, writeFileSync } from "node:fs";
import {
  DEFAULT_PARAMS,
  type AnalysisParams,
  type CutPlan,
  type LlmConfig,
  type Transcript,
  alignTranscript,
  analyzeFile,
  applyVerdicts,
  assertPlan,
  buildReport,
  detectPauses,
  exportCut,
  extractSpeechSegments,
  llmReview,
  normalizePlan,
  probeMedia,
  ruleReview,
  transcribeAudio,
  withTranscript,
} from "@roughcut/core";
import { num, parseArgv } from "./args.js";

const VERSION = "0.2.0";

const HELP = `roughcut ${VERSION} — one-click rough cut for talking-head videos

Usage:
  roughcut probe <input> [--json]
  roughcut analyze <input> [detection options] [--json] [-o plan.json]
  roughcut transcribe <input> [detection options] [--whisper-model PATH]
               [--language zh] [--review] [--json] [-o plan.json]
  roughcut review --plan plan.json [-o out.json] [--json]
  roughcut cut <input> -o <output.mp4> [detection options | --plan plan.json]
               [--apply-review] [--audio out.wav] [--report report.json]
               [--crf 18] [--preset veryfast] [--dry-run] [--json]

Detection options (defaults shown):
  --target-gap 0.3     pause length after cutting, seconds
  --min-silence 0.45   shortest silence treated as a pause, seconds
  --threshold -38      silence threshold in dBFS (also: --threshold=-38)
  --pad-before 0.06    min gap share kept before the next speech, seconds
  --pad-after 0.15     min gap share kept after the previous speech, seconds

Transcribe / review options:
  --whisper-model PATH ggml model file (or set ROUGHCUT_WHISPER_MODEL)
  --language zh        language code for whisper ("auto" to detect)
  --review             review segments right after transcribing
  --llm-base-url URL   OpenAI-compatible endpoint (or ROUGHCUT_LLM_BASE_URL)
  --llm-key KEY        API key (or ROUGHCUT_LLM_KEY)
  --llm-model NAME     model name (or ROUGHCUT_LLM_MODEL)
                       (without LLM config, a similarity rule detects retakes)

Cut options:
  -o, --output PATH    output video (.mp4). Omit with --audio for audio-only.
  --audio PATH         also export standalone audio (.wav / .m4a / .flac)
  --plan PATH          execute a saved plan instead of detecting
  --apply-review       treat verdict:"drop" segments as dropped before cutting
  --report PATH        write the cut report JSON (default: <output>.report.json)
  --crf N              x264 CRF (default 18)
  --preset NAME        x264 preset (default veryfast)
  --dry-run            plan only, write no media
  --json               machine-readable output on stdout

External tools: ffmpeg/ffprobe via ROUGHCUT_FFMPEG > PATH;
whisper-cli via ROUGHCUT_WHISPER > PATH (transcribe only).
`;

const BOOLEAN_FLAGS = new Set([
  "json",
  "dry-run",
  "help",
  "version",
  "quiet",
  "review",
  "apply-review",
]);

function llmConfigFrom(options: Map<string, string>): LlmConfig | null {
  const baseUrl = options.get("llm-base-url") ?? process.env.ROUGHCUT_LLM_BASE_URL;
  const apiKey = options.get("llm-key") ?? process.env.ROUGHCUT_LLM_KEY;
  const model = options.get("llm-model") ?? process.env.ROUGHCUT_LLM_MODEL;
  if (baseUrl && apiKey && model) return { baseUrl, apiKey, model };
  return null;
}

async function reviewTranscript(
  transcript: Transcript,
  options: Map<string, string>,
  log: (msg: string) => void,
): Promise<Transcript> {
  const llm = llmConfigFrom(options);
  if (llm) {
    log(`reviewing ${transcript.segments.length} segments with ${llm.model} ...`);
    const verdicts = await llmReview(transcript.segments, llm);
    return {
      ...transcript,
      reviewedBy: llm.model,
      segments: applyVerdicts(transcript.segments, verdicts),
    };
  }
  log("no LLM configured; using similarity rule (set --llm-* or ROUGHCUT_LLM_* for semantic review)");
  const verdicts = ruleReview(transcript.segments.filter((s) => s.text));
  return {
    ...transcript,
    reviewedBy: "similarity-rule",
    segments: applyVerdicts(transcript.segments, verdicts),
  };
}

function transcriptSummary(plan: CutPlan): string {
  const t = plan.transcript;
  if (!t) return "(no transcript)";
  const drops = t.segments.filter((s) => s.verdict === "drop");
  const reviews = t.segments.filter((s) => s.verdict === "review");
  const lines = [
    `segments ${t.segments.length}  (engine ${t.engine}${t.reviewedBy ? `, reviewed by ${t.reviewedBy}` : ", unreviewed"})`,
  ];
  if (t.reviewedBy) {
    lines.push(`verdicts ${drops.length} drop / ${reviews.length} review`);
  }
  for (const s of t.segments) {
    const mark =
      s.verdict === "drop" ? "DROP " : s.verdict === "review" ? "CHECK" : s.dropped ? "DEL  " : "     ";
    const text = s.text ? (s.text.length > 46 ? `${s.text.slice(0, 45)}…` : s.text) : "(no text)";
    lines.push(
      `  ${mark} #${String(s.id).padStart(3)} ${fmtTime(s.start)}-${fmtTime(s.end)}  ${text}${s.reason ? `  [${s.reason}]` : ""}`,
    );
  }
  return lines.join("\n");
}

function collectParams(options: Map<string, string>): AnalysisParams {
  return {
    targetGap: num(options, "target-gap") ?? DEFAULT_PARAMS.targetGap,
    minSilence: num(options, "min-silence") ?? DEFAULT_PARAMS.minSilence,
    thresholdDb: num(options, "threshold") ?? DEFAULT_PARAMS.thresholdDb,
    padBefore: num(options, "pad-before") ?? DEFAULT_PARAMS.padBefore,
    padAfter: num(options, "pad-after") ?? DEFAULT_PARAMS.padAfter,
  };
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

function planSummary(plan: CutPlan): string {
  const { stats } = plan;
  const lines = [
    `input    ${plan.input.path}`,
    `duration ${fmtTime(stats.originalDuration)} -> ${fmtTime(stats.outputDuration)}  (saves ${fmtTime(stats.removedDuration)})`,
    `cuts     ${stats.cutCount} enabled / ${stats.totalCuts} total`,
  ];
  for (const c of plan.cuts) {
    const mark = c.enabled ? "cut" : "off";
    lines.push(
      `  #${String(c.id).padStart(3)} ${mark}  at ${fmtTime(c.remove[0])}  removes ${c.removedDuration.toFixed(2)}s  (pause ${c.pause[0].toFixed(2)}-${c.pause[1].toFixed(2)})`,
    );
  }
  return lines.join("\n");
}

export async function main(argv: string[]): Promise<void> {
  const { positionals, options, flags } = parseArgv(argv, BOOLEAN_FLAGS);
  if (flags.has("version")) {
    console.log(VERSION);
    return;
  }
  const command = positionals[0];
  if (flags.has("help") || !command) {
    console.log(HELP);
    return;
  }
  const input = positionals[1];

  switch (command) {
    case "probe": {
      if (!input) throw new Error("probe: missing <input>");
      const media = await probeMedia(input);
      if (flags.has("json")) {
        console.log(JSON.stringify(media, null, 2));
      } else {
        const v = media.video
          ? `${media.video.codec} ${media.video.width}x${media.video.height} ${media.video.fps.toFixed(2)}fps`
          : "none";
        const a = media.audio
          ? `${media.audio.codec} ${media.audio.sampleRate}Hz ${media.audio.channels}ch`
          : "none";
        console.log(
          [
            `file     ${media.path}`,
            `format   ${media.format}`,
            `duration ${fmtTime(media.durationSec)} (${media.durationSec.toFixed(3)}s)`,
            `video    ${v}`,
            `audio    ${a}`,
          ].join("\n"),
        );
      }
      return;
    }

    case "analyze": {
      if (!input) throw new Error("analyze: missing <input>");
      const params = collectParams(options);
      const { plan } = await analyzeFile(input, params);
      const out = options.get("output");
      if (out) {
        writeFileSync(out, JSON.stringify(plan, null, 2), "utf8");
        if (!flags.has("json")) console.error(`plan written to ${out}`);
      }
      console.log(flags.has("json") ? JSON.stringify(plan, null, 2) : planSummary(plan));
      return;
    }

    case "transcribe": {
      if (!input) throw new Error("transcribe: missing <input>");
      const params = collectParams(options);
      const log = (msg: string) => {
        if (!flags.has("json") && !flags.has("quiet")) console.error(msg);
      };
      log("analyzing audio ...");
      const { analysis, plan: basePlan } = await analyzeFile(input, params);
      const pauses = detectPauses(analysis, {
        thresholdDb: params.thresholdDb,
        minSilence: params.minSilence,
      });
      const duration = basePlan.stats.originalDuration;
      const segments = extractSpeechSegments(pauses, duration);
      log(`transcribing ${segments.length} segments with whisper ...`);
      let lastPct = -1;
      const asr = await transcribeAudio(input, {
        model: options.get("whisper-model"),
        language: options.get("language") ?? "auto",
        onProgress: (r) => {
          const pct = Math.floor(r * 100);
          if (pct !== lastPct && !flags.has("json") && !flags.has("quiet")) {
            lastPct = pct;
            process.stderr.write(`\rwhisper ${pct}%`);
          }
        },
      });
      if (!flags.has("json") && !flags.has("quiet")) process.stderr.write("\n");
      let transcript: Transcript = {
        engine: asr.engine,
        language: options.get("language") ?? undefined,
        reviewedBy: null,
        segments: alignTranscript(asr.segments, segments),
      };
      if (flags.has("review")) {
        transcript = await reviewTranscript(transcript, options, log);
      }
      const plan = withTranscript(basePlan, transcript);
      const out = options.get("output");
      if (out) {
        writeFileSync(out, JSON.stringify(plan, null, 2), "utf8");
        log(`plan written to ${out}`);
      }
      console.log(flags.has("json") ? JSON.stringify(plan, null, 2) : transcriptSummary(plan));
      return;
    }

    case "review": {
      const planPath = options.get("plan") ?? input;
      if (!planPath) throw new Error("review: provide --plan plan.json (a transcribed plan)");
      let plan = assertPlan(JSON.parse(readFileSync(planPath, "utf8")));
      if (!plan.transcript || plan.transcript.segments.every((s) => !s.text)) {
        throw new Error("review: the plan has no transcript text; run `roughcut transcribe` first");
      }
      const log = (msg: string) => {
        if (!flags.has("json") && !flags.has("quiet")) console.error(msg);
      };
      const transcript = await reviewTranscript(plan.transcript, options, log);
      plan = withTranscript(plan, transcript);
      const out = options.get("output") ?? planPath;
      writeFileSync(out, JSON.stringify(plan, null, 2), "utf8");
      log(`plan written to ${out}`);
      console.log(flags.has("json") ? JSON.stringify(plan, null, 2) : transcriptSummary(plan));
      return;
    }

    case "cut": {
      if (!input) throw new Error("cut: missing <input>");
      const output = options.get("output");
      const audioOutput = options.get("audio");
      const dryRun = flags.has("dry-run");
      if (!output && !audioOutput && !dryRun) {
        throw new Error("cut: provide -o <output.mp4> and/or --audio <out.wav> (or --dry-run)");
      }

      let plan: CutPlan;
      const planPath = options.get("plan");
      if (planPath) {
        // Cuts are the source of truth; recompute keepSegments/stats so a
        // hand-edited plan only needs its `enabled` flags changed.
        plan = normalizePlan(assertPlan(JSON.parse(readFileSync(planPath, "utf8"))));
        // Re-probe so the plan can be applied to a moved/renamed identical file.
        if (plan.input.path !== input) {
          const media = await probeMedia(input);
          if (Math.abs(media.durationSec - plan.input.durationSec) > 0.5) {
            throw new Error(
              `--plan was made for ${plan.input.path} (${plan.input.durationSec.toFixed(1)}s), ` +
                `but ${input} lasts ${media.durationSec.toFixed(1)}s`,
            );
          }
          plan = { ...plan, input: media };
        }
      } else {
        const params = collectParams(options);
        ({ plan } = await analyzeFile(input, params));
      }

      if (flags.has("apply-review")) {
        if (!plan.transcript) {
          throw new Error("--apply-review needs a transcribed+reviewed plan (see `roughcut transcribe --review`)");
        }
        const transcript: Transcript = {
          ...plan.transcript,
          segments: plan.transcript.segments.map((s) =>
            s.verdict === "drop" ? { ...s, dropped: true } : s,
          ),
        };
        plan = withTranscript(plan, transcript);
        const applied = transcript.segments.filter((s) => s.dropped).length;
        if (!flags.has("json") && !flags.has("quiet")) {
          console.error(`apply-review: ${applied} segment(s) marked dropped`);
        }
      }

      if (!flags.has("json") && !flags.has("quiet")) {
        console.error(planSummary(plan));
      }
      if (dryRun) {
        if (flags.has("json")) console.log(JSON.stringify(plan, null, 2));
        return;
      }

      let lastShown = -1;
      const result = await exportCut(plan, {
        output,
        audioOutput,
        crf: num(options, "crf"),
        preset: options.get("preset"),
        onProgress: (r) => {
          if (flags.has("json") || flags.has("quiet")) return;
          const pct = Math.floor(r * 100);
          if (pct !== lastShown) {
            lastShown = pct;
            process.stderr.write(`\rexporting ${pct}%`);
          }
        },
      });
      if (!flags.has("json") && !flags.has("quiet")) process.stderr.write("\n");

      const report = buildReport(plan, result);
      const reportPath =
        options.get("report") ?? (output ? `${output}.report.json` : audioOutput ? `${audioOutput}.report.json` : null);
      if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

      if (flags.has("json")) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(
          [
            result.output ? `video  -> ${result.output}` : null,
            result.audioOutput ? `audio  -> ${result.audioOutput}` : null,
            reportPath ? `report -> ${reportPath}` : null,
            `done in ${(result.elapsedMs / 1000).toFixed(1)}s` +
              (result.outputDurationSec !== null
                ? `, output ${fmtTime(result.outputDurationSec)} (expected ${fmtTime(plan.stats.outputDuration)})`
                : ""),
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      return;
    }

    default:
      throw new Error(`Unknown command "${command}". Run roughcut --help.`);
  }
}
