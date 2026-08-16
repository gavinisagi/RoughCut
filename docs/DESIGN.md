# RoughCut · 技术设计（DESIGN）

> 面向贡献者的架构说明。需求与决策论证见 [PRD.md](PRD.md)。

## 1. 总体架构

```
┌─────────────────────────────────────────────────┐
│                  apps/desktop                   │
│   Electron (main ← IPC → renderer/React)        │
│   main: 会话管理、调 core、进度事件              │
│   renderer: 波形 Canvas、参数面板、Web Audio 预览 │
├─────────────────────────────────────────────────┤
│                  packages/cli                   │
│   roughcut probe / analyze / cut（JSON in/out）  │
├─────────────────────────────────────────────────┤
│                  packages/core                  │
│   ffmpeg.ts    探测/提取/导出（spawn ffmpeg）     │
│   analysis.ts  PCM → RMS 帧 + 波形 peaks         │
│   detect.ts    RMS 帧 → 停顿区间（纯函数）        │
│   plan.ts      停顿 → CutPlan / keepSegments     │
│   export.ts    CutPlan → filtergraph → 成片      │
│   types.ts     CutPlan schema（跨端契约）         │
└─────────────────────────────────────────────────┘
                     ↓ 外部依赖
              ffmpeg / ffprobe（系统 PATH 或 ROUGHCUT_FFMPEG）
```

数据流：

```
输入视频 ─ffprobe→ MediaInfo
        ─ffmpeg→ PCM s16le 16kHz mono ─→ RmsFrame[]（10ms/帧）─→ 波形 peaks
                                              │
                params ──────────────────────→ detectPauses() → Pause[]
                                              │
                                       buildCutPlan() → CutPlan{cuts[], keepSegments[]}
                                              │
              ┌───────────────┬───────────────┤
              ↓               ↓               ↓
        GUI 波形标记     GUI/CLI 预览     export(): filter_complex_script
                                              → ffmpeg 重编码 → out.mp4 + report.json
```

## 2. 停顿检测（detect.ts）

输入：RMS 帧序列（帧长 20ms、步进 10ms、16kHz mono PCM 计算 dBFS）。

1. `speech[i] = rmsDb[i] >= thresholdDb`（默认 -38 dBFS）
2. 连续非语音帧构成候选静音段；**时长 ≥ minSilence（默认 0.45s）才判定为停顿**，短于该值的呼吸/字间隙不动。
3. 停顿区间的补集即语音段。片头/片尾静音同样产生停顿区间（左/右边界开放）。

纯函数、无 IO，参数变化时对缓存的 RMS 帧重算，GUI 得以做到"拖滑块即时刷新切点"。

## 3. 剪辑计划（plan.ts）

对每个停顿 `[s, e]`（s=上句语音尾，e=下句语音头）：

```
gap        = e - s
若 gap ≤ targetGap → 不剪
否则：
  spare     = targetGap - padAfter - padBefore   （targetGap 不足两 pad 之和时按比例压缩 pad）
  keepAfter = padAfter  + spare / 2              （贴上句尾保留的底噪）
  keepBefore= padBefore + spare / 2              （贴下句头保留的底噪）
  删除区间  = [s + keepAfter, e - keepBefore]
```

- 剪完后该处停顿总时长恰为 `targetGap`，其中至少 `padAfter` 贴前、`padBefore` 贴后（防切字尾/字头）。
- 保留的间隔全部是**原片底噪**，绝不插入数字静音（避免噪底突变）。
- 片头停顿：`keepAfter` 侧无语音，删除区间为 `[0, e - keepBefore - spare/2 - padAfter…]` 的简化——按"虚拟片头语音边界"同规则处理，剪完片头留约 `targetGap/2`。片尾对称。
- `cuts[].enabled` 默认 true；禁用的切点不进入删除集合。
- `keepSegments = [0, duration] 减去所有 enabled 删除区间`，导出与预览共用。

## 4. CutPlan schema（types.ts，跨端契约）

```jsonc
{
  "schemaVersion": 1,
  "generator": "roughcut@0.1.0",
  "input": { "path": "...", "duration": 324.5, "video": {...}, "audio": {...} },
  "params": { "targetGap": 0.3, "minSilence": 0.45, "thresholdDb": -38,
               "padBefore": 0.06, "padAfter": 0.15 },
  "cuts": [
    { "id": 1, "pause": [12.31, 13.94], "remove": [12.53, 13.72],
      "removedDuration": 1.19, "enabled": true }
  ],
  "keepSegments": [[0, 12.53], [13.72, ...]],
  "stats": { "originalDuration": 324.5, "outputDuration": 238.1,
              "removedDuration": 86.4, "cutCount": 47 }
}
```

