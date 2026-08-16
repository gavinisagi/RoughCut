/**
 * Gapless playback of arbitrary [start,end] ranges of the source audio via
 * Web Audio scheduling. This is what makes "compact preview without export"
 * possible: each kept segment becomes one AudioBufferSourceNode, scheduled
 * back to back with sample accuracy.
 */

export interface PlayCallbacks {
  /** Called every animation frame with the current position in ORIGINAL time. */
  onTime?: (originalSec: number) => void;
  onEnd?: () => void;
}

export class PreviewEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private raf = 0;
  private playing = false;

  get isPlaying(): boolean {
    return this.playing;
  }

  get ready(): boolean {
    return this.buffer !== null;
  }

  async load(data: ArrayBuffer): Promise<void> {
    this.stop();
    this.ctx ??= new AudioContext();
    // decodeAudioData detaches the buffer; copy so the caller's data survives.
    this.buffer = await this.ctx.decodeAudioData(data.slice(0));
  }

  unload(): void {
    this.stop();
    this.buffer = null;
  }

  /**
   * Play the given original-time ranges seamlessly in order.
   * Ranges must be sorted, non-overlapping, within buffer duration.
   */
  play(ranges: [number, number][], cbs: PlayCallbacks = {}): void {
    if (!this.ctx || !this.buffer) return;
    this.stop();
    const ctx = this.ctx;
    void ctx.resume();

    const clean = ranges
      .map(([s, e]) => [Math.max(0, s), Math.min(this.buffer!.duration, e)] as [number, number])
      .filter(([s, e]) => e - s > 0.005);
    if (clean.length === 0) {
      cbs.onEnd?.();
      return;
    }

    const t0 = ctx.currentTime + 0.06;
    // compactStart[i] = compact-time offset at which range i begins.
    const compactStart: number[] = [];
    let acc = 0;
    for (const [s, e] of clean) {
      compactStart.push(acc);
      acc += e - s;
    }
    const totalCompact = acc;

    this.playing = true;
    for (let i = 0; i < clean.length; i++) {
      const [s, e] = clean[i];
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(ctx.destination);
      src.start(t0 + compactStart[i], s, e - s);
      this.sources.push(src);
    }

    const tick = () => {
      if (!this.playing) return;
      const el = ctx.currentTime - t0;
      if (el >= totalCompact) {
        const last = clean[clean.length - 1];
        cbs.onTime?.(last[1]);
        this.stopInternal();
        cbs.onEnd?.();
        return;
      }
      if (el >= 0) {
        // Find the active range (linear scan is fine: few hundred max).
        let idx = 0;
        while (idx + 1 < clean.length && compactStart[idx + 1] <= el) idx++;
        const orig = clean[idx][0] + (el - compactStart[idx]);
        cbs.onTime?.(orig);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.stopInternal();
  }

  private stopInternal(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const src of this.sources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // already stopped
      }
    }
    this.sources = [];
  }
}

export const engine = new PreviewEngine();

/** Intersect keep-segments with a [from, to] window (for cut auditioning). */
export function clipRanges(
  segments: [number, number][],
  from: number,
  to: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of segments) {
    const cs = Math.max(s, from);
    const ce = Math.min(e, to);
    if (ce - cs > 0.005) out.push([cs, ce]);
  }
  return out;
}

/** Keep-segments from a given original time onward. */
export function rangesFrom(segments: [number, number][], from: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of segments) {
    if (e <= from) continue;
    out.push([Math.max(s, from), e]);
  }
  return out;
}
