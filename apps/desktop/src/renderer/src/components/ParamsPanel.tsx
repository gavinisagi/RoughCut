import { useStore } from "../store";
import { fmtDuration, fmtTime } from "../util";

export function ParamsPanel() {
  const params = useStore((s) => s.params);
  const setParam = useStore((s) => s.setParam);
  const recompute = useStore((s) => s.recompute);
  const plan = useStore((s) => s.plan);
  const selectCut = useStore((s) => s.selectCut);
  const playCut = useStore((s) => s.playCut);

  const oneClick = () => {
    recompute();
    const first = useStore.getState().plan?.cuts.find((c) => c.enabled);
    if (first) {
      selectCut(first.id);
      playCut(first.id);
    }
  };

  return (
    <aside className="params-pane">
      <div className="panel card">
        <h3 className="card-title">剪辑参数</h3>
        <Slider
          label="目标间隔"
          hint="剪完后每处停顿的时长"
          value={params.targetGap}
          min={0.1}
          max={1.0}
          step={0.05}
          fmt={(v) => `${v.toFixed(2)} 秒`}
          onChange={(v) => setParam("targetGap", v)}
        />
        <Slider
          label="最小停顿"
          hint="短于此的停顿不动（呼吸/字间隙）"
          value={params.minSilence}
          min={0.2}
          max={2.0}
          step={0.05}
          fmt={(v) => `${v.toFixed(2)} 秒`}
          onChange={(v) => setParam("minSilence", v)}
        />
        <Slider
          label="静音阈值"
          hint="低于此音量视为静音"
          value={params.thresholdDb}
          min={-60}
          max={-20}
          step={1}
          fmt={(v) => `${v.toFixed(0)} dB`}
          onChange={(v) => setParam("thresholdDb", v)}
        />
        <div className="pad-row">
          <label className="pad-field">
            <span>段尾保留 (ms)</span>
            <input
              type="number"
              min={0}
              max={500}
              step={10}
              value={Math.round(params.padAfter * 1000)}
              onChange={(e) => setParam("padAfter", Number(e.target.value) / 1000)}
              title="间隔中贴住上一句尾巴的最少留量，防止切掉字尾"
            />
          </label>
          <label className="pad-field">
            <span>段首保留 (ms)</span>
            <input
              type="number"
              min={0}
              max={500}
              step={10}
              value={Math.round(params.padBefore * 1000)}
              onChange={(e) => setParam("padBefore", Number(e.target.value) / 1000)}
              title="间隔中贴住下一句开头的最少留量，防止切掉字头"
            />
          </label>
        </div>
        <button className="btn primary wide" onClick={oneClick}>
          ⚡ 一键粗剪
        </button>
        <p className="param-note">参数调整会实时重算切点，试听满意后再导出。</p>
      </div>

      {plan && (
        <div className="panel card">
          <h3 className="card-title">剪辑统计</h3>
          <dl className="stats">
            <div>
              <dt>原始时长</dt>
              <dd className="mono">{fmtTime(plan.stats.originalDuration)}</dd>
            </div>
            <div>
              <dt>成片时长</dt>
              <dd className="mono accent-text">{fmtTime(plan.stats.outputDuration)}</dd>
            </div>
            <div>
              <dt>移除停顿</dt>
              <dd>
                {plan.stats.cutCount} 处
                {plan.stats.totalCuts !== plan.stats.cutCount
                  ? `（已禁用 ${plan.stats.totalCuts - plan.stats.cutCount}）`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>节省时间</dt>
              <dd className="saved">{fmtDuration(plan.stats.removedDuration)}</dd>
            </div>
          </dl>
        </div>
      )}
    </aside>
  );
}

function Slider(props: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider-field" title={props.hint}>
      <div className="slider-head">
        <span>{props.label}</span>
        <span className="mono slider-value">{props.fmt(props.value)}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
