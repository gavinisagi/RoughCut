import { useCallback, useEffect, useRef, useState } from "react";
import { thumbAt, useStore } from "../store";
import { fmtTime } from "../util";

const FILM_H = 48;

/** Colors matching the Obsidian Edit design system (docs/design). */
const C = {
  bg: "#0e0e0e",
  wave: "#2dd4bf",
  waveDim: "rgba(45,212,191,0.28)",
  removed: "rgba(239,68,68,0.16)",
  removedEdge: "rgba(239,68,68,0.65)",
  removedSel: "rgba(239,68,68,0.30)",
  // Segment (content) removals: amber, distinct from pause-red.
  segRemoved: "rgba(245,158,11,0.18)",
  segRemovedEdge: "rgba(245,158,11,0.7)",
  segRemovedSel: "rgba(245,158,11,0.32)",
  playhead: "#e5e2e1",
  grid: "#242424",
  tick: "#8c909f",
};

export function Timeline() {
  return (
    <section className="timeline panel">
      <CutChips />
      <Waveform />
    </section>
  );
}

function CutChips() {
  const plan = useStore((s) => s.plan);
  const selectedCutId = useStore((s) => s.selectedCutId);
  const playCut = useStore((s) => s.playCut);
  const toggleCut = useStore((s) => s.toggleCut);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedCutId === null) return;
    const el = listRef.current?.querySelector(`[data-cut="${selectedCutId}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [selectedCutId]);

  if (!plan) return null;
  return (
    <div className="cut-chips" ref={listRef}>
      <span className="chips-label">
        剪辑点<span className="chips-count">{plan.stats.cutCount}</span>
      </span>
      {plan.cuts.length === 0 && <span className="chips-empty">未检测到可剪停顿 — 试试调低最小停顿或调高阈值</span>}
      {plan.cuts.map((cut) => (
        <div
          key={cut.id}
          data-cut={cut.id}
          className={`chip ${selectedCutId === cut.id ? "selected" : ""} ${cut.enabled ? "" : "disabled"}`}
          onClick={() => playCut(cut.id)}
          title={`停顿 ${fmtTime(cut.pause[0])} – ${fmtTime(cut.pause[1])}，点击试听剪辑后的衔接`}
        >
          <span className="chip-id">#{cut.id}</span>
          <span className="mono">{fmtTime(cut.remove[0])}</span>
          <span className="chip-removed">-{cut.removedDuration.toFixed(1)}s</span>
          <input
            type="checkbox"
            checked={cut.enabled}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleCut(cut.id)}
            title={cut.enabled ? "禁用此切点（误切时）" : "启用此切点"}
          />
        </div>
      ))}
    </div>
  );
}

function Waveform() {
  const session = useStore((s) => s.session);
  const plan = useStore((s) => s.plan);
  const thumbs = useStore((s) => s.thumbs);
  const playhead = useStore((s) => s.playhead);
  const playMode = useStore((s) => s.playMode);
  const selectedCutId = useStore((s) => s.selectedCutId);
  const seek = useStore((s) => s.seek);
  const selectCut = useStore((s) => s.selectCut);

  const wrapRef = useRef<HTMLDivElement>(null);
  const filmRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // viewport: seconds at left edge + horizontal scale.
  const [view, setView] = useState({ start: 0, pps: 0 });
  const dragRef = useRef<{ x: number; start: number; moved: boolean } | null>(null);

  const duration = session?.media.durationSec || session?.analysisDurationSec || 0;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset viewport to fit on open/resize when unset.
  useEffect(() => {
    if (!duration || !size.w) return;
    setView((v) => {
      const fit = size.w / duration;
      if (v.pps === 0 || v.pps < fit) return { start: 0, pps: fit };
      return v;
    });
  }, [duration, size.w]);

  // Auto-follow the playhead during playback.
  useEffect(() => {
    if (playMode === "idle" || !size.w || !view.pps) return;
    const right = view.start + size.w / view.pps;
    if (playhead > right - 1 / view.pps || playhead < view.start) {
      setView((v) => ({ ...v, start: Math.max(0, playhead - 0.15 * (size.w / v.pps)) }));
    }
  }, [playhead, playMode, size.w, view.pps, view.start]);

  const drawFilm = useCallback(() => {
    const canvas = filmRef.current;
    const el = wrapRef.current;
    if (!canvas || !el) return;
    // Measure directly and fall back to the fit scale: the ResizeObserver's
    // first callback can arrive after mount effects, which used to leave the
    // timeline blank until something else forced a redraw.
    const w = size.w || el.clientWidth;
    const pps = view.pps || (duration > 0 && w > 0 ? w / duration : 0);
    const start = view.pps ? view.start : 0;
    if (!w || !pps) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr || canvas.height !== FILM_H * dpr) {
      canvas.width = w * dpr;
      canvas.height = FILM_H * dpr;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, FILM_H);
    if (!thumbs) {
      ctx.fillStyle = C.tick;
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText("画面轨生成中 …", 10, FILM_H / 2 + 4);
    }
    if (thumbs && thumbs.bitmaps.length > 0) {
      const first = thumbs.bitmaps[0];
      const tileW = Math.max(24, Math.round((FILM_H * first.width) / first.height));
      // Anchor tiles to the time grid so panning slides them smoothly.
      const gridSec = tileW / pps;
      const firstT = Math.floor(start / gridSec) * gridSec;
      for (let t = firstT; t < start + w / pps; t += gridSec) {
        const bmp = thumbAt(thumbs, t + gridSec / 2);
        if (!bmp) continue;
        const x = (t - start) * pps;
        ctx.drawImage(bmp, x, 0, tileW, FILM_H);
      }
    }
    // Playhead continues through the filmstrip.
    const px = (playhead - start) * pps;
    if (px >= 0 && px <= w) {
      ctx.strokeStyle = C.playhead;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, FILM_H);
      ctx.stroke();
    }
  }, [thumbs, playhead, size, view, duration]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const el = wrapRef.current;
    if (!canvas || !el || !session) return;
    // Same direct measurement as drawFilm (late first ResizeObserver tick).
    const w = size.w || el.clientWidth;
    const wrapH = size.h || el.clientHeight;
    const pps = view.pps || (duration > 0 && w > 0 ? w / duration : 0);
    const start = view.pps ? view.start : 0;
    if (!w || !wrapH || !pps) return;
    const dpr = window.devicePixelRatio || 1;
    const waveCanvasH = Math.max(40, wrapH - FILM_H - 1);
    if (canvas.width !== w * dpr || canvas.height !== waveCanvasH * dpr) {
      canvas.width = w * dpr;
      canvas.height = waveCanvasH * dpr;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const h = waveCanvasH;
    const rulerH = 20;
    const waveH = h - rulerH;
    const midY = rulerH + waveH / 2;
    const { peaks, hopSec } = session;
    const frameCount = peaks.length / 2;
    const cuts = plan?.cuts ?? [];

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    // Ruler.
    const stepChoices = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const targetPx = 90;
    const step = stepChoices.find((s2) => s2 * pps >= targetPx) ?? 300;
    ctx.font = "10px 'JetBrains Mono', 'Consolas', monospace";
    ctx.fillStyle = C.tick;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    const firstTick = Math.ceil(start / step) * step;
    for (let t = firstTick; t < start + w / pps; t += step) {
      const x = (t - start) * pps;
      ctx.beginPath();
      ctx.moveTo(x, rulerH);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillText(fmtTime(t), x + 3, 13);
    }

    // Removed regions (under the waveform).
    const x0 = (t: number) => (t - start) * pps;
    for (const cut of cuts) {
      if (!cut.enabled) continue;
      const rs = x0(cut.remove[0]);
      const re = x0(cut.remove[1]);
      if (re < 0 || rs > w) continue;
      const isSeg = cut.kind === "segment";
      ctx.fillStyle =
        cut.id === selectedCutId
          ? isSeg ? C.segRemovedSel : C.removedSel
          : isSeg ? C.segRemoved : C.removed;
      ctx.fillRect(rs, rulerH, re - rs, waveH);
      ctx.strokeStyle = isSeg ? C.segRemovedEdge : C.removedEdge;
      ctx.lineWidth = cut.id === selectedCutId ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(rs, rulerH);
      ctx.lineTo(rs, h);
      ctx.moveTo(re, rulerH);
      ctx.lineTo(re, h);
      ctx.stroke();
    }

    // Waveform column-by-column.
    const inRemoved = (t: number) =>
      cuts.some((c) => c.enabled && t >= c.remove[0] && t <= c.remove[1]);
    for (let x = 0; x < w; x++) {
      const t0 = start + x / pps;
      const t1 = start + (x + 1) / pps;
      let f0 = Math.floor(t0 / hopSec);
      let f1 = Math.ceil(t1 / hopSec);
      if (f1 <= 0 || f0 >= frameCount) continue;
      f0 = Math.max(0, f0);
      f1 = Math.min(frameCount, Math.max(f1, f0 + 1));
      let min = 1;
      let max = -1;
      for (let f = f0; f < f1; f++) {
        const lo = peaks[f * 2];
        const hi = peaks[f * 2 + 1];
        if (lo < min) min = lo;
        if (hi > max) max = hi;
      }
      if (max < min) continue;
      const amp = waveH * 0.46;
      const yTop = midY - max * amp;
      const yBot = midY - min * amp;
      ctx.strokeStyle = inRemoved((t0 + t1) / 2) ? C.waveDim : C.wave;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, yTop);
      ctx.lineTo(x + 0.5, Math.max(yBot, yTop + 1));
      ctx.stroke();
    }

    // Playhead.
    const px = x0(playhead);
    if (px >= 0 && px <= w) {
      ctx.strokeStyle = C.playhead;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }, [session, plan, playhead, selectedCutId, size, view, duration]);

  useEffect(() => {
    draw();
    drawFilm();
  }, [draw, drawFilm]);

  const timeAt = (clientX: number): number => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return view.start + (clientX - rect.left) / view.pps;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!duration || !size.w) return;
    const cursorT = timeAt(e.clientX);
    setView((v) => {
      const fit = size.w / duration;
      const factor = Math.pow(1.0015, -e.deltaY);
      const pps = Math.min(3000, Math.max(fit, v.pps * factor));
      const rect = wrapRef.current!.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      let start = cursorT - cursorX / pps;
      start = Math.max(0, Math.min(start, duration - size.w / pps));
      return { start, pps };
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, start: view.start, moved: false };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    if (d.moved && duration && size.w) {
      setView((v) => {
        let start = d.start - dx / v.pps;
        start = Math.max(0, Math.min(start, Math.max(0, duration - size.w / v.pps)));
        return { ...v, start };
      });
    }
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved || !session) return;
    const t = Math.max(0, Math.min(duration, timeAt(e.clientX)));
    const hit = plan?.cuts.find((c) => c.enabled && t >= c.remove[0] && t <= c.remove[1]);
    if (hit) selectCut(hit.id);
    seek(t);
  };

  return (
    <div
      ref={wrapRef}
      className="waveform-wrap"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => (dragRef.current = null)}
      title="点击定位 · 滚轮缩放 · 拖拽平移"
    >
      <canvas ref={filmRef} className="film-canvas" />
      <canvas ref={canvasRef} className="wave-canvas" />
    </div>
  );
}
