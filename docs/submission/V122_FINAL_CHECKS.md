# V1.2.2 封版验证记录

核验日期：2026-11-16（北京时间）。正式产品来源 main：`9aba92e22a8238fa85d2192dff105881a0af1ce1`；包含已合并 PR #60 的动作工坊修复。

本文件只记录本轮 V1.2.2。V1.2.1 历史结果见 [VALIDATION.md](VALIDATION.md)，历史真实模型结果见 [HISTORICAL_MODEL_RESULTS.json](HISTORICAL_MODEL_RESULTS.json)。本轮不重训决策模型，不把既有 Qwen 评测当作本次真实推理。

本轮构建与验证进行中；下表必须在真实日志和产物生成后填写，PENDING 不是通过。

| 项目 | 本轮结果 | 证据 |
| --- | --- | --- |
| 比赛源码 PR #60 同步与字节核验 | PASS | 原提交 `9aba92e…` → 路径过滤提交 `98c86b6d9c49d6781acc4150b8f75d1174856d68`，增量合并 `5f0e1e35ab90172280a570179d0cf2a89c904579`；1,025 个未调整源码文件字节核验通过，另保留 3 份 README / 2 份测试适配 |
| 独立锁文件安装、类型检查、lint、构建 | PENDING | 等待本轮日志 |
| 平台单元/集成 | 2,240/2,240 PASS | 正式 main 独立导出构建目录的 `vitest-platform.log`；136 个测试文件；含动作工坊 #60 新增单元回归、合成夹具与假上游 |
| 三游戏单元 | 89/89 PASS | `vitest-games.log`；8 个测试文件；完整 UI/包验收结果另记 |
| M1/M2 与 AI Coach 基础/降级 | PENDING | 等待本轮日志 |
| ZIP 实际解压、启动器运行、包冒烟 | PENDING | 等待本轮日志 |
| 文件清单、ZIP SHA-256、内部 Pre-release | PENDING | 等待产物与远端核验 |
| 实际 CI | PENDING | 等待当前 SHA 的检查记录 |
| 真人摄像头与负责人全功能验收 | PENDING | 由真人验收记录补充；自动化不能代替 |

原始构建证据目录：`F:\ProjectEvidence\FormPilot\20261116-v122-release`；最终提交检查目录：`F:\ProjectEvidence\FormPilot\FormPilot-ChuanzhiCup-Submission`。最终结果应同时写入上述目录的测试记录与文件校验记录，避免 README 只引用旧版本成绩。

源码/隐私审计：同步合并 `5f0e1e…` 上共 136 个可达提交、1,841 个 blob；四条已知测试假凭据候选，未审查秘密/号码/跟踪工作区秘密为 0。132 条非零提交映射的作者、提交者、时间和消息逐字节一致。详细证据见 `20261116-submission-audit/SECURITY_LICENSE_ACCESS_REVIEW.md` 与 `history-metadata-verification.json`；最终说明提交后仍需复扫。邮箱公开同意、媒体分发与原创源码许可等负责人确认项不因扫描通过而关闭。
