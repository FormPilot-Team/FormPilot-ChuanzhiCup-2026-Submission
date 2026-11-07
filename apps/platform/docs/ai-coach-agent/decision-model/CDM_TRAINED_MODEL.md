# FormPilot Competition Decision Model V1（fp-cdm）

> 最新完整结果、版本与结论状态以 [MODEL_REPORT.md](MODEL_REPORT.md) 为准。运行时 1.1.0 改为“两阶段检索 + 重排”，并采用新的 OOD 规则；Web 接口见 [WEB_INTEGRATION_CDM.md](WEB_INTEGRATION_CDM.md)。本文件保留第一轮的设计记录。

日期：2026-11-07。分支 `feat/coach-decision-model-trained`，叠加在 PR #49（`feat/coach-decision-model-v1`）之上；PR #49 的手工权重排序器 fp-coach-ranker 原样保留，作为对照基线（只新增了一个只读评测导出）。

## 当前状态

| 组件 | 状态 | 依据 |
| --- | --- | --- |
| M1 内容理解模型 `fp-cdm-m1` | **已训练**（HistGradientBoosting）。按功法留一（LOPO），在 9 个可学习标签上 macro AUC 0.761；PR #49 预注册描述符为 0.737，逻辑回归为 0.723 | 真实参考姿态观测 + 团队人工标签 |
| M2 偏好排序模型 `fp-cdm-m2` | **流水线、运行时、Guard 已完成；权重等待人工标注** | 两名独立标注者对 72 个合成场景（720 条/人）分级 |
| E1 / E3 / E6 | 需要人工标签，**尚未产生结果** | `train_m2.py --labels human` 一条命令完成 |
| E2 | 需要训练后的 M2 权重 | `evaluate-cdm.ts --weights …` |
| AI 标注弱监督实验 | 已完成。单一 AI 标注者（负责人 11-07 授权），只作为实验报告，权重不打包；见 [AI_LABEL_ROUND.md](AI_LABEL_ROUND.md) | 不是人工验证 |
| E4 安全 / E5 性能 | **已完成**（与权重无关；用固定 fixture 权重及对抗性权重测试） | `evidence/e2-e4-e5` |

M2 训练前，运行时内置的是 `status: AWAITING_LABELS` 占位权重，任何模式下都回退规则（`MODEL_NOT_TRAINED`），不会冒充训练模型。

## 架构（借鉴 StartLux，未复用其参数）

```
CoachWebRequest ──► P0 规则服务（不变；始终可回退）
宿主可信输入：availability、DecisionState（画像 + Reader 历史/报告；缺失即 missing，不补默认值）
   ▼ 前置门禁：请求合法、画像完整、风险暂停 → 不调用模型
   ▼ 安全候选池：P0 同款过滤 + 实测注意项并集 + 可用性快照（只能删减）
   ▼ fp-cdm-m2：111 维特征（P / H / R 三组，含 M1 输出）→ 线性偏好分
   ▼ 校准：Platt → 适配概率；成对温度 → top-1 置信度
   ▼ 弃权：最高适配概率 < τ，或输入超出训练分布 → MODEL_ABSTAINED → 规则
   ▼ 独立 Guard（自行重算安全池，不信任模型）→ 违规 → 规则
   ▼ off（默认）/ shadow / active；executedActions = false
```

| StartLux 设计 | FormPilot 对应 |
| --- | --- |
| 结构化状态、缺失语义 | `DecisionState`：history/report 为 `missing` 或 `present`，并标明 origin（live_reader / synthetic_scenario / synthetic_fixture） |
| 决策与执行解耦 | 只输出排序与解释，不启动训练、游戏或写入存储 |
| 结构化协议与自检 | `CdmResponse`：rules / active / model / guard / comparison / fallbackReason |
| 验证集温度标定的置信度 | 成对温度 T 与 Platt，均只在开发集 OOF 上拟合 |
| ABSTAIN 与原因码 | `LOW_SUITABILITY` / `OUT_OF_DISTRIBUTION` / `NO_CANDIDATES` → 规则 |
| 独立 Guard | `guardCdmOutput`；对抗性权重测试中，6,572 个受限画像看到的 caution 条目为 0 |
| 模型身份与哈希 | 权重文件绑定特征集版本、矩阵 SHA256 和标签文件 SHA256；只接受 `labels.kind = human` |
| Shadow / Active | 与 PR #49 相同的三种模式 |

不使用：StartLux 六动作标签、权重、训练数据、24/126 偏差。

