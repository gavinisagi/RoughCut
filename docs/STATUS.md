# RoughCut · 进度看板（STATUS）

> 状态：v0.1.0 已发布至 GitHub（2026-08-17，https://github.com/gavinisagi/RoughCut）；v0.2.0 开发中。
> Milestone v0.1.0 —— 可用的一键粗剪：GUI + CLI 全流程跑通并通过合成媒体验收。✅ 达成
> Milestone v0.2.0 —— 内容级粗剪：转录 + AI 审查重复/口误段 + 一键删段（D012/D013）。

## Done

- [x] 四文档初始化（CLAUDE / PRD / DESIGN / STATUS）`v0.1.0`
- [x] Stitch UI 设计稿（docs/design/main-screen.png，Obsidian Edit 设计系统）`v0.1.0`
- [x] core 引擎：ffprobe 探测 / PCM RMS 分析 / 停顿检测 / CutPlan / filter_complex_script 导出 `v0.1.0`
- [x] core 单测 21 项全绿（检测边界、pad 压缩、首尾静音、禁用重算、滤镜图生成）`v0.1.0`
- [x] CLI：probe / analyze / cut（--plan / --audio / --dry-run / --json，负数阈值两种写法）`v0.1.0`
- [x] CLI e2e 7 项全绿：合成已知停顿素材 → 检测位置 ±0.1s、导出时长符合预期 `v0.1.0`
- [x] Electron GUI：导入（含拖拽）、参数实时重算、波形 Canvas（缩放/平移/点击定位）、切点 chips、逐切点试听、全片紧凑预览（Web Audio 无缝调度 + 画面跟随）、切点禁用、导出（进度/报告/WAV）、HEVC 代理 `v0.1.0`
- [x] GUI 冒烟：--smoke 自动导入→分析→截图（docs/design/screenshot-app.png），统计与切点位置验证正确 `v0.1.0`
- [x] 开源材料：README（EN/中文）、LICENSE(MIT)、CONTRIBUTING、.gitignore、git 初始化 `v0.1.0`
- [x] 真实素材首测（Pocket 4K HEVC 2:22）：40 处停顿全部检出、统计正常；暴露视频预览不实时问题 → 已修复（D009：HEVC 硬解直播原片 + 短 GOP 代理 + 代理进度显示）`v0.1.0`
- [x] 视频冻结根因修复（D011）：rcmedia 协议实现 HTTP Range/206（此前所有 seek 回落 0 帧）；播放降级到 480p 短 GOP 代理；`--smoke-play` 连拍回归验证 8 帧烧录时间码连续递增、两处切点跳跃精确落点 `v0.1.0`
- [x] 剪映式即时画面反馈（D010）：120p 缩略图保底层（seek 零延迟画面变动）+ 波形上方 filmstrip 胶片条 + smoke 验证 `v0.1.0`

- [x] 播放实时性用户实测通过（"丝滑了"）；GitHub 首推完成（gavinisagi/RoughCut，双语 README + 徽章 + 截图）`v0.1.0`

- [x] CutPlan v2 契约落地：kind/segmentIds/transcript/dropped + v1 迁移 + normalizePlan 段删除重算 + 保留量只取底噪的 clamp（D012）`v0.2.0`
- [x] 转录：whisper-cli runner（ROUGHCUT_WHISPER/MODEL 探测、进度解析、缺失时清晰指引）+ 16k WAV + 重叠对齐（D013）`v0.2.0`
- [x] 审查：OpenAI-compatible LLM 客户端（main 进程跑，绕渲染端 CSP）+ 相邻段 bigram 相似度规则兜底（D013）`v0.2.0`
- [x] CLI：transcribe / review 子命令 + cut --apply-review + LLM env/flag 配置 `v0.2.0`
- [x] GUI：⚙ 设置面板（whisper/LLM，localStorage）、右侧"内容审查"tab（转录进度/段落列表/verdict 徽章/逐段试听/勾选删除/一键应用推荐）、波形琥珀色段删除区、转录后节奏参数仍实时可调 `v0.2.0`
- [x] 测试全绿：core 45 单测（合并/首尾/连续段/clamp/enabled 继承/相似度/对齐/LLM mock）+ CLI e2e 9（含 mock transcript 段删除与 --apply-review 时长验证）+ GUI 冒烟 `v0.2.0`

## In Progress

（无）

- [x] whisper 环境落地（用户授权代办）：whisper.cpp v1.9.2 BLAS 版 + ggml-large-v3-turbo 装至 `~/tools/whisper`，用户级环境变量 ROUGHCUT_WHISPER / ROUGHCUT_WHISPER_MODEL 已设 `v0.2.0`
- [x] 全链路真语音验证：scripts/make-demo.mjs（演播室风格画面 + Windows TTS 含重说语音）→ transcribe --review 中文识别准确、重说段被规则审查标 DROP（相似度 70%）→ cut --apply-review 输出 18.8s→9.1s 与预期一致；README 截图换新画面 `v0.2.0`

## Backlog

- [ ] v0.2 真实素材验证：用户拿真口播跑转录审查流，回填识别质量与 LLM（DeepSeek 等）审查效果 `v0.2.0`
- [ ] 真实素材听感回归：紧凑预览逐切点过一遍，确认默认参数（-38dB / 0.45s）在真实底噪下无误切漏切 `v0.1.0`
- [ ] 自适应静音阈值（noise floor 估计，免手调 dB）
- [ ] NVENC/QSV 硬编导出选项
- [ ] 批量队列处理（CLI glob + GUI 多文件）
- [ ] 导出剪映草稿工程（可行性调研：draft_content.json 逆向）
- [ ] Windows 安装包分发（electron-builder + NSIS）
- [ ] macOS/Linux GUI 验证
- [ ] 波形视图键盘快捷键增强（JKL、逗号句号微移）
- [ ] 切点手动微调（拖拽切点边界）
- [ ] 波形渲染性能：超长素材（>30min）分块聚合缓存
