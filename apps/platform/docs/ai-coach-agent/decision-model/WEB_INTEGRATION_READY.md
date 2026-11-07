# WEB_INTEGRATION_READY：FormPilot 决策模型 Web 接线说明

适用版本：发布 `fp-cdm-release/1.0.0`，契约 `fp-coach-decision/v1`（冻结），模型 `fp-cdm-m2 v1.0.0`，运行时 `1.2.0`。更新：2026-11-08。
负责人：KiyOm1Lykke。Web 接收人：wang-linn-dw。也可以直接交给 Codex 按本文接线（最小指令见 `CODEX_WIRING_BRIEF.md`）。

一句话：在 Web 里调用**一个同步函数** `recommendCoachDecision(input, { mode })`，把返回的 `display` 按 Agent Web P0 的方式渲染即可。特征提取、模型加载、排序、校准、弃权、安全复核全部在函数内部完成。

> **模型身份必须如实展示**：当前发布的排序模型是用单一 AI 标注者的标签训练的**实验性模型**，不是人工或专家验证。产品默认 `OFF`；`ACTIVE` 需要负责人批准，并且界面必须带“实验性模型”标识（见 §6）。

## 1. 前提：分支与合并顺序

| 顺序 | PR | 内容 | 基线 |
| --- | --- | --- | --- |
| 1 | [#49](https://github.com/FormPilot-Team/FormPilot/pull/49) | PR #49 规则排序器（手工权重，作为基线与候选检索的一部分） | `main` |
| 2 | [#50](https://github.com/FormPilot-Team/FormPilot/pull/50) | fp-cdm 训练流水线、M1、M2（AI 标签实验）、评测 | #49 |
| 3 | 本阶段 PR | **决策引擎 `engine/`、发布权重、契约、测试、Lab v3、本文档** | #50 |

三个 PR 都只改 `apps/platform/src/features/coachAgent/decisionModel/**`、`apps/platform/scripts/decision-model/**`、`apps/platform/tests/coach-*`、`apps/platform/docs/ai-coach-agent/decision-model/**`，**不改任何页面、路由、样式、构建配置或 Agent Web P0 文件**。Web 分支只需在三个 PR 合并后（或先基于本阶段分支）开始接线。负责人决定合并；在此之前可以基于分支 `feat/coach-decision-integration-ready` 联调。

## 2. 需要引入的文件与依赖

- **只引入一个模块**：`apps/platform/src/features/coachAgent/decisionModel/engine`（`index.ts`）。
- 可选：`engine/platform`，用于从本机训练记录生成输入（需在用户授权后调用，见 §4.2）。
- **不需要安装任何依赖**：纯 TypeScript + JSON 导入，与平台现有 Vite / TypeScript 配置兼容（已实际构建验证）。不需要 Node polyfill、后端服务、环境变量、网络、GPU、Qwen、StartLux 或付费 API。
- 引擎内部会用到（已随 PR 提供，**Web 不要修改**）：`decisionModel/cdm/*`（特征、模型、Guard、解释、权重 `fp-cdm-m2.weights.json`、M1 内容表 `m1ContentFeatures.json`）、`decisionModel/ranker.ts`、`decisionModel/adapter.ts`、`decisionModel/descriptors.ts`、`motionDescriptors.json`，以及 Agent Web P0 的 `recommendation/*`。
- 包体（含 P0 规则、PR #49、权重、M1 内容表）：Vite 生产构建的单独 chunk 约 141 KB（未压缩），esbuild min 164 KB / gzip 45 KB。

## 3. 调用接口

```ts
// 从 apps/platform/src 内按组件位置调整相对路径
import {
  recommendCoachDecision, describeCoachDecisionModel, COACH_DECISION_CONTRACT,
  type CoachDecisionInput, type CoachDecisionResponse,
} from '../features/coachAgent/decisionModel/engine'

const input: CoachDecisionInput = { contract: COACH_DECISION_CONTRACT, profile }   // profile = AI Coach 画像表单（CoachProfile v1）
const res: CoachDecisionResponse = recommendCoachDecision(input, { mode: COACH_DECISION_MODE })
// COACH_DECISION_MODE 由 Web 的功能开关提供：'off'（默认）| 'shadow' | 'active'
```

- 同步、无副作用、不读写存储、不发网络请求。同一输入得到相同输出。每次返回一个与引擎隔离的 JSON 快照。
- `describeCoachDecisionModel()` 返回模型卡：发布号、版本、标签层级、权重指纹、完整性状态（`bundleStatus: 'ok'` 或失败原因）。“模型信息”面板和自检用它。
- 不要直接调用 `cdm/` 内部函数（`inferCdm`、`buildFeatures` 等），也不要调用 `createCoachDecisionEngine`；后者只供测试和 Lab 使用。

### 3.1 输入类型（完整定义见 `engine/contract.ts`）

```ts
interface CoachDecisionInput {
  contract: 'fp-coach-decision/v1'
  profile: CoachProfile                          // version, goals, difficulties, regions, preference, risk, acknowledged
  trainingHistory?: { origin: 'live_local_records' | 'synthetic_demo'; chapters: Array<{
    chapterId: string                            // 目录章节 id，如 "bdj-3"
    sessions: number                             // >= 1 的整数
    completedSessions?: number | null            // 0..sessions
    meanScore?: number | null                    // 跟练相似度 0..100
    trend?: 'up' | 'flat' | 'down' | null
    lastPracticedAt?: number | null              // epoch 毫秒
  }> } | null
  gameHistory?: { origin: 'live_local_records' | 'synthetic_demo'; games: Array<{
    gameId: 'apple' | 'boating' | 'archery' | 'racing'; plays: number; completedPlays?: number | null; lastPlayedAt?: number | null }> } | null
  latestReport?: { origin: 'live_local_records' | 'synthetic_demo'; createdAt?: number | null; findings: Array<{
    focus: 'reach' | 'stability' | 'coordination' | 'rhythm'; subjectId: string; score?: number | null; trend?: 'worse' | 'same' | 'better' | null }> } | null
  availability?: { snapshotRef: string; unavailableIds: string[] } | null   // 当前不能启动的功法 / 章节 / 游戏 id
  now?: number                                   // 计算“几天前”用的时间；默认当前时间
}
interface CoachDecisionOptions { mode?: 'off' | 'shadow' | 'active'; allowExperimentalModel?: boolean }
```

输入是**严格校验**的：未知字段、目录外 id、越界数字、未来时间都会被拒绝。被拒绝时模型不运行，返回规则结果，并在 `inputIssues` 里给出 JSON 路径与原因（`fallbackReason: 'INPUT_INVALID'`）。缺失的历史或报告直接省略即可，模型按“缺失”处理，不会编造。

### 3.2 输出类型（摘要；完整定义见 `engine/contract.ts`）

```ts
interface CoachDecisionResponse {
  contract: 'fp-coach-decision/v1'
  mode: 'off' | 'shadow' | 'active'
  status: 'ready' | 'empty' | 'profile_required' | 'safety_hold' | 'error'   // 与 display 一致
  decisionOrigin: 'rules' | 'model'          // display 由规则服务还是训练模型产生
  display: { result: CoachRecommendationResult; answers: Record<CoachQuestion, string> } | null  // 直接渲染；与 Agent Web P0 结构相同
  ranking: CoachDecisionRankedItem[]          // 模型对候选的完整排序（SHADOW / ACTIVE）；模型未运行时为 []
  programmes: Array<{ programId; title; score; suitability }>   // 功法层面的视图
  model: CoachDecisionModelInfo | null        // 模型身份：发布号、版本、tier、tierLabel、指纹……
  execution: 'disabled' | 'not_run' | 'executed' | 'failed'
  confidence: number | null                   // 首选胜过第二名的校准概率
  abstained: boolean
  abstainReason: 'LOW_SUITABILITY' | 'OUT_OF_DISTRIBUTION' | 'NO_CANDIDATES' | null
  outOfDistributionFeatures: string[]
  fallbackReason: CoachDecisionFallbackReason | null   // display 为规则结果的原因；null = 展示的是模型结果
  comparison: DecisionComparison | null       // 模型推荐与规则推荐的差异
  guard: { checked: boolean; violations: string[] }
  inputIssues: Array<{ path: string; message: string }>
  dataSources: { profile: 'self_reported'; trainingHistory; gameHistory; latestReport; catalogue: 'trusted_project_catalogue' }
  rules: CoachWebResponse                     // 原 Agent Web P0 输出，未修改
  error: null | { code: 'INVALID_REQUEST'; message: string }
  limitations: string[]
  executedActions: false
}
interface CoachDecisionRankedItem {
  rank: number; id: string; kind: 'chapter' | 'game'; programId: string | null; title: string
  href: string | null; launch: 'in_app_route' | 'external_app'
  score: number            // 模型分数，只在同一次响应内可比
  suitability: number      // 校准的“适合”概率（标注者打 ≥2 分的概率），不是医学概率
  inSlate: boolean         // 是否在模型推荐组合中（≤3 章节且来自 ≤2 套功法，≤2 个游戏）
  reasons: string[]        // 中文理由句，如“覆盖你关注的部位：肩部、上肢”
  explanation: Array<{ feature; label; group: 'P' | 'H' | 'R'; groupLabel; value; points }>   // 前 6 个特征贡献
}
```

标准 JSON 示例在 `docs/ai-coach-agent/decision-model/examples/`，**全部由真实引擎调用生成**（`scripts/decision-model/cdm/export-examples.ts`），不是手写：

| 文件 | 场景 |
| --- | --- |
| `request.minimal.json` / `request.full.json` | 仅画像 / 画像 + 训练历史 + 游戏历史 + 报告 + 可用性 |
| `response.off.json` | 默认 OFF（= Agent Web P0） |
| `response.shadow.json` | SHADOW：展示规则，ranking 为模型结果 |
| `response.active-not-approved.json` | ACTIVE 但未批准实验性模型 → 规则 |
| `response.active-approved.json` | ACTIVE + 批准 → 展示模型推荐 |
| `response.safety-hold.json` | 风险画像 → 安全暂停，模型不运行 |
| `response.abstain-out-of-distribution.json` | 4 个部位 → 分布外弃权 → 规则 |
| `response.abstain-recent-practice.json` | 首选章节 2 天前刚练过 → 分布外弃权 → 规则（已知局限） |
| `response.input-invalid.json` | 历史中有目录外章节 → INPUT_INVALID → 规则 |
| `response.error-invalid-envelope.json` | 缺少 contract → status `error`，display `null` |
| `response.model-missing.json` | 权重缺失 → MODEL_MISSING → 规则 |

## 4. Web 字段映射

### 4.1 映射表

| 契约字段 | Web 来源 | 处理 | 状态 |
| --- | --- | --- | --- |
| `contract` | 常量 `COACH_DECISION_CONTRACT` | — | 可用 |
| `profile.goals` | AI Coach 画像表单“训练目标”（多选） | `mobility / upper_limb / daily / rehab_support` | 可用（表单已存在，CoachProfile v1） |
| `profile.difficulties` | 画像表单“困难”（多选） | `stiffness / reach_difficulty / soreness / sedentary / none`；`none` 不与其他项共存 | 可用 |
| `profile.regions` | 画像表单“关注部位”（多选） | `shoulders / neck / arms / trunk / legs` | 可用 |
| `profile.preference` | 画像表单“偏好”（单选） | `routine / game / mixed` | 可用 |
| `profile.risk` | 画像表单“当前风险”（单选） | `none / acute_pain / dizziness / recent_injury` | 可用 |
| `profile.acknowledged` | 画像表单“我已了解”勾选 | 必须为 `true` | 可用 |
| `trainingHistory` | 本机功法跟练记录 `localStorage['formpilot.routine-sessions:v1']` | 用户授权后：`parseStoredRoutineSessions` → `historyFromRoutineSessions`（或直接用 `collectLocalDecisionInput`）。只计入 live、正常速度、已结束的会话；章节覆盖 ≥80% 视为完成；分数 = 平均跟练相似度 ×100；趋势 = 最近两次分数差 ≥5 为 up、≤−5 为 down | 可用（需授权） |
| `trainingHistory`（热身 / 智能训练） | 热身记录 | 不属于功法目录，不传 | 不适用 |
| `gameHistory` | 体感游戏记录 | **平台目前没有游戏历史仓储**（Motion Games Lab 是独立应用）。不传即可；接口已就绪，游戏侧有持久记录后按 `{gameId, plays, completedPlays, lastPlayedAt}` 映射 | **BLOCKED**（缺数据源） |
| `latestReport` | 最近一次功法训练的报告分项 | 用户授权后由 `collectLocalDecisionInput` 通过既有的 `readRecommendationContext` 读取最近一次 live 会话的待关注分项，映射为 `{focus, subjectId}`；目前分项分数和趋势不是结构化字段，传 `null` | 可用（需授权；分数 / 趋势为 null） |
| `availability` | Web 宿主对当前可启动内容的判断（如游戏未安装、视频缺失） | `unavailableIds` 只能是目录 id（功法 id、章节 id、游戏 id）；`snapshotRef` 填任意可追溯标识 | 可选 |
| `now` | — | 一般不传；演示录屏时可固定 | 可选 |
| 演示数据 | Web 的“合成演示”入口 | `origin: 'synthetic_demo'`；界面必须显示“合成演示数据，不代表本人” | 可选 |

目录 id 一览：功法 `baduanjin / taijiquan / wuqinxi / yijinjing`；章节 `bdj-open, bdj-1…bdj-8, bdj-close, tjq-1…, wqx-…, yjj-…`（见 `recommendation/catalogue.ts` 的 `COACH_KNOWLEDGE`）；游戏 `apple / boating / archery / racing`。

### 4.2 从本机记录生成输入（用户授权后）

```ts
import { collectLocalDecisionInput } from '../features/coachAgent/decisionModel/engine/platform'

const input = collectLocalDecisionInput(profile, { storage: window.localStorage, now: Date.now(), consent: userConsented ? 'granted' : 'denied' })
const res = recommendCoachDecision(input, { mode: COACH_DECISION_MODE })
```

`consent: 'denied'` 时只返回画像输入。函数只读、不写、不上传；内部复用平台既有的严格解析器与读取器。授权文案沿用 AI Coach 现有的数据使用说明，不扩大范围。

## 5. 运行模式（功能开关）

| 模式 | 用户看到 | 模型 | 用途 |
| --- | --- | --- | --- |
| `off`（默认） | Agent Web P0 规则结果（与现在完全一致） | 不运行 | 正式默认值 |
| `shadow` | 规则结果 | 运行；`ranking`、`comparison` 可用于开发面板或日志 | **联调推荐模式** |
| `active` | 模型推荐（或回退时的规则结果） | 运行 | 需负责人批准；当前模型为实验性，必须同时传 `allowExperimentalModel: true`，否则回退规则（`EXPERIMENTAL_MODEL_NOT_APPROVED`） |

建议在 Web 配置里放一个常量，例如 `COACH_DECISION_MODE = 'off'`、`COACH_ALLOW_EXPERIMENTAL = false`。是否改为 `active` 由负责人决定；Web 不在代码里默认打开。

## 6. 如何展示

### 6.1 推荐结果

- 渲染 `res.display.result`，结构与 Agent Web P0 的 `result` 相同：`routines`（功法方向）、`chapters`、`games`，每项含 `entry`、`reasons`、`evidenceIds`、`basis`。现有 P0 展示组件可直接复用。
- 跳转：只用非 null 的 `entry.href`。章节为站内路由 `/routines/:programId/train?form=:chapterId`；功法方向 `href` 为 null，从章节进入；游戏 `href` 为 null，`launch: 'external_app'`，按游戏中心既有方式启动。
- 来源标识：`res.decisionOrigin === 'model'` 时显示“训练模型推荐”；若 `res.model.tier === 'ai_experimental'`，**同时显示“实验性模型（AI 标注训练，未经人工验证）”**（文案可用 `res.model.tierLabel`）。规则结果显示“规则推荐”。
- 每项的模型分数：用 `res.ranking.find(x => x.id === item.entry.id)`，可展示 `suitability`（如“适配度 86%”，注明不是医学概率）。
- 合成数据：`dataSources.*` 为 `synthetic_demo` 时显示合成标签。
- `res.limitations` 放在结果底部的“说明”里。

### 6.2 模型解释

- 简要：每项的 `reasons`（中文短句）。
- 详细（可折叠）：`ranking[i].explanation` 画成正负条形图，`label` 为中文特征名，`points` 为加分（正）或减分（负），`groupLabel` 为“画像与内容 / 训练历史 / 最近报告”。
- 置信度：`res.confidence`（首选胜过第二名的概率）。
- 模型信息面板：`describeCoachDecisionModel()` 的 `release`、`model.version`、`model.tierLabel`、`model.weightsFingerprint`、`model.validation`（`offlineTechnical: passed / humanValidation: pending / productAcceptance: not_accepted`）。

## 7. 风险、弃权与异常

引擎内部不会抛出异常（模型异常已在内部回退）。宿主仍应 `try/catch` 包住调用，出错时结束 loading、清空旧结果并提供重试。

| `status` | 处理 |
| --- | --- |
| `ready` | 正常渲染 `display` |
| `empty` | 规则与模型都没有候选；显示 `display.result.message`，不补造内容 |
| `profile_required` | 显示 `display.result.message`，引导完善画像 |
| `safety_hold` | **显示暂停文案与专业咨询提示；不展示任何训练或游戏，不自动替换**。模型不会被调用 |
| `error` | `display` 为 null；显示 `res.error.message`（这是接线错误，修正请求即可） |

| `fallbackReason` | 含义 | 界面 |
| --- | --- | --- |
| `null` | 展示的是模型推荐 | 显示“训练模型推荐”（+ 实验性标识） |
| `MODEL_DISABLED` / `SHADOW_MODE` | 模式决定展示规则 | 正常显示“规则推荐” |
| `MODEL_ABSTAINED` | 模型弃权（`abstainReason`：`LOW_SUITABILITY` 没有足够合适的候选；`OUT_OF_DISTRIBUTION` 输入超出训练范围） | 显示规则推荐，可加一句“模型对该情况把握不足，已使用规则推荐” |
| `SAFETY_HOLD` / `PROFILE_REQUIRED` | 见上表 | 同上 |
| `INPUT_INVALID` / `INVALID_AVAILABILITY` | Web 传入的数据不合规（看 `inputIssues`） | 显示规则推荐；开发环境打印 `inputIssues` 并修复映射 |
| `MODEL_MISSING` / `MODEL_NOT_TRAINED` / `WEIGHTS_INVALID` / `MODEL_VERSION_MISMATCH` / `LABELS_NOT_ACCEPTED` / `CATALOGUE_MISMATCH` / `CONTENT_FEATURES_MISMATCH` | 模型文件缺失、被改动或与代码不一致 | 显示规则推荐；这是构建问题，检查是否完整合并了模型文件 |
| `EXPERIMENTAL_MODEL_NOT_APPROVED` | ACTIVE 但未批准实验性模型 | 显示规则推荐 |
| `NO_CANDIDATES` | 安全筛选后没有候选 | 显示规则结果 |
| `MODEL_ERROR` / `OUTPUT_GUARD_REJECTED` | 推理异常 / 独立 Guard 拒绝 | 显示规则推荐；记录日志 |
| `UNBOUND_WEIGHTS` | 只会在 Lab / 测试中出现 | — |

安全不变式（已测试）：风险画像不调用模型；受限画像（抬手困难、酸痛、康复辅助意向）不会得到含过顶 / 平衡 / 转体 / 俯身 / 负重注意项的内容；不可用内容不会被排序或展示；模型输出必须通过独立 Guard，否则整体回退。**Web 不需要、也不应该自行再做这些判断或改写结果。**

注意：规则服务（P0）本身不接收 `availability`。回退到规则结果时，若其中包含 Web 标为不可用的游戏或功法，请在渲染时置灰或隐藏该项（只影响展示，不修改结果对象）。

## 8. 已知局限（展示与答辩时如实说明）

1. 排序模型的标签来自单一 AI 标注者，未经人工或专家验证；场景是合成的。
2. 首选章节如果在 **0–2 天内刚练过**，超出训练数据范围（训练中被练过的候选都在 4–20 天前），模型会弃权并回退规则。活跃用户会经常遇到；修复需要新的标注场景，不放宽规则。
3. 只选“上肢”或只选“下肢”等少数画像，模型置信不足而弃权（冷启动画像中约 8.7% 低适配弃权、0.9% 分布外弃权）。
4. 训练目标对排序的影响主要通过候选检索体现；“目标 × 内容侧重”特征在开发集上没有增益。
5. 历史越多，模型越倾向衔接已练内容；报告主要把报告所指的那一章重新排到前面。
6. 没有游戏历史数据源。

## 9. E2E 验收清单

在 Web 的正式入口完成接线后，逐项执行并保留截图 / 录屏：

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 默认配置（OFF）提交画像 | 推荐与当前 Agent Web P0 完全一致；`decisionOrigin: rules` |
| 2 | SHADOW 提交同一画像 | 用户看到的仍是规则推荐；开发面板能看到 `ranking`（约 12 项） |
| 3 | ACTIVE + `allowExperimentalModel: true`，画像 = 上肢功能练习 / 僵硬感 / 肩部 + 上肢 / 混合 | 显示“训练模型推荐 + 实验性模型”；章节首位为「易筋经 · 韦驮献杵第一势」，每项有中文理由 |
| 4 | ACTIVE 不批准实验性模型 | `fallbackReason: EXPERIMENTAL_MODEL_NOT_APPROVED`，显示规则推荐 |
| 5 | 风险选“眩晕” | 暂停推荐、无任何训练 / 游戏；模型未运行 |
| 6 | 关注部位选 肩、颈、上肢、下肢，目标肩颈活动，偏好功法 | `MODEL_ABSTAINED / OUT_OF_DISTRIBUTION`，显示规则推荐 |
| 7 | 授权读取本机记录后再推荐 | `dataSources.trainingHistory: live_local_records`（若有记录）；拒绝授权时为 `missing` |
| 8 | 把“林间射箭”标为不可用 | 模型推荐中不出现林间射箭 |
| 9 | 故意传一个未知字段 | `INPUT_INVALID`，`inputIssues` 指出字段路径，仍显示规则推荐 |
| 10 | 浏览器开发者工具 Network | 推荐过程不产生任何网络请求 |
| 11 | 性能 | 单次调用 < 10 ms（开发机实测 p50 约 1–2 ms）；首次调用 < 50 ms |
| 12 | 1366 px 与 375 px 宽度 | 推荐与解释正常显示，无横向滚动 |

Lab（`coach-decision-lab-v3.html`）中“现场案例”和“实时决策”区域可以对照验证上述结果，两者调用的是同一个函数。

## 10. 不要做的事

- 不要修改 `decisionModel/**`、权重或 M1 内容表（修改会让完整性校验失败并回退规则）。
- 不要把 `ranking`（模型排序）当作 OFF / SHADOW 模式下给用户看的推荐。
- 不要在 Web 里重写安全过滤、排序或弃权逻辑，也不要把弃权改成“强行展示模型结果”。
- 不要把模型结果描述为“专家推荐”“医学建议”或“康复效果”。
- 不要在没有负责人批准时把模式设为 `active` 或把 `allowExperimentalModel` 设为 `true`。
