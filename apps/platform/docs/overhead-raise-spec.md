# Overhead Raise（双臂上举）engineering-v1 规则规格

## 冻结范围

本文件是 Phase 5 Closure 后的正式工程规格。它描述前视单目 Pose 管线可稳定解释的工程指标，不构成运动医学、康复或临床结论。生产阈值保持不变：TOP detection 138°、顶部合格 150°、肘角 150°、左右肩角差 12°、躯干侧倾 10°、完整周期 2–4 秒。

## Rep lifecycle 与完整性闸门

状态链固定为 `START → RAISING → TOP → LOWERING → COMPLETE`，连续 3 帧确认阶段变化。只有走完整条状态链并回到起始阈值的动作才生成 `completedRep` 并增加 `repCount`。

Completion 不属于数值评分维度，而是 Rep Validity Gate。只到 TOP、下降后未回到 START，或超过 6000 ms 未完成返回的 attempt，不得保存为正常完整 rep。超时 attempt 产生 `INCOMPLETE_REP`；即使其幅度、肘部伸展或同步指标很高，也不会生成高分 repetition 记录。

## 正式数值评分

| 维度 | 权重 | engineering-v1 语义 | 主要输入 |
|---|---:|---|---|
| Amplitude | 35% | 双臂顶部抬高幅度 | left/right shoulder angle、top amplitude |
| Elbow Extension | 25% | 双侧肘部是否接近伸直 | left/right elbow angle，采用动作期间较小肘角 |
| Synchronization | 20% | 左右双臂是否同步抬升，覆盖左右高度差与现有阶段一致性表达 | shoulder angle difference、已有工程同步指标 |
| Stability | 10% | 正面视角下的 torso lateral lean 与现有可靠稳定指标 | torso lean |
| Tempo | 10% | 完整动作周期是否位于 2–4 秒附近 | completedAt − startedAt |

权重合计 100%。`Synchronization` 不等于严格的时间同步生物力学分析；第一版主要依据左右肩角差和当前 Pose 管线已有的工程同步信号。代码中的原始特征名 `symmetryDiff` 保留为可测输入，但产品评分维度和权重键统一命名为 `synchronization`。

五个分项均采用连续工程评分，并在总分中按 `35/25/20/10/10` 加权。阈值用于错误判定，邻近阈值的小幅输入变化不会触发严重分数断崖。数值分只对姿态质量有效的帧计算；Completion 不出现在 metrics 或权重表中。

## 错误与保存字段

动作错误覆盖 `ARMS_TOO_LOW`、`ELBOW_TOO_BENT_L`、`ELBOW_TOO_BENT_R`、`ASYMMETRY`、`TORSO_LEAN`、`TOO_FAST`、`INCOMPLETE_REP`，以及 `POSE_LOW_CONFIDENCE`、`BODY_OUT_OF_FRAME`。

每个有效完整 rep 保存肩部峰值、最小肘角、最大左右肩角差、最大躯干侧倾、周期时长、五个分项分、总分和错误。无效 attempt 只用于即时规则反馈，不进入正常 repetition 汇总。
