import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { fmtTime } from "../util";

export function VideoPane() {
  const videoUrl = useStore((s) => s.videoUrl);
  const session = useStore((s) => s.session);
  const playhead = useStore((s) => s.playhead);
  const playMode = useStore((s) => s.playMode);
  const plan = useStore((s) => s.plan);
  const playCompact = useStore((s) => s.playCompact);
  const playRaw = useStore((s) => s.playRaw);
  const stopPlayback = useStore((s) => s.stopPlayback);
  const jumpCut = useStore((s) => s.jumpCut);
  const videoRef = useRef<HTMLVideoElement>(null);

  const playing = playMode !== "idle";

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
  }, [playhead, playing]);

  const proxyPending = session?.proxyPending && !videoUrl;

  return (
    <section className="video-pane panel">
      <div className="video-frame">
        {videoUrl ? (
          <video ref={videoRef} src={videoUrl} muted playsInline preload="auto" />
        ) : (
          <div className="video-placeholder">
            {proxyPending ? "源视频为 HEVC，正在生成预览代理 …（不影响分析与试听）" : "无画面（纯音频素材）"}
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
