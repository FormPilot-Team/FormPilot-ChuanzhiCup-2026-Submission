# V1.2.3 当前封版记录

正式源码基线：`4bf15bf1c71b19f9674703f5816d19fb246d7b3f`；包含已合并 #60 / #62，不包含未合并 #61。

| 检查 | 当前状态 | 证据范围 |
|---|---|---|
| 真实来源映射与旧历史保留 | PASS | 原 main → `e2f487dd5a6d490ce6c3e77fa820c457b0f7f609`，普通合并保留旧 submission 祖先 |
| 原始源码 blob | PASS | 1,032 项基线；1,027 原始 blob 一致，三 README / 两测试适配另列 |
| 比赛仓库独立安装、类型检查、lint、单元测试与构建 | PASS | 两端 `pnpm install --frozen-lockfile --offline`、typecheck/lint/test/build 全部退出 0；平台普通及 competition 构建通过；平台 **2245/2245**、游戏 **89/89**；平台仅 7 个既有 React Refresh warning，无错误 |
| 正式 V1.2.3 包及回归 | PENDING | 等待本轮正式来源的测试、ZIP 与校验记录 |
| 最终比赛 SHA Actions | PENDING | 最终提交推送后检查三个 CI job |
| 真人摄像头 / 新真实 Qwen 推理 | NOT RUN | 不由合成姿态、视频重放或假上游测试替代 |

机器可读记录见 [v123-validation-results.json](v123-validation-results.json)；完整日志保存在仓库外本轮证据目录。历史 V1.2.2 结果保留在 [V122_FINAL_CHECKS.md](V122_FINAL_CHECKS.md)。比赛仓库保持 Private，未更改评审权限，未发布公网 Demo，未正式提交赛事官网。

本轮独立比赛仓库检查于 2026-11-17 00:04–00:09（北京时间）执行，原始日志及 SHA-256 由机器可读汇总保留。同步八项 #62 增量时未新增视频、个人记录或凭据。当前记录未宣称新浏览器 E2E、真人摄像头或真实 Qwen 推理已通过；正式包和最终 Actions 状态以本次外部版本交付记录为准，避免自指提交 SHA。
