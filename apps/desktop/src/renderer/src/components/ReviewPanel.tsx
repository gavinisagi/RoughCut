import { useEffect, useState } from "react";
import { llmConfigOf, useStore } from "../store";
import { fmtTime } from "../util";

export function ReviewPanel() {
  const plan = useStore((s) => s.plan);
  const asrBusy = useStore((s) => s.asrBusy);
  const asrProgress = useStore((s) => s.asrProgress);
  const asrError = useStore((s) => s.asrError);
  const settings = useStore((s) => s.settings);
  const runTranscribe = useStore((s) => s.runTranscribe);
  const runReview = useStore((s) => s.runReview);
  const toggleSegmentDropped = useStore((s) => s.toggleSegmentDropped);
  const applyAllRecommended = useStore((s) => s.applyAllRecommended);
  const playSegment = useStore((s) => s.playSegment);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const [whisperOk, setWhisperOk] = useState<boolean | null>(null);
  useEffect(() => {
    void window.roughcut.asrAvailable().then(setWhisperOk);
  }, []);

  const transcript = plan?.transcript;
  const llm = llmConfigOf(settings);
  const drops = transcript?.segments.filter((s) => s.verdict === "drop" && !s.dropped) ?? [];
  const droppedCount = transcript?.segments.filter((s) => s.dropped).length ?? 0;

  return (
    <div className="review-panel">
      {!transcript && (
        <div className="panel card">
          <h3 className="card-title">转录与 AI 审查</h3>
          <p className="param-note">
            把每个语音段转成文字，再由 AI 判断哪些段是重说的草稿、与上下文重复或表达欠佳，推荐后一键删除。
          </p>
          {whisperOk === false && (
            <p className="review-warn">
              未找到 whisper-cli。请安装 whisper.cpp 并将其加入 PATH（或设 ROUGHCUT_WHISPER），
              下载 ggml 模型后在设置里填入路径。
            </p>
          )}
          {asrBusy === "transcribe" ? (
            <div className="progress">
              <div className="progress-bar" style={{ width: `${Math.round(asrProgress * 100)}%` }} />
              <span className="progress-text mono">转录中 {Math.round(asrProgress * 100)}%</span>
            </div>
          ) : (
            <button
              className="btn primary wide"
              disabled={!plan || whisperOk === false || asrBusy !== null}
              onClick={() => void runTranscribe()}
            >
              🎙 开始转录
            </button>
          )}
          <button className="btn small settings-link" onClick={() => setSettingsOpen(true)}>
            转录 / LLM 设置…
          </button>
        </div>
      )}

      {transcript && (
        <>
          <div className="panel card review-actions">
            <div className="review-head">
              <h3 className="card-title">段落审查</h3>
              <span className="review-meta mono">
                {transcript.segments.length} 段
                {transcript.reviewedBy ? ` · ${transcript.reviewedBy}` : ""}
              </span>
            </div>
            {asrBusy === "review" ? (
              <div className="progress">
                <div className="progress-bar indeterminate" />
                <span className="progress-text">AI 审查中 …</span>
              </div>
            ) : (
              <button
                className="btn primary wide"
                disabled={asrBusy !== null}
                onClick={() => void runReview()}
                title={llm ? `使用 ${llm.model}` : "未配置 LLM，将使用相似度规则检测重说"}
              >
                {transcript.reviewedBy ? "重新审查" : "🤖 AI 审查"}
                {llm ? "" : "（规则模式）"}
              </button>
            )}
            {!llm && (
              <button className="btn small settings-link" onClick={() => setSettingsOpen(true)}>
                配置 LLM 获得语义级审查…
              </button>
            )}
            {drops.length > 0 && (
              <button className="btn wide apply-btn" onClick={applyAllRecommended}>
                应用全部推荐（删除 {drops.length} 段）
              </button>
            )}
            {droppedCount > 0 && (
              <p className="param-note">已标记删除 {droppedCount} 段，导出时生效。</p>
            )}
          </div>

          <div className="segment-list">
            {transcript.segments.map((seg) => (
              <div
                key={seg.id}
                className={`segment-item ${seg.dropped ? "dropped" : ""} ${seg.verdict === "drop" && !seg.dropped ? "recommended" : ""}`}
              >
                <div className="segment-head">
                  <label className="segment-check" title={seg.dropped ? "恢复此段" : "删除此段"}>
                    <input
                      type="checkbox"
                      checked={seg.dropped}
                      onChange={() => toggleSegmentDropped(seg.id)}
                    />
                  </label>
                  <span className="segment-id mono">#{seg.id}</span>
                  <span className="segment-time mono">
                    {fmtTime(seg.start)}–{fmtTime(seg.end)}
                  </span>
                  {seg.verdict && (
                    <span className={`verdict ${seg.verdict}`}>
                      {seg.verdict === "drop" ? "建议删" : seg.verdict === "review" ? "存疑" : "保留"}
                    </span>
                  )}
                  <button
                    className="btn icon tiny"
                    title="试听此段"
                    onClick={() => playSegment(seg.id)}
                  >
                    ▶
                  </button>
                </div>
                <p className="segment-text" onClick={() => playSegment(seg.id)}>
                  {seg.text ?? <span className="dim">（无文本）</span>}
                </p>
                {seg.reason && <p className="segment-reason">{seg.reason}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      {asrError && <div className="banner error small">{asrError}</div>}
    </div>
  );
}