## 数据与标签

- **真实观测**：参考轨迹 4 条，共 26,570 帧（单一示范者、二维）。
- **人工标签（团队，非专家）**：目录的部位与注意项标签，用于 M1。
- **人工判断（待收集）**：M2 的 0–3 分级。场景（画像、历史、报告）为分层抽样的**合成设计**；标注规范、双人独立、二次加权 κ ≥ 0.4 质量门、分差 ≥ 2 或安全疑虑进入仲裁，详见 `scripts/decision-model/cdm/annotation-kit/GUIDELINES.md`。
- **划分**：24 个场景族，其中 6 族（18 个场景）为冻结测试，在任何标签存在之前固定（SHA `11ad3c42…`）。同一画像的三种条件始终在同一侧。
- **不用于训练**：P0/PR #49 输出、89,280 画像枚举（只做覆盖评测）、30 个 persona、decision_eval（do-not-train）、StartLux 数据。

## 已完成的实验

- M1 LOPO：各功法留出时的逐标签 AUC 见证据 `m1/fp-cdm-m1.metrics.json`。最难的留出功法是太极拳。weight_bearing 只有 1 个正例章节，留一法下不可学习，单独报告。
- M2 流水线对照：植入信号测试 NDCG@5 为 0.88，成对准确率 0.82；随机标签测试分别为 0.51 和 0.48，模型与基线差值的置信区间跨 0。说明流水线能学到可学的信号、学不到噪声，**不代表模型效果**。
- E4 安全：13,392 个风险画像全部暂停，模型执行 0 次；22,320 个画像中受限 caution 泄漏 0、不可启动章节 0；对抗权重泄漏 0；不可用内容 0；低适配与分布外输入正确弃权；未训练时回退。
- E5 性能（CPU、单线程 Node）：单次 p50 0.59 ms / p95 2.83 ms；批量 1.16 ms/次；打包后冷启动导入 3.6 ms，首次调用 7.3 ms（中位数，7 个新进程），堆内存 4.8 MB；包体 137,298 B min；参数 337 个；不用 GPU。

## Web 集成接口（与 PR #49 相同的请求契约）

```ts
import { getCoachCdmRecommendation } from './features/coachAgent/decisionModel/cdm'
const r = getCoachCdmRecommendation(request, { mode: 'shadow' | 'active', availability, state })
// r.rules：P0 原样；r.active：页面渲染内容；r.decisionOrigin：'rules' | 'model'
// r.model.candidates[]：每个安全候选的 score / suitability / contributions（P/H/R 特征贡献）
// r.model.confidence：top-1 相对 top-2 的校准偏好概率；r.model.abstainReason
```

`state` 只能由可信宿主根据 Reader 构建，且其 profile 必须与请求一致，否则回退 `STATE_PROFILE_MISMATCH`。默认 `off`；PR 不修改任何页面、路由或构建入口。

## Coach Decision Lab（独立离线页面）

`scripts/decision-model/cdm/lab/build-lab.mjs` 生成单文件 HTML，把真实的 P0、PR #49 与 fp-cdm 模块打包进页面，在浏览器内实时计算。它不是 Vite 入口或应用路由，也不改动 Web 构建。生成器拒绝非人工标签的权重；`--fixture-preview` 只用于检查版面，页面会加上 FIXTURE PREVIEW 水印。

## 比赛演示方案（拿到标签并训练后）

1. Lab（独立页面，不接入正式用户页面）：选择 persona → 展示画像、历史、报告（标明合成）→ 列出全部安全候选及其适配分、校准概率、P/H/R 贡献 → 最终推荐与置信度 → 同一输入下 P0 / PR #49 的结果对照。
2. 图表：E1 测试集的 NDCG@5 与成对准确率（含 bootstrap CI）、E3 消融柱状图、M1 的 LOPO AUC、E5 延迟分布。
3. 误差案例：测试集中 top-1 不是最优的场景，逐项展示。
4. 局限页：合成场景、标注者资质、样本量（6 个测试族）。

## 风险与限制

- M2 的效果完全取决于人工标签的质量与数量：每人 720 条，测试族只有 6 个，置信区间会比较宽。
- 场景是合成设计，结论不外推到真实用户；也不代表康复效果。
- 标注者若为团队成员，结论只能写作“团队标注一致性”，不能写成专家判断。
- M1 是单一示范者的二维特征，样本为 59 章、4 个功法；取舍是在某些标签上胜过手工描述符、在另一些标签上不如。
