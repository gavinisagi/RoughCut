import { useEffect, useRef, useState } from "react";
import { llmConfigOf, useStore } from "../store";
import { fmtTime } from "../util";

type Filter = "all" | "drop" | "review";

export function ReviewPanel() {
  const plan = useStore((s) => s.plan);
  const asrBusy = useStore((s) => s.asrBusy);
  const asrProgress = useStore((s) => s.asrProgress);
  const asrError = useStore((s) => s.asrError);
  const settings = useStore((s) => s.settings);
  const runTranscribe = useStore((s) => s.runTranscribe);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const [whisperOk, setWhisperOk] = useState<boolean | null>(null);
  useEffect(() => {
    void window.roughcut.asrAvailable(settings.whisperCli || undefined).then(setWhisperOk);
  }, [settings.whisperCli]);

  const transcript = plan?.transcript;

  if (!transcript) {
    return (
      <div className="review-panel">
        <div className="panel card">
          <h3 className="card-title">转录与 AI 审查</h3>
          <p className="param-note">
            把每个语音段转成文字，再由 AI 判断哪些段是重说的草稿、与上下文重复或表达欠佳，推荐后一键删除。
          </p>
          {whisperOk === false && (
            <p className="review-warn">
              未找到 whisper-cli。请安装 whisper.cpp（推荐解压到 ~\tools\whisper\bin，模型放
              ~\tools\whisper\models 可被自动发现），或在下方设置里直接填 whisper-cli 路径。
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
        {asrError && <div className="banner error small">{asrError}</div>}
      </div>
    );
  }

  return <SegmentReview />;
}

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec - m * 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function SegmentReview() {
  const plan = useStore((s) => s.plan);
  const asrBusy = useStore((s) => s.asrBusy);
  const asrError = useStore((s) => s.asrError);
  const settings = useStore((s) => s.settings);
  const playhead = useStore((s) => s.playhead);
  const playMode = useStore((s) => s.playMode);
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const runReview = useStore((s) => s.runReview);
  const toggleSegmentDropped = useStore((s) => s.toggleSegmentDropped);
  const applyAllRecommended = useStore((s) => s.applyAllRecommended);
  const playSegment = useStore((s) => s.playSegment);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const [filter, setFilter] = useState<Filter>("all");
  const listRef = useRef<HTMLDivElement>(null);

  const transcript = plan!.transcript!;
  const llm = llmConfigOf(settings);
  const segments = transcript.segments;
  const pendingDrops = segments.filter((s) => s.verdict === "drop" && !s.dropped);
  const droppedCount = segments.filter((s) => s.dropped).length;
  const reviewCount = segments.filter((s) => s.verdict === "review").length;

  const visible = segments.filter((s) => {
    if (filter === "drop") return s.verdict === "drop" || s.dropped;
    if (filter === "review") return s.verdict === "review";
    return true;
  });

  const playingId =
    playMode !== "idle"
      ? segments.find((s) => playhead >= s.start && playhead <= s.end)?.id ?? null
      : null;

  // Keep the playing row in view while auditioning.
  useEffect(() => {
    if (playingId === null) return;
    listRef.current
      ?.querySelector(`[data-seg="${playingId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [playingId]);

  return (
    <div className="review-panel">
      <div className="panel review-toolbar">
        <div className="review-toolbar-row">
          {asrBusy === "review" ? (
            <div className="progress slim">
              <div className="progress-bar indeterminate" />
              <span className="progress-text">AI 审查中 …</span>
            </div>
          ) : (
            <button
              className="btn primary flex1"
              disabled={asrBusy !== null}
              onClick={() => void runReview()}
              title={llm ? `使用 ${llm.model}` : "未配置 LLM：使用本地相似度规则（点右上⚙可配置）"}
            >
              🤖 AI 审查{llm ? "" : "（规则）"}
            </button>
          )}
          {pendingDrops.length > 0 && (
            <button
              className="btn flex1 apply-btn"
              onClick={applyAllRecommended}
              title="把所有【建议删】段标记为删除"
            >
              应用推荐 ({pendingDrops.length})
            </button>
          )}
        </div>
        <div className="seg-filter">
          {(
            [
              ["all", `全部 ${segments.length}`],
              ["drop", `建议删 ${pendingDrops.length + droppedCount}`],
              ["review", `存疑 ${reviewCount}`],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={`seg-filter-btn ${filter === key ? "active" : ""}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="review-meta-row mono">
          {transcript.reviewedBy ? `审查：${transcript.reviewedBy}` : "未审查"}
          {droppedCount > 0 ? ` · 已删 ${droppedCount} 段` : ""}
        </div>
      </div>

      {transcript.reviewedBy && (
        pendingDrops.length + reviewCount > 0 ? (
          <div className="review-result warn">
            发现 <b>{pendingDrops.length}</b> 段建议删除
            {reviewCount > 0 ? <>、<b>{reviewCount}</b> 段存疑</> : null}
            ，已在列表中标出，可逐段试听后应用。
          </div>
        ) : (
          <div className="review-result ok">
            <span className="ok-mark">✓</span> 未发现明显重说片段。可逐段试听、手动勾选删除
            {!llm && (
              <>
                ；或
                <button className="link-btn" onClick={() => setSettingsOpen(true)}>
                  配置 LLM 进行语义级审查
                </button>
                （识别表达欠佳、啰嗦的段落）
              </>
            )}
            。
          </div>
        )
      )}

      <div className="segment-list" ref={listRef}>
        {visible.map((seg) => {
          const empty = !seg.text;
          const recommended = seg.verdict === "drop" && !seg.dropped;
          const expanded = selectedSegmentId === seg.id && !empty;
          const cls = [
            "seg-row",
            empty ? "empty" : "",
            recommended ? "recommended" : "",
            seg.dropped ? "dropped" : "",
            playingId === seg.id ? "playing" : "",
            expanded ? "expanded" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={seg.id}
              data-seg={seg.id}
              className={cls}
              title={expanded ? undefined : "点击试听并展开"}
              onClick={() => playSegment(seg.id)}
            >
              <div className="seg-line">
                <input
                  type="checkbox"
                  checked={seg.dropped}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSegmentDropped(seg.id)}
                  title={seg.dropped ? "恢复此段" : "删除此段"}
                />
                <span className="seg-idx mono">{seg.id}</span>
                <span className="seg-time mono">{fmtClock(seg.start)}</span>
                <span className="seg-text">{seg.text ?? "无文本"}</span>
                {(seg.verdict === "drop" || seg.verdict === "review") && !empty && (
                  <span className={`verdict ${seg.verdict}`}>
                    {seg.verdict === "drop" ? "建议删" : "存疑"}
                  </span>
                )}
                <button
                  className="seg-play"
                  title="试听此段"
                  onClick={(e) => {
                    e.stopPropagation();
                    playSegment(seg.id);
                  }}
                >
                  ▶
                </button>
              </div>
              {expanded && (
                <div className="seg-detail" onClick={(e) => e.stopPropagation()}>
                  <p className="seg-full-text">{seg.text}</p>
                  {seg.reason && <p className="seg-reason">AI：{seg.reason}</p>}
                  <div className="seg-detail-meta mono">
                    {fmtTime(seg.start)} – {fmtTime(seg.end)} · {(seg.end - seg.start).toFixed(1)}s
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <p className="seg-empty-hint">当前筛选下没有段落</p>}
      </div>

      {asrError && <div className="banner error small">{asrError}</div>}
      {!llm && (
        <button className="btn small settings-link" onClick={() => setSettingsOpen(true)}>
          配置 LLM 获得语义级审查…
        </button>
      )}
    </div>
  );
}
