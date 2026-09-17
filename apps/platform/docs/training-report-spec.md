# Training Report v1 规格

## Scope

Phase 6B 将完成弹层收敛为保存确认和“查看训练报告”入口，并新增独立 `/report/:sessionId` 页面。范围仅包含报告数据模型、确定性构建器、规则建议、响应式 UI、测试和文档；不包含历史中心、后端、登录、分享、PDF、LLM、医疗判断或新动作。

## Data Sources

报告唯一输入是已经持久化的 `TrainingSessionState schemaVersion=2`，并只读取其中的 Course 状态、Exercise Result、Rep Summary、metric averages 和 confirmed Feedback Events。Report Page 不加载 PoseDetector，也不调用 Exercise Engine、Rule Engine 或 FeedbackPolicy。相同 Session 输入必须得到完全相同的 `TrainingReportData report-v1`。

数据流固定为：

```text
TrainingSessionRepository
        ↓ get(sessionId)
TrainingSessionState v2
        ↓ TrainingReportBuilder（纯 TypeScript）
TrainingReportData report-v1
        ↓
TrainingReportPage
```

## Overall Score

- Complete：优先使用 Session 已冻结的 `courseOverallScore`，scope 为 `complete_course`。仅字段缺失时，才简单平均已经保存且有 rep 的五个 scored exercise 的 `overallScore`，并在 metadata 标记派生来源。
- Incomplete：绝不展示为完整课程总评。仅平均“已完成且有保存分数”的 scored exercise，label 为“已完成动作平均分”，scope 为 `completed_scored_average`，同时说明样本动作数；没有此类动作则为 `null / — / unavailable`。
- Shoulder Rotation 是 guidance，始终排除在 numeric overall 之外。

90–100、75–89、60–74、低于 60 的文字仅是产品展示区间，分别表达“表现稳定”“整体良好”“还有提升空间”“建议关注动作反馈”，不构成专业或医学评级。

## Complete / Incomplete

完整课程显示“训练完成”和 `6 / 6`。提前结束显示“训练未完成”和真实完成项数。缺失动作保持 `unavailable`，不会因为出现在课程定义中而被视为已完成。

## Guidance Exercise

Shoulder Rotation 卡片显示“引导完成 / 引导未完成”和已保存的 duration target，不生成 0–100 分。当前 Session 没有持久化 continuityRate、左右活动幅度或 syncQuality，因此报告明确不补算这些字段。未来只有事实数据进入 Session 后才能展示。

## Scored Exercise Presentation

五个 scored exercise 均展示动作名、保存的 overall score、目标进度、配置化主要指标、最多三个 confirmed issue 和一句克制总结：

| Exercise | 展示指标 |
|---|---|
| Overhead Raise | 幅度、肘部伸展、双臂同步、稳定性、节奏 |
| Lateral Raise | 幅度、对称性、稳定性、节奏、完成质量 |
| Step Jack | 协调性、幅度、节奏、稳定性、完成度 |
| Squat | 深度、稳定性、对称性、完成度、节奏 |
| Knee Raise | 幅度、稳定性、左右交替、对称性、节奏 |

## Capability Dimensions and Mapping

五个公共维度及显式来源如下。Squat 的 `amplitude` 在报告层展示为“深度”；Knee Raise 的 coordination 先在单动作内平均 `alternation + symmetry`，避免同一动作获得双倍权重。

| Dimension | Overhead | Lateral | Step Jack | Squat | Knee Raise |
|---|---|---|---|---|---|
| AMPLITUDE | amplitude | amplitude | amplitude | amplitude / 深度 | amplitude |
| STABILITY | stability | stability | stability | stability | stability |
| COORDINATION | synchronization | symmetry | coordination | symmetry | mean(alternation, symmetry) |
| TEMPO | tempo | tempo | tempo | tempo | tempo |
| CONTROL | unavailable（Completion 是 Rep Validity Gate，无 numeric metric） | completion | completion | completion | unavailable（当前无 numeric completion metric） |

每个维度只使用已完成 scored exercise 的可用值做简单平均，无权重、无 AI weighting。结果保留 contribution 和 `sampleCount / totalExerciseCount`。

## Missing Data

缺失 exercise、score 或 metric 使用 `null / unavailable`，绝不以 0 填充。少于两个已完成 scored exercise 时隐藏雷达图，但仍给出文字数值和“完成更多动作后可查看能力分布”。Radar 不是唯一信息来源。

## Top Issues

Issue 只来自 `feedbackEvents.kind === correction` 且带 error code 的 confirmed 事件，不读取逐帧 `errors[]`，也不从 `topErrors` 猜测。按 `exerciseId + errorCode` 聚合，记录 count、最大 severity、首次时间和无歧义 side；排序依次为 count 降序、severity 降序、首次时间升序、稳定 id，主报告最多三项。若同一组出现不同 side，side 置为 unavailable，避免误导。

零 confirmed issue 时显示“本次训练没有记录到明显的重复纠错问题”，并明确“没有记录到纠错不等于动作全部标准”。

## Recommendation Rules

规则建议最多三条，优先级为：confirmed 高频 issue → 明显最低 capability → 明显最低 exercise metric → 中性保持建议。已为深度不足、单侧手臂高度、手脚不同步、单侧提膝高度和身体晃动提供固定模板；未知 error 只复述可观测 report label。所有规则在 `recommendationRules.ts`，不在 JSX 拼接业务逻辑，不调用 LLM、VLM 或云 API。

## UI Structure

页面依次为 Header/Back、课程总结、能力维度、六个动作卡、本次最常见问题、下一次训练建议和完成/重新训练 CTA。视觉沿用浅色健康科技方向；雷达使用原生 SVG，无图表依赖。支持 1600×1000 与 390×844，并禁止页面级横向 overflow。

## Reload and Empty States

刷新 `/report/:sessionId` 时从 `LocalStorageTrainingSessionRepository` 重新读取 Session。ID 不存在、记录被清除或损坏时显示“未找到本次训练记录”，不白屏。还需优雅处理 incomplete、无 scored exercise、无 feedback、guidance-only 缺失和部分 metric 缺失。

## Non-claims

报告只描述系统真实测到和保存的动作现象，不推断病因、肌力、柔韧性、康复需求、疾病、伤病或医学风险，也不声称动作“全部标准”。
