# V1.2.2 封版验证记录

核验日期：2026-11-16（北京时间）。正式产品来源 main：`9aba92e22a8238fa85d2192dff105881a0af1ce1`；包含已合并 PR #60 的动作工坊修复。

本文件只记录本轮 V1.2.2。[机器可读验证汇总与原日志 SHA-256](v122-validation-results.json)随仓库提供，便于独立查看范围与证据身份。V1.2.1 历史结果见 [VALIDATION.md](VALIDATION.md)，历史真实模型结果见 [HISTORICAL_MODEL_RESULTS.json](HISTORICAL_MODEL_RESULTS.json)。本轮不重训决策模型，不把既有 Qwen 评测当作本次真实推理。

下表依据本轮真实日志与产物填写。最终冻结 SHA 及其 CI/审计回读写入 Git 外的提交材料；PENDING 人工项不能当作通过。

| 项目 | 本轮结果 | 证据 |
| --- | --- | --- |
| 比赛源码 PR #60 同步与字节核验 | PASS | 原提交 `9aba92e…` → 路径过滤提交 `98c86b6d9c49d6781acc4150b8f75d1174856d68`，增量合并 `5f0e1e35ab90172280a570179d0cf2a89c904579`；1,025 个未调整源码文件字节核验通过，另保留 3 份 README / 2 份测试适配 |
| 比赛仓库独立锁文件安装、类型检查、lint、构建 | PASS | `20261116-submission-sync/platform-checks.json` 与 `games-checks.json`：所有命令退出 0；平台普通/competition 两种构建、游戏生产构建通过；平台 lint 7 个既有 React Refresh warning，无错误 |
| 独立比赛源码生产运行 | 7/7 HTTP/产物核验 PASS | `20261116-submission-sync/submission-local-runtime.json`：实际启动本仓库 competition preview 4285、游戏 preview 5281，index 与全部入口 JS/CSS 响应逐字节匹配各自 dist；独立服务验证，不等于真人或一轮新浏览器 E2E |
| 平台单元/集成 | 2,240/2,240 PASS | 正式 main 独立导出构建目录的 `vitest-platform.log`；136 个测试文件；含动作工坊 #60 新增单元回归、合成夹具与假上游 |
| 三游戏单元 | 89/89 PASS | `vitest-games.log`；8 个测试文件；完整 UI/包验收结果另记 |
| 最终包三游戏完整 UI | 15/15 PASS | `games-package.log` 与结果 JSON；摘苹果、林间划船、林间射箭的进入、操作、暂停/追踪丢失与结算等流程；6.1 分钟，synthetic player，不是真人摄像头 |
| 45 项功能 E2E | 首轮 43 通过、2 导航超时；两项复测 4/4 通过 | `playwright-functional.log`、`playwright-functional-rerun-ab-final.log`：AI Coach A/B 初次页面导航 30 秒超时，隔离输出并改测试 timeout 为 90 秒、各重复两次后通过；包含动作工坊创建/识别/保存/训练/报告及四功法等相关流程；不是新一轮全量 207 项 |
| 六热身完整课程 | 1/1 PASS | `playwright-six-warmup-final.log`：六步骤顺序及计分摘要保存；合成测试输入 |
| 最终包真实 MediaPipe 视频重放 | PASS，非真人 | `package-camera-replay/result.json`：实际 full/lite 模型请求、comparison 双头图标、开始、计数、暂停期间计数不变、手势恢复、8 次完成与报告显示均通过；errors 0；输入是摄像头视频重放，`physicalCameraTest=false` |
| M1/M2 ACTIVE 与 AI Coach 降级 | 5/5 ACTIVE、7/7 包冒烟覆盖 PASS | 最终包 `package-active.log` 验证模型身份/推荐、风险暂停、OOD 规则回退及构建模式不可由 URL 修改；`package-final-smoke.log` 验证无本地模型时自由提问禁用、固定五问和决策模型继续可用；非真实 Qwen 推理 |
| ZIP 实际解压、启动器运行、包冒烟 | 7/7 PASS | 最终 ZIP 以 Windows Expand-Archive 解压到 `unzip-final`，403 项清单比对 0 mismatch（SHA256SUMS 不自含）；通过包内 CMD 启动平台 4275/游戏 5181，四功法视频、游戏联通、六模块与无模型降级冒烟全通过 |
| 最终 ZIP 与文件清单生成 | PASS | `FormPilot-Web-V1.2.2.zip`，188,585,346 bytes；404 文件、274 项依赖许可记录，含补齐的 react-remove-scroll-bar MIT 全文与来源；SHA-256 `ecaf6ae7ea50d1f3da7be06ef3801545d650f0f5e1fcc1b59054650bf16a2ce0` |
| 内部 Pre-release | PASS | [web-v1.2.2-internal-test](https://github.com/FormPilot-Team/FormPilot/releases/tag/web-v1.2.2-internal-test)，release ID 446906020，draft=false、prerelease=true、target main `9aba92e…`；4 个附件 uploaded，ZIP 服务端大小/digest 与本轮一致，正式仓库 Private；旧 V1.2.1 资源与元数据保留不变 |
| 实际 CI | 首轮 PASS；最终 SHA 以外部记录为准 | 首轮准备提交 `9ece1e0…` 的实际 run 43848098231 success；最终冻结提交及其 CI URL/结论登记在外部 `01_源码仓库信息/README及仓库说明.md`，防止文档自引用 SHA 与 CI 循环 |
| 真人摄像头与负责人全功能验收 | PENDING | 由真人验收记录补充；自动化不能代替 |

原始构建证据目录：`F:\ProjectEvidence\FormPilot\20261116-v122-release`；最终提交检查目录：`F:\ProjectEvidence\FormPilot\FormPilot-ChuanzhiCup-Submission`。最终结果应同时写入上述目录的测试记录与文件校验记录，避免 README 只引用旧版本成绩。

本轮机器可读总记录为构建证据目录的 `RESULT.json`，详细测试说明为 `TEST_RESULTS.md`。45 项首轮日志和 traces 保留；一次中间复测曾因并发测试清空共享输出目录而出现 trace ENOENT，改用隔离输出后完成 4/4，未改产品代码。四功法的轨迹单元回归、源码跟练和最终包视频播放是不同证据，不能据此声称真人已完成四套整套训练。

比赛远端已实际创建并推送，保持 Private：[FormPilot-Team/FormPilot-ChuanzhiCup-2026](https://github.com/FormPilot-Team/FormPilot-ChuanzhiCup-2026)，默认分支 `submission`。首轮准备提交 `9ece1e0a0bfbb600ec5f5c9a953b22d18a5c5a84` 的 [CI](https://github.com/FormPilot-Team/FormPilot-ChuanzhiCup-2026/actions/runs/43848098231)已完成并为 success（本地回读 `submission-first-ci.json`）；最终说明提交后需再核验其实际 CI，不能将旧 SHA 的成功当作新 SHA 成功。最终冻结 SHA 登记在 Git 外的提交材料中，避免自引用提交号。

源码/隐私审计：同步合并 `5f0e1e…` 上共 136 个可达提交、1,841 个 blob；四条已知测试假凭据候选，未审查秘密/号码/跟踪工作区秘密为 0。132 条非零提交映射的作者、提交者、时间和消息逐字节一致。详细证据见 `20261116-submission-audit/SECURITY_LICENSE_ACCESS_REVIEW.md` 与 `history-metadata-verification.json`；最终说明提交后的复扫记录及被扫 SHA 同样保存在外部材料。邮箱公开同意、媒体分发与原创源码许可等负责人确认项不因扫描通过而关闭。
