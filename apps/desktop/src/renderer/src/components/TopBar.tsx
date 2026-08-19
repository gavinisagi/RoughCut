import { useStore } from "../store";
import { basename, fmtTime } from "../util";

export function TopBar() {
  const session = useStore((s) => s.session);
  const plan = useStore((s) => s.plan);
  const importVideo = useStore((s) => s.importVideo);
  const savePlan = useStore((s) => s.savePlan);
  const setExportState = useStore((s) => s.setExportState);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const loading = useStore((s) => s.loading);

  const media = session?.media;
  return (
    <header className="topbar">
      <div className="logo">
        Rough<span className="logo-accent">Cut</span>
      </div>
      <div className="file-info">
        {media ? (
          <>
            <span className="file-name">{basename(media.path)}</span>
            <span className="file-meta">
              {media.video ? `${media.video.width}x${media.video.height} · ` : "纯音频 · "}
              {fmtTime(media.durationSec)}
              {media.video ? ` · ${media.video.codec.toUpperCase()}` : ""}
            </span>
          </>
        ) : (
          <span className="file-meta">未导入素材</span>
        )}
      </div>
      <div className="topbar-actions">
        <button className="btn icon" title="设置" onClick={() => setSettingsOpen(true)}>
          ⚙
        </button>
        <button className="btn" onClick={() => void importVideo()} disabled={!!loading}>
          导入视频
        </button>
        <button className="btn" onClick={() => void savePlan()} disabled={!plan}>
          保存计划
        </button>
        <button
          className="btn primary"
          disabled={!plan || plan.stats.cutCount === 0}
          onClick={() => setExportState({ open: true, done: null, error: null, ratio: 0 })}
        >
          导出成片
        </button>
      </div>
    </header>
  );
}
