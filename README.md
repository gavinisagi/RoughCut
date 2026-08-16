# RoughCut

**One-click rough cut for talking-head videos** — detect every pause, tighten each one to an exact target gap (0.2s / 0.3s / 0.5s — you decide the rhythm), audition every cut, export, done.

[中文文档 →](README.zh-CN.md)

![RoughCut main window](docs/design/screenshot-app.png)

## Why

If you record teleprompter-driven talking-head videos, your pauses are all over the place — some short, some painfully long, some "brain froze for two seconds" moments. Editors' built-in silence removal tools get the gaps wrong and give you little control over the resulting rhythm, so you end up nudging waveforms cut by cut, fifty times per five-minute clip.

RoughCut does exactly one thing precisely: it makes every pause in your monologue **exactly as long as you want**, straight from the audio waveform. The output goes into CapCut / Jianying / Resolve as your new raw footage for the creative pass.

## Features

- ⚡ **One-click tightening** — RMS-based pause detection over the audio track; every pause longer than the target gap is shrunk to exactly that gap
- 🎛️ **Rhythm as a parameter** — target gap, minimum pause, silence threshold, head/tail padding; parameters re-plan instantly, no re-analysis
- 👂 **Audition before export** — click any cut chip to hear the post-cut transition (1.2s around the cut); play the whole video compactly (gapless Web Audio scheduling) *without exporting first*
- ✅ **Vetoable cuts** — detection got one wrong? Un-check that single cut, everything recomputes
- 📤 **Clean exports** — H.264 MP4 (CRF configurable) + optional WAV + a JSON cut report of exactly what was removed
- 🖥️ **GUI + CLI, one engine** — Electron desktop app for the audition workflow, cross-platform CLI for scripting; both share the same core and the same plan JSON contract
- 🔌 **No cloud, no models** — pure signal energy analysis over FFmpeg; fast and fully offline

## Requirements

- **Node.js ≥ 20**
- **FFmpeg** on your `PATH` (or point `ROUGHCUT_FFMPEG` at the binary / its folder)
  - Windows: `winget install Gyan.FFmpeg` or `scoop install ffmpeg`
  - macOS: `brew install ffmpeg` · Linux: your package manager

## Getting started

```bash
git clone https://github.com/YOUR_NAME/roughcut.git
cd roughcut
npm install
npm run build
```

### Desktop app (Windows-first, Electron)

```bash
npm run dev:desktop
```

Import a clip (button or drag & drop) → tweak the target gap → audition cuts (`Space` = compact preview, `Alt+←/→` = jump between cuts) → Export.

> HEVC/H.265 sources preview through an auto-generated H.264 proxy; analysis, audition and export always use the original file.

### CLI

```bash
# What would be cut?
node packages/cli/bin/roughcut.js analyze input.mp4 --target-gap 0.3

# Cut it
node packages/cli/bin/roughcut.js cut input.mp4 -o output.mp4 --audio output.wav

# Machine-readable everything
node packages/cli/bin/roughcut.js analyze input.mp4 --json > plan.json
# ... hand-edit "enabled" flags in plan.json if you like ...
node packages/cli/bin/roughcut.js cut input.mp4 -o output.mp4 --plan plan.json
```

`npm link -w @roughcut/cli` puts `roughcut` on your PATH.

Key options (defaults): `--target-gap 0.3` · `--min-silence 0.45` · `--threshold -38` (dBFS, also `--threshold=-38`) · `--pad-before 0.06` · `--pad-after 0.15` · `--crf 18` · `--dry-run` · `--json`

## How it works

1. FFmpeg decodes the audio to 16 kHz mono PCM; RoughCut computes RMS frames (20ms window / 10ms hop) and waveform peaks from the same data — what you see is what gets cut.
2. Silence runs ≥ *min-silence* below the *threshold* become pauses; each pause longer than *target-gap* yields a cut that leaves **exactly target-gap** of original room tone (≥ *pad-after* hugging the previous phrase, ≥ *pad-before* before the next one — no inserted digital silence, no clipped syllables).
3. Kept segments are assembled with an FFmpeg `trim/atrim + concat` filtergraph (single re-encode, millisecond-accurate) — the graph is passed via script file, so hundreds of cuts are fine on Windows.
4. The report JSON (= the plan, same schema) records every pause, every removed interval and the before/after durations.

Details in [docs/DESIGN.md](docs/DESIGN.md); product rationale in [docs/PRD.md](docs/PRD.md).

## Development

```
packages/core     engine: probe / analyze / detect / plan / export  (zero runtime deps)
packages/cli      roughcut CLI                                      (zero deps, uses core)
apps/desktop      Electron + React GUI                              (electron-vite)
```

```bash
npm test          # core unit tests (Vitest)
npm run test:e2e  # CLI end-to-end against synthesized media (needs ffmpeg)
npm run dev:desktop
npm run typecheck
```

GUI smoke test (auto-imports a clip, waits for analysis, screenshots, exits):

```bash
node scripts/make-sample.mjs sample.mp4
cd apps/desktop && npm run build && npx electron . --smoke ../../sample.mp4
```

Roadmap lives in [docs/STATUS.md](docs/STATUS.md). Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). FFmpeg is a separate runtime dependency installed by the user and is licensed under its own terms.
