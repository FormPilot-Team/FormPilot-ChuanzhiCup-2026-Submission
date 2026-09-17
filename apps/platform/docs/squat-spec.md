# Squat Engineering V1

`thresholdVersion = engineering-v1`。本文件描述徒手深蹲第一版的范围、特征、站立基线、状态机、阈值、错误、评分与已知限制。数值不是权威人体生物力学标准，真人 Calibration 后才能调整生产阈值。

## Scope

- 第三动作作为 Exercise Plugin 接入现有 Contract：`src/features/exercises/squat/`
- 复用 Camera / PoseDetector / PoseFilter / PoseNormalizer / geometry / Overlay / FeedbackPolicy / Session / Diagnostics
- 正面单 RGB 摄像头 + MediaPipe Pose + 2D / normalized landmarks
- 不进入 Knee Raise，不改 Lateral Raise / Step Jack 生产阈值

## Camera assumption

第一版只支持用户正面入镜。图像 y 向下。因此 V1 评价：

- 下蹲深度趋势（相对站立髋高）
- 左右膝稳定与明显膝内收
- 左右对称
- 完整蹲起
- 节奏
- 躯干左右侧倾

不声称能高精度判断：脊柱屈曲、骨盆前后倾、矢状面躯干前倾、膝盖是否精确超过脚尖、髋膝踝复杂生物力学、医疗/康复级结论。

Coach静态图无法建立standing baseline，因此资产验收使用 `hipKneeSeparation` 等单帧几何，而不是运行时 `hipDrop`。动态Demo则必须从实际站立帧建立baseline。正面BOTTOM时髋点分母会因遮挡/衣着/透视变窄，因此 `kneeSpreadRatio` 可到3+且不适合作Coach上限；用户膝内收规则仍只看ratio过小。深度蹲中hipKneeSeparation可为负（髋部视觉上接近或低于膝线）。

## Features

| 特征 | 定义 |
|---|---|
| hipMid / shoulderMid | `(L+R)/2`，复用 `deriveBodyPoints` |
| torsoLength | `distance(shoulderMid, hipMid)` |
| standingHipY 等 | 见 Standing baseline，冻结后不每帧重置 |
| hipDrop | `(currentHipY - standingHipY) / standingTorsoLength`；baseline 未就绪时为 0 |
| kneeWidth / hipWidth | 左右膝距 / 左右髋距 |
| kneeSpreadRatio | `kneeWidth / hipWidth` |
| kneeHeightDiff | `abs(LKnee.y - RKnee.y) / currentTorsoLength` |
| torsoLateralLean | 复用 `torsoLeanDegrees`，只评左右侧倾 |
| hipVerticalVelocity | 平滑后 hipMid.y 的有限差分；正值表示髋部下落 |
| hipKneeSeparation | `(kneeMid.y - hipMid.y) / torsoLength`，用于 baseline 资格与静态资产验收 |
| repDuration | STANDING→DESCENDING→BOTTOM→ASCENDING→STANDING 的完整周期 |

## Standing baseline

进入 Squat 且处于站立稳定窗口后建立，不每帧重置。

配置（`SQUAT_V1`）：

- `baselineStableFrames = 10`（8–15 帧窗口）
- 连续稳定帧取 median：`standingHipY`、`standingTorsoLength`、`standingHipWidth`、`standingKneeWidth`
- 仅当 `confidence >= visibilityThreshold`、全身入镜、`|hipVerticalVelocity| <= baselineVelocityMax`、且 `hipKneeSeparation >= 0.70`（明显未在下蹲）时累积窗口
- 正在下蹲或置信度低：不得更新已冻结 baseline；未冻结时清空窗口
- 连续 `baselineLostFramesToReset = 12` 帧出镜/低置信：丢弃 baseline，回来后重建
- exercise start / runtime reset：重建
- 完成一次 rep：保留 baseline
- pause / resume：不重置 baseline；大时间间隙下速度按 Δt 计算，静止时接近 0

`BASELINE_NOT_READY` 优先作为 runtime/debug 状态（`Baseline: not ready`），不作为用户 Error。

## State machine

```text
STANDING → DESCENDING → BOTTOM → ASCENDING → COMPLETE → STANDING
```

Phase Detection 与 Motion Acceptance 分离：可进入 BOTTOM 但不等于深度合格。

| 阶段 | 进入条件（engineering-v1） |
|---|---|
| STANDING | baseline 就绪且 `hipDrop <= 0.08`，速度接近 0 |
| DESCENDING | `hipDrop >= 0.05` 且髋部向下速度 `> 0.04` |
| BOTTOM | 已发生明显下降 `hipDrop >= 0.15`，且速度接近 0 或即将反向；**不要求**达到合格深度 0.30 |
| ASCENDING | BOTTOM 后 hipDrop 下降 / 髋部向上 |
| COMPLETE | `hipDrop <= 0.08` 并经 phase persistence 确认后 `repCount + 1`，下一帧回到 STANDING |

浅蹲仍可进入 BOTTOM，由规则报 `DEPTH_INSUFFICIENT`。轻微抖动达不到 `minDescentForBottom`，回收到 STANDING 且不计次。未回到站立不计次。低置信/出镜时冻结阶段。连续 3 帧确认切换。

## Engineering V1 thresholds

全部集中于 `src/features/exercises/squat/config.ts`。

