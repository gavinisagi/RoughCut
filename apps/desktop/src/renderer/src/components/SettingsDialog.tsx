import { useState } from "react";
import { useStore } from "../store";

export function SettingsDialog() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [form, setForm] = useState(settings);

  const commit = () => {
    saveSettings(form);
    setSettingsOpen(false);
  };

  return (
    <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="card-title">设置</h3>

        <h4 className="settings-group">转录（whisper.cpp）</h4>
        <label className="field">
          <span>whisper-cli 路径（留空则自动探测：环境变量 → PATH → ~\tools\whisper\bin）</span>
          <input
            value={form.whisperCli}
            spellCheck={false}
            placeholder="C:\\Users\\你\\tools\\whisper\\bin\\Release\\whisper-cli.exe"
            onChange={(e) => setForm({ ...form, whisperCli: e.target.value })}
          />
        </label>
        <label className="field">
          <span>模型文件路径（留空则自动探测 ~\tools\whisper\models 下最大的 ggml-*.bin）</span>
          <input
            value={form.whisperModel}
            spellCheck={false}
            placeholder="C:\\Users\\你\\tools\\whisper\\models\\ggml-large-v3-turbo.bin"
            onChange={(e) => setForm({ ...form, whisperModel: e.target.value })}
          />
        </label>
        <label className="field">
          <span>语言（auto 自动检测）</span>
          <input
            value={form.language}
            spellCheck={false}
            onChange={(e) => setForm({ ...form, language: e.target.value })}
          />
        </label>

        <h4 className="settings-group">AI 审查（OpenAI 兼容接口，可用 DeepSeek / 通义 / Ollama 等）</h4>
        <label className="field">
          <span>Base URL（例如 https://api.deepseek.com/v1）</span>
          <input
            value={form.llmBaseUrl}
            spellCheck={false}
            placeholder="https://api.deepseek.com/v1"
            onChange={(e) => setForm({ ...form, llmBaseUrl: e.target.value })}
          />
        </label>
        <label className="field">
          <span>API Key（仅保存在本机）</span>
          <input
            type="password"
            value={form.llmKey}
            spellCheck={false}
            onChange={(e) => setForm({ ...form, llmKey: e.target.value })}
          />
        </label>
        <label className="field">
          <span>模型名——审查是轻任务，选快速模型（deepseek-chat / gemini-flash / qwen-turbo 级），避免 reasoner / pro 等慢速思考模型</span>
          <input
            value={form.llmModel}
            spellCheck={false}
            placeholder="deepseek-chat"
            onChange={(e) => setForm({ ...form, llmModel: e.target.value })}
          />
        </label>
        <p className="param-note">留空 LLM 配置时，审查退化为本地相似度规则（可检测重说，不联网）。</p>

        <div className="modal-actions">
          <button className="btn" onClick={() => setSettingsOpen(false)}>
            取消
          </button>
          <button className="btn primary" onClick={commit}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
