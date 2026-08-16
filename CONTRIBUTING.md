# Contributing to RoughCut

Thanks for your interest! RoughCut is a focused tool — precise, parameterized pause-tightening for talking-head videos — and contributions that sharpen that focus are the most welcome.

## Dev setup

```bash
# Prereqs: Node >= 20, ffmpeg + ffprobe on PATH
npm install
npm run build        # builds @roughcut/core and @roughcut/cli
npm test             # core unit tests
npm run test:e2e     # CLI e2e (synthesizes test media with ffmpeg)
npm run dev:desktop  # Electron GUI with HMR
```

In China, set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` before `npm install`.

## Project layout & docs contract

This repo follows a four-document convention (see [CLAUDE.md](CLAUDE.md)):

| File | Role |
|---|---|
| `CLAUDE.md` | Stable engineering contract & invariants — read this first |
| `docs/PRD.md` | Product rationale + append-only decision log (D001, D002, …) |
| `docs/DESIGN.md` | Architecture & algorithms, kept in sync with the code |
| `docs/STATUS.md` | Done / In Progress / Backlog board |

Adding a feature: append the decision to `docs/PRD.md`, register it in `docs/STATUS.md`, then implement. Changing an invariant listed in `CLAUDE.md` (e.g. the CutPlan schema) needs a schemaVersion bump and explicit discussion.

## Rules of the road

- **Times are seconds (float) everywhere.** No frame alignment outside the export layer.
- **detect/plan stay pure** (no IO) — that's what makes instant re-planning and unit testing possible.
- All ffmpeg calls go through `packages/core/src/ffmpeg.ts`.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- Code comments in English; user-facing docs bilingual (EN + zh-CN) when reasonable.
- `npm run typecheck && npm test && npm run test:e2e` must pass before a PR.

## Good first contributions

Check the Backlog in [docs/STATUS.md](docs/STATUS.md) — adaptive threshold, NVENC export, batch queue, keyboard shortcuts, cut-boundary dragging are all scoped and waiting.
