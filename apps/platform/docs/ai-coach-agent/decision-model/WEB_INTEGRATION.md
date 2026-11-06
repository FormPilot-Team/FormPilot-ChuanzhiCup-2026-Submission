# fp-coach-ranker 适配层：Web 集成接口

面向 Web 负责人（wang-linn-dw）。本 PR **没有修改**页面、路由、构建入口、`package.json` 或 P0 文件。下面只描述可以选择接入的接口；是否接入、接在哪里，由 Web 负责人在 #41/#42 的文件归属内决定。

## 入口

```ts
import { getCoachDecisionRecommendation } from './features/coachAgent/decisionModel'
import type { CoachDecisionResponse } from './features/coachAgent/decisionModel'

// request 与 P0 完全相同：{ schemaVersion: 1, source: 'rules' | 'synthetic', profile }
const response: CoachDecisionResponse = getCoachDecisionRecommendation(request)            // 默认 off，等同 P0
const shadow = getCoachDecisionRecommendation(request, { mode: 'shadow' })                  // 运行模型，仍显示规则
const demo = getCoachDecisionRecommendation(request, {                                       // 受控演示
  mode: 'active',
  availability: { snapshotRef: 'competition-build-2026-11', unavailableIds: ['racing'] },
})
```

- 同步、无状态，返回可 JSON 序列化的独立快照；无网络、无存储、无 GPU。
- `mode` 和 `availability` **只能**由可信宿主代码传入，不能来自 URL、表单、聊天或请求体。请求体出现多余字段时，按 P0 规则返回 `error`。
- `DEFAULT_DECISION_MODEL_MODE = 'off'`。正式启用需负责人验收后另行决定；本 PR 不提供任何自动启用路径。
- `availability.unavailableIds` 可以填功法 id（会同时移除其章节）、章节 id 或游戏 id。未知 id 会让整个请求回退到规则（`INVALID_AVAILABILITY`），以防拼写错误被静默忽略。

## 响应字段

| 字段 | 语义 |
| --- | --- |
| `rules` | 原 P0 `CoachWebResponse`，逐字节未改，始终存在 |
| `decisionOrigin` | `rules` 或 `model`：表示 `active` 中的结果来自哪一方 |
| `active.status / result / answers` | 页面应渲染的内容。`result` 与 P0 的 `CoachRecommendationResult` 同形，现有卡片组件可直接使用 |
| `mode` | 实际生效的模式（未知值按 off 处理） |
| `modelExecution` | `disabled`（off）/ `not_applicable`（请求错误、画像不全、风险暂停、完整性或可用性不合格）/ `executed` / `failed` |
| `fallbackReason` | `MODEL_DISABLED`、`SHADOW_MODE`、`REQUEST_INVALID`、`PROFILE_REQUIRED`、`SAFETY_HOLD`、`INVALID_AVAILABILITY`、`INTEGRITY_MISMATCH`、`MODEL_ERROR`、`OUTPUT_GUARD_REJECTED`；模型结果生效时为 `null` |
| `model` | shadow/active 且守卫通过时存在：`priority`（统一优先级，含 `kind`、`launch`、`matchLevel`、`utility`、`contributions`）、`coverage.gaps`、`excluded`、`model` 身份（`trainedWeights:false`） |
| `guard` | `checked` 和 `violations`。有违规时 `model=null`，`active` 为规则结果 |
| `comparison` | 与规则结果对比：`rankingEffect`（identical / reordered / changed / not_compared）、`addedIds`、`removedIds`、`influencedIds` |
| `dataOrigin` | `self_report_profile` / `self_report_profile_with_synthetic_fixture` / `none` |
| `rulesAvailabilityConflicts` | 规则结果中仍然出现、但被宿主标记为不可用的条目（规则服务本身不接收可用性） |
| `executedActions` | 恒为 `false` |

## 必须展示的来源语义

| 条件 | 建议文案 |
| --- | --- |
| `decisionOrigin=rules` 且 `fallbackReason=MODEL_DISABLED` | “本地画像规则建议”（与 P0 相同） |
| `decisionOrigin=rules`，其他回退原因 | “决策模型未使用（原因：…），当前为规则建议” |
| `shadow` | 页面显示规则结果；如需对比，并排标注“决策模型（离线对照，未生效）” |
| `decisionOrigin=model` | “确定性可解释决策模型排序（未训练权重，未经真人验证）”，同时保留安全提示与 `limitations` |
| `dataOrigin` 含 synthetic | 每条证据都保留“合成样例”标签 |
| `coverage.gaps` 非空 | 明示“所选部位暂无可用的安全内容”，不要用其他内容冒充覆盖 |
| `kind=game` | `launch=external_app`、`href=null`：只提示“独立应用”，不要编造启动地址 |

不要把 `decisionOrigin=model` 写成 StartLux、AI 大模型、医学建议或真人验证结果。也不要把 `utility` 显示为概率或置信度。

## 宿主状态要求（与 P0 相同）

改动画像、切换来源或模式、退出时清除旧结果；服务本身没有 loading 状态；未知异常由宿主捕获，并回到规则结果或错误页。