`analyze` 输出、`cut --plan` 输入、GUI 计划保存、导出报告全部使用该结构（报告附加 `output` 段）。消费方须校验 `schemaVersion`。

**`cuts` 是 source of truth，`keepSegments`/`stats` 是派生缓存**：加载计划执行时一律从 `cuts`（按 `enabled`）重算派生字段（`normalizePlan`）。手工编辑计划只需翻转 `enabled`，无须同步维护 keepSegments。

## 5. 导出（export.ts）

由 `keepSegments` 生成 filtergraph：

```
[0:v]trim=start=A:end=B,setpts=PTS-STARTPTS[v0];
[0:a]atrim=start=A:end=B,asetpts=PTS-STARTPTS[a0];
...
[v0][a0][v1][a1]...concat=n=K:v=1:a=1[vout][aout]
```

- filtergraph **一律写入临时文件**经 `-filter_complex_script` 传入（Windows 命令行 8191 字符上限；口播素材常见 50+ 切点）。
- 默认编码 `libx264 -crf 18 -preset veryfast` + `aac 192k` + `+faststart`；纯音频导出走同一 keepSegments 的 atrim/concat。
- 进度：解析 ffmpeg stderr 的 `time=`，除以预期输出时长得百分比，经回调上报（CLI 进度条 / GUI 事件）。
- ffmpeg 定位次序：`ROUGHCUT_FFMPEG` 环境变量 → 系统 PATH。找不到给出安装指引（winget/scoop/官网）。

## 6. GUI 预览引擎（renderer）

- **导入时准备**：主进程提取
  1) 分析 PCM（16kHz mono s16le，计算 RMS 帧与波形 peaks，不落盘原始 PCM）；
  2) 预览 WAV（44.1kHz mono，供 `decodeAudioData`；**以 ArrayBuffer 经 IPC 传给渲染进程**——`file://` 页面对自定义协议的 `fetch` 会被 CORS 拦截，`<video>` 标签则不受限，故视频走 `rcmedia://` 协议、音频走 IPC）；
  3) 源视频编码若 Chromium 不可解码（如 HEVC）→ 生成 480p H.264 代理（`-preset ultrafast -crf 28`），H.264 源直接用原文件。
- **紧凑预览**：Web Audio 对每个保留段调度一个 `AudioBufferSourceNode`（`start(when, offset, duration)`），样本级无缝拼接；`requestAnimationFrame` 由 AudioContext 时钟反推"当前原始时间"驱动播放头在波形上跳跃前进；`<video muted>` 在段边界 seek 跟随，段内自然播放。
- **切点试听**：即紧凑预览限定窗口——切点前后各 1.2s 的保留内容。
- 参数或 enabled 变化 → 重建调度表；音频缓冲不变，无需重新解码。

## 7. 波形渲染

- peaks：每 10ms 一对 [min, max]（归一化 s16），5 分钟素材约 3 万对，单 Canvas 全量绘制无压力。
- 双层 Canvas：底层波形（青色，删除区内降亮度），上层 overlay（红色半透明删除区、切点竖线、播放头、悬停高亮）。
- 缩放/滚动：水平 zoom 1x–32x，wheel + 拖拽；重绘按可视窗口裁剪。

## 8. 测试策略

- **单测（Vitest）**：detect/plan 纯函数——合成 RMS 序列覆盖：无停顿、全静音、停顿恰等于阈值、pad 超过 targetGap、首尾静音、禁用切点重算。
- **e2e**：`ffmpeg` 合成测试媒体（正弦音"语音段" + 数字静音"停顿"，位置已知）→ CLI `analyze` 断言切点位置（±30ms）→ `cut` 断言输出时长（±100ms）与报告一致性。
- **GUI 冒烟**：Electron `--smoke` 启动参数：加载完成后自动截图退出，CI 可跑。

## 9. 目录结构

```
roughcut/
├── CLAUDE.md            # 工程契约（稳定层）
├── docs/                # PRD / DESIGN / STATUS / design 稿
├── packages/
│   ├── core/            # @roughcut/core
│   └── cli/             # @roughcut/cli（bin: roughcut）
└── apps/
    └── desktop/         # Electron GUI（electron-vite + React）
```
