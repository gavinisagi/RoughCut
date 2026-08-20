# RoughCut

**One-click rough cut for talking-head videos.** Detect every pause, tighten each one to an exact target gap (0.2s / 0.3s / 0.5s — you decide the rhythm), audition every cut, preview the whole thing without exporting, then export. Done.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen.svg)](https://nodejs.org)
[![GUI](https://img.shields.io/badge/GUI-Windows%20(Electron)-0078d4.svg)](#desktop-app)
[![CLI](https://img.shields.io/badge/CLI-cross--platform-lightgrey.svg)](#cli)

[中文文档 →](README.zh-CN.md)

![RoughCut main window](docs/design/screenshot-app.png)

![Transcript review mode](docs/design/screenshot-review.png)

## Why

If you record teleprompter-driven talking-head videos, your pauses are all over the place — some short, some painfully long, some "brain froze for two seconds" moments. Editors' built-in silence removal gets the gaps wrong and gives you little control over the resulting rhythm, so you end up nudging waveforms cut by cut, fifty times per five-minute clip.

RoughCut does exactly one thing, precisely: it makes every pause in your monologue **exactly as long as you want**, straight from the audio waveform. The output goes into CapCut / Jianying / Resolve as your new raw footage for the creative pass (subtitles, BGM, color).

## Features & roadmap

### ✅ Done

**Rough cutting (v0.1)**
- ⚡ One-click pause tightening — RMS-based detection; every pause longer than the target gap is shrunk to exactly that gap of original room tone
- 🎛️ Rhythm as a parameter — target gap / minimum pause / silence threshold / head-tail padding, all re-planning instantly as you drag
- 👂 Audition before export — per-cut transition preview (±1.2s) and gapless compact preview of the whole video via Web Audio, *no export needed*
- ✅ Vetoable cuts — un-check any single cut, everything downstream recomputes
- 📤 Clean exports — H.264 MP4 (CRF configurable) + optional WAV + JSON cut report
- 🖥️ GUI + CLI on one engine, sharing the same plan JSON contract (offline, no cloud)

**Preview engine (v0.1.x)**
- 🎞️ NLE-style instant preview — click anywhere, see that frame now: thumbnail layer first, sharp frame right after; filmstrip above the waveform
- 🚀 4K / HEVC handled — hardware-decode probing, seek-instant low-res proxy with progress, original always used for export

**Transcript & AI review (v0.2)**
- 📝 Local whisper.cpp transcription, aligned to detected speech segments
- 🤖 AI review flags retakes / repetitions / broken takes — any OpenAI-compatible LLM (DeepSeek, Qwen, Ollama, ...), with an offline similarity rule as zero-config fallback
- 🗑️ One-click apply: dropped segments merge with surrounding pauses and land at exactly the target gap; dense review list with filters and per-segment audition

### ⬜ Planned

- Adaptive silence threshold (no manual dB tuning)
- NVENC / QSV hardware-encoded export
- Batch queue (multiple files)
- CapCut/Jianying draft project export (feasibility research)
- Windows installer packaging (currently runs from source)
- macOS / Linux GUI verification (CLI is already cross-platform)
- Draggable cut boundaries, more keyboard shortcuts (JKL)
- Waveform rendering optimizations for very long footage (>30 min)

The finer-grained development board lives in [docs/STATUS.md](docs/STATUS.md).

## Requirements

- **Node.js ≥ 20**
- **FFmpeg** (with ffprobe) on your `PATH`, or point `ROUGHCUT_FFMPEG` at the binary / its folder
  - Windows: `winget install Gyan.FFmpeg` or `scoop install ffmpeg`
  - macOS: `brew install ffmpeg` · Linux: your package manager
- *(optional, transcription only)* **whisper.cpp**: put `whisper-cli` on PATH (or set `ROUGHCUT_WHISPER`) and download a [ggml model](https://huggingface.co/ggerganov/whisper.cpp) (e.g. `ggml-large-v3-turbo.bin`), referenced via `ROUGHCUT_WHISPER_MODEL` or the GUI settings

## Getting started

```bash
git clone https://github.com/gavinisagi/RoughCut.git
cd RoughCut
npm install
npm run build
```

### Desktop app

```bash
npm run dev:desktop
```

Import a clip (button or drag & drop) → tweak the target gap → audition cuts → export.

| Shortcut | Action |
|---|---|
| `Space` | Compact preview / stop |
| `Alt+←` / `Alt+→` | Previous / next cut, auto-audition |
| Mouse wheel on waveform | Zoom (anchored at cursor) |
| Drag on waveform | Pan |
| Click on waveform | Seek (clicking a red region selects that cut) |

Sources Chromium can't decode (e.g. HEVC without hardware support) preview through an auto-generated proxy with progress shown; >1080p sources also play through a small seek-instant proxy. Analysis and export always use the original file.

### CLI

```bash
# What would be cut?
node packages/cli/bin/roughcut.js analyze input.mp4 --target-gap 0.3

# Cut it
node packages/cli/bin/roughcut.js cut input.mp4 -o output.mp4 --audio output.wav

# JSON all the way
node packages/cli/bin/roughcut.js analyze input.mp4 --json > plan.json
#   ...hand-edit "enabled": false on any cut you veto...
node packages/cli/bin/roughcut.js cut input.mp4 -o output.mp4 --plan plan.json
```

Transcribe + review + cut in one pipeline:

```bash
# Transcribe segments, review them (LLM if ROUGHCUT_LLM_* is set, else similarity rule)
node packages/cli/bin/roughcut.js transcribe input.mp4 --review -o plan.json
# Inspect the recommendations, then cut with the drops applied
node packages/cli/bin/roughcut.js cut input.mp4 -o output.mp4 --plan plan.json --apply-review
```

LLM config: `--llm-base-url/--llm-key/--llm-model` or env `ROUGHCUT_LLM_BASE_URL/KEY/MODEL` (any OpenAI-compatible endpoint).

`npm link -w @roughcut/cli` puts a global `roughcut` command on your PATH.

| Option | Default | Meaning |
|---|---|---|
| `--target-gap` | `0.3` | Pause length after cutting, seconds |
| `--min-silence` | `0.45` | Shortest silence treated as a pause |
| `--threshold` | `-38` | Silence threshold in dBFS (also `--threshold=-38`) |
| `--pad-before` | `0.06` | Gap share kept before the next phrase (protects onsets) |
| `--pad-after` | `0.15` | Gap share kept after the previous phrase (protects tails) |
| `--crf` / `--preset` | `18` / `veryfast` | x264 quality / speed |
| `--audio PATH` | — | Also export standalone audio (.wav / .m4a / .flac) |
| `--plan PATH` | — | Execute a saved/edited plan instead of detecting |
| `--report PATH` | `<out>.report.json` | Where to write the cut report |
| `--dry-run` / `--json` | — | Plan only / machine-readable output |

## How it works

1. FFmpeg decodes the audio to 16 kHz mono PCM; RoughCut computes RMS frames (20ms window / 10ms hop) and waveform peaks from the same data — what you see is what gets cut.
2. Silence runs ≥ *min-silence* below the *threshold* become pauses; each pause longer than *target-gap* yields one cut that leaves **exactly target-gap** of original room tone (≥ *pad-after* hugging the previous phrase, ≥ *pad-before* before the next — no inserted digital silence, no clipped syllables).
3. Kept segments are assembled with an FFmpeg `trim/atrim + concat` filtergraph in a single re-encode (millisecond-accurate). The graph is passed via a script file, so hundreds of cuts are fine on Windows.
4. The report JSON (same schema as the plan) records every pause, every removed interval, and the before/after durations.

Details in [docs/DESIGN.md](docs/DESIGN.md); product rationale and the decision log in [docs/PRD.md](docs/PRD.md).

## Development

```
packages/core     engine: probe / analyze / detect / plan / export   (zero runtime deps)
packages/cli      roughcut CLI                                       (zero deps, uses core)
apps/desktop      Electron + React GUI                               (electron-vite)
```

```bash
npm test          # core unit tests (Vitest)
npm run test:e2e  # CLI end-to-end against synthesized media (needs ffmpeg)
npm run dev:desktop
npm run typecheck
```

GUI regression checks (synthesize a clip with known pauses, auto-import, screenshot / burst-capture during playback):

```bash
node scripts/make-sample.mjs sample.mp4   # tone-burst clip for e2e (deterministic)
node scripts/make-demo.mjs demo.mp4       # studio-style frame + Windows TTS speech with a retake
cd apps/desktop
npm run build
npx electron . --smoke ../../demo.mp4                 # static screenshot -> smoke.png
npx electron . --smoke ../../demo.mp4 --smoke-play    # 8-frame playback burst -> smoke-play-XX.png
```

## Troubleshooting

- **"ffmpeg not found"** — install FFmpeg and reopen the terminal, or set `ROUGHCUT_FFMPEG` to the ffmpeg binary or its folder.
- **Electron download is slow (China)** — `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` before `npm install`.
- **HEVC preview** — plays directly when the GPU can decode it; otherwise a proxy builds in the background (progress shown). Analysis, audition and export never wait for it.

Roadmap lives in [docs/STATUS.md](docs/STATUS.md). Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). FFmpeg is a separate runtime dependency installed by the user and licensed under its own terms.
