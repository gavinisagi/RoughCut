import { useEffect } from "react";
import { useStore } from "./store";
import { TopBar } from "./components/TopBar";
import { VideoPane } from "./components/VideoPane";
import { ParamsPanel } from "./components/ParamsPanel";
import { Timeline } from "./components/Timeline";
import { ExportDialog } from "./components/ExportDialog";

export function App() {
  const session = useStore((s) => s.session);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const dismissError = useStore((s) => s.dismissError);
  const exportOpen = useStore((s) => s.exportState.open);

  useEffect(() => {
    const offProxy = window.roughcut.onProxyReady((url) => {
      useStore.getState().proxyReady(url);
    });
    const offProgress = window.roughcut.onProxyProgress((ratio) => {
      useStore.getState().setProxyProgress(ratio);
    });
    const offThumbs = window.roughcut.onThumbsReady((thumbs) => {
      void useStore.getState().thumbsReady(thumbs);
    });
    const offSmokePlay = window.roughcut.onSmokePlay(() => {
      useStore.getState().playCompact(0);
    });
    const offSmoke = window.roughcut.onSmokeOpen((path) => {
      void (async () => {
        await useStore.getState().openPath(path);
        // Wait for the filmstrip so the screenshot exercises the full UI.
        const t0 = Date.now();
        while (
          useStore.getState().session?.media.video &&
          !useStore.getState().thumbs &&
          Date.now() - t0 < 15_000
        ) {
          await new Promise((r) => setTimeout(r, 200));
        }
        await window.roughcut.smokeDone();
      })();
    });
    return () => {
      offProxy();
      offProgress();
      offThumbs();
      offSmoke();
      offSmokePlay();
    };
  }, []);

  // Keyboard: space = compact preview / stop, arrows = cut navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const st = useStore.getState();
      if (e.code === "Space") {
        e.preventDefault();
        if (st.playMode === "idle") st.playCompact();
        else st.stopPlayback();
      } else if (e.code === "ArrowRight" && e.altKey) {
        st.jumpCut(1);
      } else if (e.code === "ArrowLeft" && e.altKey) {
        st.jumpCut(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      {error && (
        <div className="banner error">
          <span>{error}</span>
          <button onClick={dismissError}>关闭</button>
        </div>
      )}
      {loading && <div className="banner loading">{loading}</div>}
      {session ? (
        <>
          <div className="main-row">
            <VideoPane />
            <ParamsPanel />
          </div>
          <Timeline />
        </>
      ) : (
        <EmptyState />
      )}
      {exportOpen && <ExportDialog />}
    </div>
  );
}

function EmptyState() {
  const importVideo = useStore((s) => s.importVideo);
  const loading = useStore((s) => s.loading);
  return (
    <div
      className="empty-state"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (!file) return;
        const path = window.roughcut.getPathForFile(file);
        if (path) void useStore.getState().openPath(path);
      }}
    >
      <div className="empty-card">
        <div className="empty-logo">RoughCut</div>
        <p className="empty-sub">口播视频一键粗剪 — 自动把停顿收紧到目标节奏</p>
        <button className="btn primary big" onClick={() => void importVideo()} disabled={!!loading}>
          导入视频
        </button>
        <p className="empty-hint">或将视频文件拖拽到此处 · 支持 mp4 / mov / mkv / 音频文件</p>
        <ol className="empty-steps">
          <li>导入 Pocket 拍摄的口播原片</li>
          <li>调整目标间隔（默认 0.3 秒）</li>
          <li>逐切点试听衔接，全片紧凑预览</li>
          <li>导出成片进剪映二次创作</li>
        </ol>
      </div>
    </div>
  );
}