| 参数 | 值 | 用途 |
|---|---:|---|
| standingReturnHipDrop | 0.08 | 回到站立 |
| minDescentForBottom | 0.15 | 识别一次真实下蹲尝试 |
| validDepthHipDrop | 0.30 | 深度合格（acceptance，不是 BOTTOM 门闩） |
| depthVeryLow / partial / plateau | 0.10 / 0.20 / 0.35 | 连续深度分 |
| kneeValgusMaxRatio | 0.75 | 明显膝内收 |
| kneeHeightDiffMax | 0.08 | 左右膝高差 / 躯干长 |
| torsoLeanMax | 10° | 左右侧倾 |
| repDuration | 3–5 s | 节奏 |

## Error codes

优先级：POSE / BODY FRAME > INCOMPLETE_REP > KNEE_VALGUS > DEPTH_INSUFFICIENT > LEFT_RIGHT_ASYMMETRY > TORSO_LATERAL_LEAN > TOO_FAST。

| code | 文案 |
|---|---|
| DEPTH_INSUFFICIENT | 可以再蹲低一些 |
| KNEE_VALGUS | 注意膝盖方向，不要向内夹 |
| LEFT_RIGHT_ASYMMETRY | 左右保持稳定，避免重心偏向一侧 |
| TORSO_LATERAL_LEAN | 保持身体居中，不要向一侧倾斜 |
| TOO_FAST | 放慢下蹲和起身速度 |
| INCOMPLETE_REP | 请回到完整站立位再开始下一次 |
| POSE_LOW_CONFIDENCE / BODY_OUT_OF_FRAME | 既有全身/置信度门 |

仍走 `FeedbackPolicy`，无独立语音策略。

## Scoring

权重：Depth/Amplitude 30%、Stability 25%、Symmetry 20%、Completion 15%、Tempo 10%。

深度为分段连续函数：0.10→低分，0.20→部分分，0.30→高分，0.35+ 平台满分。0.299 与 0.300 无悬崖。达到目标后不再因更蹲而加分。

Stability 由膝高差与左右侧倾合成；Symmetry 由 `kneeSpreadRatio` 连续映射。

## Phase 3.1 动态Demo证据链（2026-09-08）

生产Demo按以下真实图片序列播放：

`squat-demo-standing.png → squat-demo-half.png → squat-demo-bottom.png → squat-demo-half.png → squat-demo-standing.png`

每张图都经过同一个 `PoseDetector → PoseFilter → PoseNormalizer → Squat FeatureExtractor → State/Rule/Feedback/Diagnostics → Overlay`。站立基线来自首张图片的真实检测结果，不硬编码。旧 `camera-squat-demo.png` 只保留为poster/兼容资源，不作为动态证明；`fixture=synthetic`仍只允许DEV测试显式使用。

代表性完整rep实测：`STANDING → DESCENDING → BOTTOM → ASCENDING → COMPLETE`，rep count 1，standingHipY约0.478、maxHipDrop约0.890、kneeSpread约1.57、kneeHeightDiff约0.034、torso约2.0°、duration约3104 ms、score 100、errors none。三次独立性能结果见 `docs/phase3_1-validation.md`。

Phase 3.1 Coach `1086×1448`，Pose Landmarker Lite：

| confidence | required visibility | kneeSpread | knee/shoulder | ankle/shoulder | hip-knee | knee height | torso |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.975 | 0.975 | 2.479 | 1.449 | 1.262 | -0.053 | 0.016 | 2.15° |

旧Coach因新Canonical Similarity门未通过而用重新生成的正式素材替换，并重新运行真实Pose Landmarker生成anchor；没有手工关键点或CSS修正。Detectability和Canonical Similarity为独立结果。

## Canonical / User Acceptance / Coach Asset / Detected

三者严格区分，见 `docs/coach-reference-spec.md`。

- Canonical BOTTOM：教学几何（hipDrop 目标 0.35 等），不承诺真实人体绝对角度
- User Acceptance：Rule Engine 使用的 `hipDrop >= 0.30` 等较宽区间
- Coach Asset：Detectability与Canonical Similarity两道独立门，证明资产可检且视觉接近内部参考，不是医学标准
- Detected：Pose Landmarker实际返回的资产关键点；Debug以实线显示，不能用Canonical虚线代替

## Known limitations

- 正面单目无法可靠测矢状面躯干前倾、脊柱屈曲、骨盆倾角、膝-脚尖前后关系
- 衣着、镜头高度、裁切会影响髋宽、膝宽和 hipDrop 尺度
- 用户一上来就停在半蹲，可能把半蹲冻成 standing baseline
- 静态poster不会建立baseline；生产动态Demo已经从真实STANDING帧建立baseline
- 侧倾只评左右，不把正面假象解释成前后倾

## CALIBRATION REQUIRED

真人 Calibration 前不得改生产值。以下字段必须未来校准：

- `standingReturnHipDrop`、`minDescentForBottom`、`validDepthHipDrop`
- `depthVeryLow` / `depthPartial` / `depthPlateau` 与深度评分控制点
- `kneeValgusMaxRatio`、`kneeHeightDiffMax`、`torsoLeanMax`
- `repDurationMinMs` / `repDurationMaxMs`
- `baselineStableFrames`、`baselineMinHipKneeSeparation`、`baselineVelocityMax`、`baselineLostFramesToReset`
- `descentStartHipDrop`、`descentVelocity`、`bottomVelocity`、`standingVelocityMax`
- `phasePersistenceFrames`、`incompleteTimeoutMs`、`visibilityThreshold`
- 静态资产 `hipKneeSeparation` 与真实下蹲深度的对应关系
- 正面单目下膝内收 2D 投影与真实额状面 valgus 的差异

若开发中发现 Lateral Raise / Step Jack 阈值可疑，只记为 CALIBRATION_CANDIDATE，不改生产值。本轮未发现必须改写前两动作生产阈值的证据。
