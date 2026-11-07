# fp-cdm 训练模型：Web 集成交接

面向 Web 负责人（wang-linn-dw）。本 PR 没有修改页面、路由、构建入口或 `package.json`；以下是可选接入的接口说明。请求契约与 P0 / PR #49 相同，默认 `off`。

## 入口

```ts
import { getCoachCdmRecommendation } from './features/coachAgent/decisionModel/cdm'

const r = getCoachCdmRecommendation(request, {
  mode: 'shadow',                     // 'off'（默认）| 'shadow' | 'active'
  availability: { snapshotRef: 'competition-build', unavailableIds: ['racing'] },  // 可选，只删不加
  state,                              // 可选：宿主用 Reader 构建的 DecisionState，其 profile 必须与 request.profile 完全一致
})
```

- 同步执行；p95 约 2 ms（开发机 CPU）；无网络、无存储、无 GPU。
- `mode`、`availability`、`state` 只能由可信宿主代码提供，不能来自 URL、表单或请求体。
- **当前内置权重是 `AWAITING_LABELS` 占位**：任何模式下 `fallbackReason = MODEL_NOT_TRAINED`，页面显示规则结果。AI 标签实验权重不会被加载器接受；比赛演示请使用离线 Lab 页面，不要接入正式页面。

## 响应（`CdmResponse`）

| 字段 | 语义 |
| --- | --- |
| `rules` | P0 原样输出，始终存在 |
| `active.status / result / answers` | 页面应渲染的内容；`result` 与 P0 同形 |
| `decisionOrigin` | `rules` 或 `model` |
| `modelExecution` / `fallbackReason` | `MODEL_DISABLED`、`SHADOW_MODE`、`REQUEST_INVALID`、`PROFILE_REQUIRED`、`SAFETY_HOLD`、`MODEL_NOT_TRAINED`、`WEIGHTS_INVALID`、`INVALID_AVAILABILITY`、`STATE_PROFILE_MISMATCH`、`MODEL_ERROR`、`MODEL_ABSTAINED`、`OUTPUT_GUARD_REJECTED` |
| `model.model` | `id`、`version`（权重版本）、`runtimeVersion`（1.1.0）、`trainedWeights: true`、`family`、`labelsSha256`、`matrixSha256`、`featureSet` |
| `model.candidates[]` | 第一阶段检索出的 ≤12 个候选：`score`（同一用户内的相对分）、`suitability`（校准后的“适合”概率）、`contributions`（P/H/R 特征贡献，最多 6 项） |
| `model.confidence` | top-1 相对 top-2 的校准偏好概率 |
| `model.abstainReason` / `oodFeatures` | `LOW_SUITABILITY` / `OUT_OF_DISTRIBUTION`（附超出训练范围的特征）/ `NO_CANDIDATES` |
| `model.retrieval` | `k`、安全池大小、各检索来源的数量 |
| `model.stateOrigin` | 历史 / 报告的来源：`live_reader`、`synthetic_scenario`、`synthetic_fixture` 或 `missing` |
| `guard` / `comparison` | 独立 Guard 的结果；与规则结果的差异 |
| `executedActions` | 恒为 `false` |

## 必须展示的来源语义

| 条件 | 文案要点 |
| --- | --- |
| `decisionOrigin = rules` | “本地规则建议”，并说明 `fallbackReason` |
| `decisionOrigin = model` 且权重为人工标签 | “训练模型排序（依据团队 / 专业人员标注训练），非医学建议” |
| 任意 AI 标签实验 | 只在 Lab 中出现，必须带“AI 标注弱监督实验，非人工验证”水印 |
| `stateOrigin` 含 synthetic | 历史或报告旁标注“合成 / 演示数据” |
| 风险画像 | 暂停推荐；模型不会被调用 |

`score` 不是概率；`suitability` 是对标注者判断的校准估计，不是疗效或安全概率。
