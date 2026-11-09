# 负责人标签审阅记录（fp-cdm M2，2026-11-09）

| 项目 | 内容 |
| --- | --- |
| 审阅对象 | `fp-cdm-m2` v1.0.0 的训练 / 测试标签：720 条 AI 分级标签（1/2/3 = 243/336/141），来源为单一 AI 标注者，72 个合成场景（24 族 × 3 条件，6 族冻结测试） |
| 审阅人 | 项目负责人 KiyOm1Lykke |
| 日期 | 2026-11-09 |
| 结论（负责人陈述） | 负责人已亲自检查当前 AI 训练标签，未发现明显问题，同意继续使用现有数据作为当前竞赛候选模型的训练依据 |
| 后续安排 | 不再安排队友重新人工标注；不重新生成 A1 / A2 人工标注包；独立人工标注不作为 Web V1.0 的阻塞条件，留作未来研究方向 |

## 这次审阅意味着什么

- 模型在产品中的身份文案改为：**实验性模型：AI 标注训练，项目负责人已审阅标签，尚未进行独立人工或专家标注**（`engine.ts` 的 `TIER_LABEL`、Web AI Coach 页面、`MODEL_REPORT.md`、`WEB_INTEGRATION_READY.md`）。
- 负责人据此批准竞赛专用构建（`competition:build`，`vite build --mode competition`）以 ACTIVE 模式显示训练模型推荐，并显式传入 `allowExperimentalModel: true`。普通构建仍为 OFF。

## 这次审阅不意味着什么

- 不等同于两名独立标注者的一致性验证（没有 κ / 一致率），也不等同于医学或运动康复专家的金标准。
- 模型权重的标签层级仍为 `ai_experimental`，模型卡 `validation.humanValidation` 仍为 `pending`，`productAcceptance` 仍为 `not_accepted`。这些字段没有改动，也不应改为 `human` / `human_labels`。
- 不改变任何冻结结果：M2 冻结测试 NDCG@5 0.868（规则 P0 0.819，PR #49 0.797），成对准确率 0.873 / 0.707 / 0.732；模型 − P0 的 NDCG@5 差值 95% CI [−0.024, 0.122] 跨 0，**不能宣称模型统计显著优于规则**。
- 未重新训练、未调整权重 / 特征 / 超参数 / 测试集，没有再次使用冻结测试集。

## 证据

- 冻结发布：`fp-cdm-release/1.0.0`（`src/features/coachAgent/decisionModel/engine/release.ts`）、`scripts/decision-model/cdm/artifacts/integration/release-manifest.json`。
- AI 标签实验报告：`scripts/decision-model/cdm/artifacts/m2-ai-experiment/fp-cdm-m2.ai-experiment.report.json`。
- 本记录对应 PR #53（Web V1 正式接线）。
