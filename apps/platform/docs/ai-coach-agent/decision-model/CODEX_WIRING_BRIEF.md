# Codex 最小接入指令：FormPilot 决策模型（fp-coach-decision/v1）

把下面整段交给 Codex 即可。不需要研究模型内部；完整说明见同目录 `WEB_INTEGRATION_READY.md`。

---

任务：在 FormPilot Web 的 AI Coach 推荐展示处接入决策引擎 `recommendCoachDecision`，默认行为保持不变（OFF = 现有 Agent Web P0 规则推荐）。

范围与禁止事项：
- 仓库 `F:\FormPilot\FormPilot_GitHub`，独立 feature 分支，普通 PR，目标 main，保持 Open；不合并、不改 main。
- 只改 Web 负责人已获批准、归属于本任务的页面 / 组件 / 配置文件。**不改** `apps/platform/src/features/coachAgent/**`（含 `decisionModel/**`、权重、M1 内容表）、`apps/platform/server/coachAgent/**`、训练 / 评分 / 动作工坊 / 游戏本体。
- 不新增 npm 依赖，不发网络请求，不接 Qwen、StartLux 或付费 API。

实现：
1. 新增 Web 配置常量：`COACH_DECISION_MODE = 'off'`，`COACH_ALLOW_EXPERIMENTAL = false`（是否改为 `shadow` / `active` 由负责人决定）。
2. 在 Web 负责人指定的 AI Coach 推荐页面中调用引擎（目前没有页面调用 `getCoachWebRecommendation`；现有独立预览页 `sprint/CoachSprint.tsx` 直接调用 `recommendCoach(profile, context)`，正式页面若沿用它，就替换这一调用，见 `WEB_INTEGRATION_READY.md` §1.1）：
   ```ts
   import { recommendCoachDecision, COACH_DECISION_CONTRACT } from '<相对路径>/features/coachAgent/decisionModel/engine'
   const res = recommendCoachDecision({ contract: COACH_DECISION_CONTRACT, profile }, { mode: COACH_DECISION_MODE, allowExperimentalModel: COACH_ALLOW_EXPERIMENTAL })
   ```
   用户在 AI Coach 中授权读取本机训练记录后，改用
   `collectLocalDecisionInput(profile, { storage: window.localStorage, now: Date.now(), consent: 'granted' })`（从 `.../decisionModel/engine/platform` 导入）生成输入。
3. 渲染 `res.display`：结构与原 `CoachWebResponse` 的 `result` / `answers` 相同，原有组件直接复用。`res.status` 的处理与原来相同（ready / empty / profile_required / safety_hold / error）。`status === 'error'` 时 `display` 为 null，显示 `res.error.message`。
4. 来源标识：`res.decisionOrigin === 'model'` 显示“训练模型推荐”；若 `res.model?.tier === 'ai_experimental'`，同时显示 `res.model.tierLabel`（“实验性：AI 标注弱监督训练……”）。否则显示“规则推荐”。
5. 解释（可折叠）：每项的 `res.ranking.find(x => x.id === item.entry.id)` 提供 `suitability`、`reasons`、`explanation`（`label` + `points` 画正负条）。顶部可显示 `res.confidence`。
6. 回退：`res.fallbackReason` 非 null 时展示的就是规则结果，无需额外处理；`MODEL_ABSTAINED` 可加一句“模型把握不足，已使用规则推荐”。`safety_hold` 时不展示任何训练或游戏。开发环境打印 `res.inputIssues`。
7. 规则结果中若有 Web 判定不可用的游戏或功法，渲染时置灰或隐藏；把这些 id 同时作为 `availability.unavailableIds` 传入引擎。
8. 用 `try/catch` 包住调用；异常时结束 loading、清空旧结果、提供重试。
9. SHADOW 验收日志（只在开发 / 验收构建中）：每次调用后用 `toShadowLogEntry(res, { at, elapsedMs })`（从 `.../decisionModel/engine/shadow` 导入）生成一条记录，追加到 `localStorage[COACH_DECISION_SHADOW_LOG_KEY]`（最多 `COACH_DECISION_SHADOW_LOG_MAX` 条），开发面板提供“导出 SHADOW 日志”和“清空”。正式构建不记录；任何构建都不上传。

验收（写进 PR 正文，逐项给证据；未运行写 NOT RUN）：
- `WEB_INTEGRATION_READY.md` §9 的 12 项 E2E（期望值已写在表中，逐项对照）。
- `WEB_INTEGRATION_READY.md` §10 的 SHADOW 验收：需要队员在各自设备上试用，未完成时写 NOT RUN，不要用合成数据代替。
- `pnpm --dir apps/platform typecheck`、`lint`、`test` 与生产构建通过。
- 截图：OFF、SHADOW、ACTIVE（批准）、风险暂停、模型弃权，各 1366 px 与 375 px。
- 不得把模型推荐称为专家建议或医学结论。
