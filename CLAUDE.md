# RoughCut · 工程契约（CLAUDE.md）

口播视频一键粗剪工具：检测停顿并收缩到目标间隔。TypeScript monorepo（npm workspaces）：`packages/core`（引擎）、`packages/cli`（bin: roughcut）、`apps/desktop`（Electron + React + electron-vite）。Node ≥ 20；FFmpeg/ffprobe 为外部运行时依赖。

## 不变量（违反即破坏契约）

1. **时间一律用秒（number，浮点）**贯穿 core/CLI/GUI 与 CutPlan JSON。绝不在检测/计划层做帧对齐或毫秒整数化；帧对齐是导出时 ffmpeg 自己的事。
2. **CutPlan JSON（`packages/core/src/types.ts`，含 `schemaVersion`）是三端契约**：`analyze` 输出 = `cut --plan` 输入 = GUI 计划格式 = 导出报告主体。改字段必须走 dev-constraint 流程并递增 schemaVersion。
3. **剪完保留的间隔必须来自原片底噪**（删除区间从停顿中段裁出，两侧留 keepAfter/keepBefore）。绝不插入生成的数字静音——底噪突变会有"截断感"。
4. **所有 ffmpeg/ffprobe 调用走 `packages/core/src/ffmpeg.ts` 的 runner**（定位次序：`ROUGHCUT_FFMPEG` 环境变量 → PATH）。绝不在 CLI/GUI 里裸 spawn。
5. **filtergraph 一律写临时文件传 `-filter_complex_script`**，绝不内联在命令行（Windows 8191 字符上限，切点多必炸）。
6. **精确剪辑必须重编码**。绝不用 `-c copy` 做切割（只能关键帧切，误差可达数秒）。
7. **禁用切点用 `enabled: false` 标记**，绝不从 cuts 数组删除（保证计划可回溯可再启用）。
8. detect/plan 是**纯函数**（无 IO、无 Date.now），单测直接喂合成 RMS 帧。IO 全部在 analysis/ffmpeg/export 层。

## 约定

- Conventional Commits（feat/fix/docs/refactor/test/chore）。
- 代码注释英文；面向用户的文档双语（README.md 英文 + README.zh-CN.md 中文）。
- PRD/STATUS 为 append-only：决策追加 Dxxx，不改写历史；进度只在 STATUS 三段间搬移。
- Windows 开发注意：npm 脚本须跨平台（用 node 脚本代替 shell 串联）；Electron 安装慢时设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

## 文档结构（Doc Structure）

| 文件 | 职责 | 变更纪律 |
|---|---|---|
| `CLAUDE.md` | 稳定契约：栈、不变量、约定 | 仅 dev-constraint 流程可改 |
| `docs/PRD.md` | 需求论证 + Decisions Log | append-only |
| `docs/DESIGN.md` | 架构/算法公开视图 | 随实现同步 |
| `docs/STATUS.md` | Done / In Progress / Backlog | 每次工作收尾更新 |

加功能 workflow：PRD 追加决策 → STATUS Backlog 登记 → 实现（dev-feature）；动到本文件所列契约才走 dev-constraint。
