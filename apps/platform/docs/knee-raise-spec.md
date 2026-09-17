# Knee Raise Engineering V1 规格

本规格定义 Phase 4 的 Standing Alternating Knee Raise。它是稳定、低冲击的原地交替提膝，不是 High Knees 冲刺、跳跃、登山跑或单腿平衡课程。全部阈值标记为 `engineering-v1`，不是医学或官方动作标准。

## Feature Set 与符号

`hipMid=(LHip+RHip)/2`，`shoulderMid=(LShoulder+RShoulder)/2`，`torsoLength=distance(shoulderMid,hipMid)`。

本项目唯一的提膝高度符号是：

```text
leftKneeHeight  = (LHip.y - LKnee.y) / torsoLength
rightKneeHeight = (RHip.y - RKnee.y) / torsoLength
```

图像 y 向下，因此值越大表示膝盖越高；自然站立为负值，膝盖接近同侧髋高时接近 0，膝高于髋时为正。`Knee.y <= Hip.y + 0.10*torsoLength` 等价于 `kneeHeight >= -0.10`。

其余特征：左右 top proximity、左右高度速度（高度的一阶差分）、正面 torso lateral lean、相对 `baselineHipMidX` 的 `hipHorizontalShift/shoulderWidth`。每次单侧动作记录 peak，状态记录 currentSide、lastCompletedSide、最近左右 peak、rep/cycle。

## Center Baseline

`KneeRaiseCenterBaseline` 只冻结 `baselineHipMidX`、`baselineHipY`、`baselineTorsoLength`，不是 Squat Standing Baseline 的复制。连续 10 帧同时满足：全身入镜、confidence >=0.65、双膝高度 <=-0.45、左右高度速度绝对值 <=0.12，baseline 才 ready。临时可见性丢失保留冻结值；连续 12 帧丢失后重建。切换动作与 runtime reset 都会清空 baseline。

Baseline ready 前状态固定在 CENTER、rep 不计数，普通 UI 显示“请自然站立，准备开始”。

## 状态机与计数

```text
CENTER
  → LEFT_RAISING → LEFT_TOP → LEFT_RETURNING → COMPLETE/CENTER
  → RIGHT_RAISING → RIGHT_TOP → RIGHT_RETURNING → COMPLETE/CENTER
```

RAISING 需要明显高度与向上速度并经 persistence；TOP Detection 只需要已有明显抬膝后速度接近 0 或反向，阈值 `-0.25` 明确低于用户合格高度 `-0.10`，因此低膝仍会进入 TOP 并收到反馈。只有左右膝回到 normalized CENTER 且速度稳定，单侧 rep 才完成。

单腿一次=`rep`；相邻两次不同侧完成=`cycle`。`LEFT→LEFT` 会生成第二个有效单侧 rep，并标记 `WRONG_SIDE_SEQUENCE`，不会卡死。未先回 Center 就抬另一侧时不计次并标记 `INCOMPLETE_RETURN`。

## Engineering V1 阈值

| 类别 | 值 |
|---|---:|
| 用户提膝目标 | kneeHeight >= -0.10（等价于 knee.y <= hip.y + 0.10×torso） |
| 左右峰值差 | <=0.12×torso |
| 躯干正面侧倾 | <=10° |
| 髋部横移 | <=0.20×shoulderWidth |
| 单侧周期 | 1.0–1.6s |
| TOP detection | kneeHeight >=-0.25 + 低速/反向 |
| phase persistence | 2 frames |
| baseline | 10 stable frames |

## 错误、优先级与反馈

`BODY_OUT_OF_FRAME/POSE_LOW_CONFIDENCE > INCOMPLETE_RETURN > WRONG_SIDE_SEQUENCE > KNEE_TOO_LOW_L/R > BODY_SWAY > LEFT_RIGHT_HEIGHT_GAP > TOO_FAST`。

文案分别为“左/右膝再抬高一些”“保持身体稳定，不要左右晃动”“注意左右交替”“两侧尽量抬到相近高度”“节奏慢一点，保持动作稳定”“先回到站立位再抬另一侧”。Baseline not ready 是准备状态，不进入 production error union。

## 连续评分

权重：Amplitude 30%、Stability 25%、Alternation 20%、Symmetry 15%、Tempo 10%。Amplitude 在 -0.55、-0.35、-0.20、-0.10、0.02 间分段线性增长，达到目标后进入 plateau，不存在合格线两侧的 0/100 跳变。Stability 合并 torso lean 与 hip shift；Symmetry 比较最近左右 peak；Tempo 使用 1.0–1.6s band。

UI 由 presentation config 选择四个主要指标：动作幅度、稳定性、左右交替、对称性；Tempo 仍进入规则、RepSummary、Diagnostics 与 overall score，TrainingPage 没有硬编码动作指标。

## RepSummary 与参考姿态

`KneeRaiseRepSummary` 包含 side、start/top/end time、peak height、hip shift max、max torso lean、五项分数、overall、errors、sequence/return 标志，并加入 `RepSummary` discriminated union。

Canonical 至少有 CENTER、LEFT_TOP、RIGHT_TOP；RIGHT_TOP 由 LEFT_TOP 进行关键点交换及 `x=1-x` 的确定性镜像。User Acceptance、Coach Asset Acceptance、Detected Pose 分层，不允许一层覆盖另一层。

## CALIBRATION REQUIRED

正式真人 calibration 前必须重新评估：knee height target、height difference、hip shift、torso lean、timing、baseline frames、TOP detection、sequence persistence。第一次 Pilot 仅记为 qualitative engineering observation，本阶段未据此修改任何 production threshold。
