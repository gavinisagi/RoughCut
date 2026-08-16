import { useEffect, useState } from "react";
import { useStore } from "../store";
import { basename, fmtTime } from "../util";

export function ExportDialog() {
  const session = useStore((s) => s.session);
  const plan = useStore((s) => s.plan);
  const exportState = useStore((s) => s.exportState);
  const setExportState = useStore((s) => s.setExportState);
  const runExport = useStore((s) => s.runExport);

  const [output, setOutput] = useState("");
  const [crf, setCrf] = useState(18);
  const [preset, setPreset] = useState("veryfast");
  const [alsoAudio, setAlsoAudio] = useState(true);

  useEffect(() => {
    if (session && !output) {
      setOutput(session.media.path.replace(/\.[^.]+$/, "") + "_rough.mp4");
    }
  }, [session, output]);

  if (!session || !plan) return null;
  const { running, ratio, done, error } = exportState;

  const pickPath = async () => {
    const p = await window.roughcut.selectSavePath(output);
    if (p) setOutput(p);
  };

  const close = () => {
    if (!running) setExportState({ open: false });
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="card-title">导出成片</h3>

        {!done && (
          <>
            <div className="export-summary mono">
              {fmtTime(plan.stats.originalDuration)} → {fmtTime(plan.stats.outputDuration)} ·{" "}
              {plan.stats.cutCount} 处切点
            </div>
            <label className="field">
              <span>输出文件</span>
              <div className="path-row">
                <input value={output} onChange={(e) => setOutput(e.target.value)} spellCheck={false} />
                <button className="btn small" onClick={() => void pickPath()} disabled={running}>
                  浏览
                </button>
              </div>
            </label>
            <div className="export-options">
              <label className="field inline">
                <span>画质 CRF</span>
                <select value={crf} onChange={(e) => setCrf(Number(e.target.value))} disabled={running}>
                  <option value={16}>16 近无损（大文件）</option>
                  <option value={18}>18 推荐</option>
                  <option value={20}>20 均衡</option>
                  <option value={23}>23 较小体积</option>
                </select>
              </label>
              <label className="field inline">
                <span>编码速度</span>
                <select value={preset} onChange={(e) => setPreset(e.target.value)} disabled={running}>
                  <option value="veryfast">veryfast 推荐</option>
                  <option value="fast">fast</option>
                  <option value="medium">medium 更小体积</option>
                </select>
              </label>
              <label className="field inline checkbox">
                <input
                  type="checkbox"
                  checked={alsoAudio}
                  onChange={(e) => setAlsoAudio(e.target.checked)}
                  disabled={running}
                />
                <span>同时导出纯音频 WAV</span>
              </label>
            </div>

            {running && (
              <div className="progress">
                <div className="progress-bar" style={{ width: `${Math.round(ratio * 100)}%` }} />
                <span className="progress-text mono">{Math.round(ratio * 100)}%</span>
              </div>
            )}
            {error && <div className="banner error small">{error}</div>}

            <div className="modal-actions">
              <button className="btn" onClick={close} disabled={running}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={running || !output.trim()}
                onClick={() => void runExport({ output: output.trim(), alsoAudio, crf, preset })}
              >
                {running ? "导出中 …" : "开始导出"}
              </button>
            </div>
          </>
        )}

        {done && (
          <>
            <div className="export-done">
              <p>✅ 导出完成</p>
              <ul>
                {done.output && <li className="mono">{basename(done.output)}</li>}
                {done.audioOutput && <li className="mono">{basename(done.audioOutput)}</li>}
                {done.reportPath && <li className="mono dim">{basename(done.reportPath)}（剪辑报告）</li>}
              </ul>
              <p className="dim">可直接把成片导入剪映进行二次创作。</p>
            </div>
            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => done.output && void window.roughcut.reveal(done.output)}
              >
                打开所在文件夹
              </button>
              <button className="btn primary" onClick={() => setExportState({ open: false, done: null })}>
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
