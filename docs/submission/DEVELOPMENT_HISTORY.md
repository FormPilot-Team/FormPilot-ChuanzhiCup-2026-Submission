# 作品真实开发时间线

以下只列重要节点；完整的 131 条过滤历史仍在两个 Git 分支中，未把摘要当作完整历史。SHA 是导出后的值，原 SHA 对照见 commit-map.txt。

| 作者日期 | 导出提交 | 原始提交标题 |
| --- | --- | --- |
| 2026-09-17 | `8327414fb025` | Recovery: Version 1 source as of 2026-09-15 |
| 2026-09-27 | `d5257a6759bd` | Add 动作工坊 to teach FormPilot custom actions |
| 2026-09-27 | `e1ff38ad226d` | Replace the 动作工坊 Home skeleton with start → finish silhouettes |
| 2026-09-27 | `050c18ff5d2b` | Show 动作工坊 on Home as teaching FormPilot any action |
| 2026-10-03 | `f24e6bd5d609` | Desktop packaging: 体感游戏工坊 as a Tauri 2 Windows app with an NSIS installer |
| 2026-10-29 | `b4d45cf3ec96` | Review: platform competition adaptive decision engine (Jev / local policy) (#1) |
| 2026-10-30 | `783a9b10e701` | feat(platform): add AI Coach data contracts and validation (#15) (#16) |
| 2026-10-30 | `d912a8d548ed` | feat(platform): add read-only AI Coach session and evidence readers (#18) |
| 2026-10-31 | `f5c5271341d2` | feat(platform): add trusted AI Coach dispatcher and mock orchestration (#20) |
| 2026-10-31 | `5fe09888a7d0` | feat(platform): add isolated remote AI Coach planning provider (#22) |
| 2026-10-31 | `951dd914edb8` | feat(platform): add standalone AI Coach Lab with explicit consent (#25) |
| 2026-11-01 | `e9559306e722` | Merge pull request #30 from FormPilot-Team/feature/platform-coach-agent-protocol-v2 |
| 2026-11-07 | `407da6233e64` | feat(platform): fp-cdm trained decision model pipeline (M1 trained, M2 awaiting human labels) |
| 2026-11-07 | `af83d2e0a8d7` | feat(platform): fp-cdm research round 2 - M1 nested LOPO, M2 dev research, retrieve-then-rerank, Lab v2 |
| 2026-11-08 | `37df6d414520` | feat(platform): fp-cdm browser decision engine with frozen release binding |
| 2026-11-09 | `824126d5e4a1` | test(platform): Web V1 unit + e2e coverage; demo video load fix; 动作工坊 wording in prototype |
| 2026-11-12 | `cdabbc453c53` | feat(workshop): deliver FormPilot workshop V2 creation and recognition flow |
| 2026-11-12 | `873313c8a453` | Merge origin/main (PR #56 动作工坊 V2) into Web V1 |
| 2026-11-13 | `4c1336fa73e7` | feat(platform): integrate FormPilot Web V1.1 and Workshop V2 |
| 2026-11-13 | `307e9fedda23` | feat(platform): local LLM agent for AI Coach (tools, RAG, guard, bridge) |
| 2026-11-13 | `890c6f6389c4` | feat(web): AI Coach free-text chat on the local LLM agent |
| 2026-11-13 | `aeac2a8d0883` | test(platform): real-model agent and RAG evaluation, V1.2 docs |
| 2026-11-13 | `dc18b3c046f7` | fix(platform): show agent answers only after validation |
| 2026-11-13 | `0676506210f8` | feat(platform): Web V1.2.1 Qwen LLM Agent, RAG and final release checks (#58) |

## V1.2.2 真实增量

2026-11-16 正式 main 的 PR #60 修复 `9aba92e…` 经同范围路径过滤映射为 `98c86b6d9c49d6781acc4150b8f75d1174856d68`，保留原元数据与消息，通过普通 merge `5f0e1e35…` 合入此前 submission 分支。修复动作卡片图标与自定义正式训练开始/恢复手势，阈值和正式识别数据不变；新增几何、模型及 E2E 回归。后续 README、封版、CI 和校验提交均按实际当前时间记录。
