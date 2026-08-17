# RoughCut · 进度看板（STATUS）

> 状态：v0.1.0 已完成首个可用版本（2026-08-16），待真实素材回归与 GitHub 首推。
> Milestone v0.1.0 —— 可用的一键粗剪：GUI + CLI 全流程跑通并通过合成媒体验收。✅ 达成

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

## In Progress

（无）

## Backlog

- [ ] 真实素材听感回归：紧凑预览逐切点过一遍，确认默认参数（-38dB / 0.45s）在真实底噪下无误切漏切 `v0.1.0`
- [ ] GitHub 仓库创建与首推（用户操作：创建 repo 后 `git remote add origin … && git push -u origin main`）`v0.1.0`
- [ ] 自适应静音阈值（noise floor 估计，免手调 dB）
- [ ] NVENC/QSV 硬编导出选项
- [ ] 批量队列处理（CLI glob + GUI 多文件）
- [ ] 导出剪映草稿工程（可行性调研：draft_content.json 逆向）
- [ ] Windows 安装包分发（electron-builder + NSIS）
- [ ] macOS/Linux GUI 验证
- [ ] 波形视图键盘快捷键增强（JKL、逗号句号微移）
- [ ] 切点手动微调（拖拽切点边界）
- [ ] 波形渲染性能：超长素材（>30min）分块聚合缓存
