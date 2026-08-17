import { useCallback, useEffect, useRef, useState } from "react";
import { thumbAt, useStore } from "../store";
import { fmtTime } from "../util";

export function VideoPane() {
  const videoUrl = useStore((s) => s.videoUrl);
  const session = useStore((s) => s.session);
  const proxyProgress = useStore((s) => s.proxyProgress);
  const thumbs = useStore((s) => s.thumbs);
  const playhead = useStore((s) => s.playhead);
  const playMode = useStore((s) => s.playMode);
  const plan = useStore((s) => s.plan);
  const playCompact = useStore((s) => s.playCompact);
  const playRaw = useStore((s) => s.playRaw);
  const stopPlayback = useStore((s) => s.stopPlayback);
  const jumpCut = useStore((s) => s.jumpCut);
  const videoFailed = useStore((s) => s.videoFailed);
  const videoRef = useRef<HTMLVideoElement>(null);
  const thumbCanvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const playing = playMode !== "idle";

  // True only while the <video> is showing the frame we asked for. During
  // seeks / loading, the thumbnail canvas underneath provides instant
  // (low-res) feedback — the NLE trick: motion first, fidelity a beat later.
  const [videoLive, setVideoLive] = useState(false);

  // The <video> is a muted follower of the audio engine's playhead.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      if (Math.abs(v.currentTime - playhead) > 0.35) v.currentTime = playhead;
      if (v.paused) void v.play().catch(() => undefined);
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - playhead) > 0.05) v.currentTime = playhead;
    }
  }, [playhead, playing, videoUrl]);

  // Draw the nearest thumbnail (letterboxed) whenever the playhead moves.
  const drawThumb = useCallback(() => {
    const canvas = thumbCanvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const bmp = thumbAt(thumbs, playhead);
    const dpr = window.devicePixelRatio || 1;
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    if (!bmp) return;
    const scale = Math.min(w / bmp.width, h / bmp.height);
    const dw = bmp.width * scale;
    const dh = bmp.height * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }, [thumbs, playhead]);

  useEffect(() => {
    drawThumb();
  }, [drawThumb]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const ro = new ResizeObserver(() => drawThumb());
    ro.observe(frame);
    return () => ro.disconnect();
  }, [drawThumb]);

  const hasVideoTrack = Boolean(session?.media.video);
  const showPlaceholder = !videoUrl && !thumbs;

  return (
    <section className="video-pane panel">
      <div className="video-frame" ref={frameRef}>
        <canvas ref={thumbCanvasRef} className="thumb-canvas" />
        {videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            muted
            playsInline
            preload="auto"
            style={{ opacity: videoLive ? 1 : 0 }}
            onLoadStart={() => setVideoLive(false)}
            onLoadedData={() => setVideoLive(true)}
            onSeeking={() => setVideoLive(false)}
            onSeeked={() => setVideoLive(true)}
            onPlaying={() => setVideoLive(true)}
            onError={() => {
              setVideoLive(false);
              videoFailed();
            }}
          />
        )}
        {showPlaceholder && (
          <div className="video-placeholder">
            {hasVideoTrack ? (
              <>
                <p>源视频为 {session?.media.video?.codec.toUpperCase()}，本机无法直接解码</p>
                <p>
                  正在生成预览代理
                  {proxyProgress !== null ? ` ${Math.round(proxyProgress * 100)}%` : ""} …
                </p>
                <p className="dim-note">分析、试听与导出不受影响，可先调参数</p>
              </>
            ) : (
              "无画面（纯音频素材）"
            )}
          </div>
        )}
      </div>
      <div className="transport">
        <div className="timecode">
          {fmtTime(playhead)}
          <span className="timecode-dim"> / {fmtTime(session?.media.durationSec ?? 0)}</span>
        </div>
        <div className="transport-buttons">
          <button className="btn icon" title="上一切点 (Alt+←)" onClick={() => jumpCut(-1)}>
            ⏮
          </button>
          {playing ? (
            <button className="btn icon accent" title="停止 (空格)" onClick={stopPlayback}>
              ⏹
            </button>
          ) : (
            <button
              className="btn icon accent"
              title="紧凑预览：按剪辑计划无缝播放 (空格)"
              onClick={() => playCompact()}
              disabled={!plan}
            >
              ▶
            </button>
          )}
          <button className="btn icon" title="下一切点 (Alt+→)" onClick={() => jumpCut(1)}>
            ⏭
          </button>
        </div>
        <div className="transport-right">
          <button
            className="btn small"
            onClick={() => (playMode === "raw" ? stopPlayback() : playRaw())}
            title="播放未剪辑的原始素材"
          >
            {playMode === "raw" ? "停止原片" : "播放原片"}
          </button>
          <span className={`mode-chip ${playMode}`}>
            {playMode === "compact"
              ? "紧凑预览中"
              : playMode === "cut"
                ? "切点试听中"
                : playMode === "raw"
                  ? "原片播放中"
                  : "就绪"}
          </span>
        </div>
      </div>
    </section>
  );
}
