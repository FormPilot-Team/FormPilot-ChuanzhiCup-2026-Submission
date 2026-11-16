# V1.2.3 当前封版记录

正式源码基线：`4bf15bf1c71b19f9674703f5816d19fb246d7b3f`；包含已合并 #60 / #62，不包含未合并 #61。

| 检查 | 当前状态 | 证据范围 |
|---|---|---|
| 真实来源映射与旧历史保留 | PASS | 原 main → `e2f487dd5a6d490ce6c3e77fa820c457b0f7f609`，普通合并保留旧 submission 祖先 |
| 原始源码 blob | PASS | 1,032 项基线；1,027 原始 blob 一致，三 README / 两测试适配另列 |
| 比赛仓库独立安装、类型检查、lint、单元测试与构建 | PASS | 两端 `pnpm install --frozen-lockfile --offline`、typecheck/lint/test/build 全部退出 0；平台普通及 competition 构建通过；平台 **2245/2245**、游戏 **89/89**；平台仅 7 个既有 React Refresh warning，无错误 |
| 正式 V1.2.3 包与解压校验 | PASS | 188,585,614 bytes，404 文件，274 项依赖许可；重新解压后 403 项 SHA 校验全通过；见下方 ZIP SHA-256 |
| 包运行与浏览器回归 | PASS（范围限定） | ACTIVE 6/6、包冒烟 7/7、三游戏 UI 15/15；真实包 full/lite MediaPipe 视频重放完成 8 次、暂停计数稳定、手势恢复及报告，无页面错误；非真人摄像头 |
| Dev 浏览器原套件 | 50 PASS / 1 FAIL / 1 SKIP | FAIL 为 #62 有意变更后旧 next-focus 文案断言；不改原测试掩盖失败。独立 merged-behavior probe 4/4，通过具体重点/安全/来源清理；原游戏 popup SKIP 后另行 probe PASS |
| 比赛 Actions | 首轮源码与说明 SHA 三 job PASS | `5d87b50…` 的 [run 43904614543](https://github.com/FormPilot-Team/FormPilot-ChuanzhiCup-2026/actions/runs/43904614543)；最终文档冻结 SHA 的三 job 结果由推送后的外部交付清单和 [Actions 页面](https://github.com/FormPilot-Team/FormPilot-ChuanzhiCup-2026/actions)记录，避免自指 |
| 真人摄像头 / 新真实 Qwen 推理 | NOT RUN | 不由合成姿态、视频重放或假上游测试替代 |

机器可读记录见 [v123-validation-results.json](v123-validation-results.json)；完整日志保存在仓库外本轮证据目录。历史 V1.2.2 结果保留在 [V122_FINAL_CHECKS.md](V122_FINAL_CHECKS.md)。比赛仓库保持 Private，未更改评审权限，未发布公网 Demo，未正式提交赛事官网。

本轮独立比赛仓库检查于 2026-11-17 00:04–00:09（北京时间）执行，原始日志及 SHA-256 由机器可读汇总保留。同步八项 #62 增量时未新增视频、个人记录或凭据。本轮浏览器实际结果如下分别列出；真人摄像头与新真实 Qwen 推理未执行。正式包和最终 Actions 状态以本次外部版本交付记录为准，避免自指提交 SHA。

## 当前交付包

`FormPilot-Web-V1.2.3.zip` SHA-256：`22f9207e16ae30621c1ee8d52ddae924b334926aaad219104c7a256f9af7e441`。

内部 Release：[web-v1.2.3-internal-test](https://github.com/FormPilot-Team/FormPilot/releases/tag/web-v1.2.3-internal-test)。访问需正式 Private 仓库权限；本包不是公开赛事提交，也不覆盖此前回退包。原版开发 E2E 的失败和跳过已单列，不能把额外 probe 的通过改写成原套件全绿。
