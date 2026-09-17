# Coach Card State System 规格（Phase 6A）

## 职责与边界

训练页三栏职责固定为：左侧 Coach 提供“标准动作参照 + 现在该怎么调整”；中间 Camera 展示用户实际动作；右侧 Metrics 解释系统判断。Coach Card 不展示错误列表、历史趋势、复杂评分或调试指标，一次只表达一个主要指导信息。

Phase 6A 继续使用六张已验收的 2D/2.5D Coach 静态资产、同一人物和原三栏布局。没有新增 `DEMONSTRATING`、`PAUSED` 等业务状态，也没有引入视频、Rive、Lottie、骨骼动画、3D renderer 或角色重做。

## 五种业务状态与优先级

`CoachCardState` 只有：

1. `PREPARING`（准备中）
2. `ACTIVE`（训练中）
3. `CORRECTING`（动作纠正）
4. `POSITIVE`（已调整）
5. `TRANSITION`（本动作完成）

`CoachCardStateResolver` 的决策顺序为：

```text
TRANSITION
  > exercise not ready / Course PREPARING / Course COUNTDOWN
  > confirmedPrimaryFeedback
  > unexpired recoveredFeedback positive window
  > ACTIVE
```

Countdown 只是 `PREPARING` 上的 3/2/1 overlay。暂停只是当前 Coach 视觉上的“训练已暂停”overlay；Resolver 保留暂停前业务状态并冻结 positive timer。

## 输入与输出

Resolver 输入 `CoachCardResolverInput`：

- Course snapshot：state、previousState、countdown；
- exercise readiness；
- 当前动作的 ID、名称、presentation、Coach asset、Reference Profile；
- target type、当前 progress、target value；
- `FeedbackPolicy` 输出的 `confirmedPrimaryFeedback`；
- `FeedbackPolicy` 输出的 `recoveredFeedback`；
- transition 时的下一动作 metadata。

Resolver 输出唯一的 `CoachCardViewModel`：

- `state`、`exerciseId`、`exerciseName`、`statusLabel`；
- `primaryMessage`、可选 `secondaryMessage`；
- `target { type, current, value, label }`；
- `coachAsset`、`referenceProfile`；
- `highlightRegion`、可选 `direction`；
- 可选 `countdown`、`paused`；
- `positiveSourceError`、`positiveRemainingMs`；
- 可选 `nextExercise`。

`CoachPanel` 只消费此 ViewModel 和 Debug skeleton 开关，不直接读取 CourseController、ExerciseEngine、FeedbackPolicy 或 Session。

## 状态行为

### PREPARING

显示当前动作标准资产、配置化 `presentation.coach.preparationText`、状态“准备中”。Pose/Baseline 未 ready 与 Countdown 均留在此状态；不显示珊瑚 Halo 或 positive check。

### ACTIVE

显示动作名称、标准动作资产、目标进度、配置化 `presentation.coach.activeText` 和状态“训练中”。默认保持安静，不因正确 frame 或每次 rep 显示泛化赞美。

目标格式固定为：duration `剩余 09s`、reps `4 / 6`、cycles `3 / 6 组`。肩部环绕不使用圈数文案。

### CORRECTING

只由 `FeedbackPolicySnapshot.confirmedPrimaryFeedback` 触发，不读取瞬时 `RuleResult.errors[]`。文字直接复用 Rule/Feedback 的中文 `message`，Coach mapping 只配置 region/direction，因此不存在规则、Coach 与 Speech 三套纠错文案。

状态只展示一个 confirmed primary。其他错误仍可留在右侧 Metrics 与 Debug 中。

### POSITIVE

只由已确认错误经过 FeedbackPolicy recovery window 后产生的 `recoveredFeedback` 触发。默认显示 `1200ms`，之后自动回 ACTIVE；新 confirmed primary 可立即打断。

Recovery 文案优先使用错误专属文案；缺少专属文案时使用“很好，保持这个状态”。UI 使用薄荷绿小型 check，不使用游戏奖励效果。运行时会暂存单帧 recovery event，直到低频 Coach ViewModel 更新消费一次，避免事件落在两个 UI tick 之间丢失。

### TRANSITION

在 Course `TRANSITION` 的约 2 秒窗口中显示“✓ 当前动作完成”、下一动作名称和下一动作准备提示。人物区域切到下一动作标准起始参考资产，只使用 `opacity` 轻量过渡。最终动作没有下一动作时显示“下一步：课程总结”。

## Correction Mapping

具体中文纠错沿用 Rule/Feedback message；以下为 Phase 6A 的展示映射：

| 动作 | Error | Region | Direction |
|---|---|---|---|
| Shoulder Rotation | MOTION_TOO_SMALL / ARMS_UNSYNCED / MOTION_PAUSED | both_arms | — |
| Shoulder Rotation | TORSO_LEAN | core | — |
| Overhead Raise | ARMS_TOO_LOW | both_arms | up |
| Overhead Raise | ELBOW_TOO_BENT_L/R | left_elbow / right_elbow | — |
| Overhead Raise | ASYMMETRY / TORSO_LEAN | both_arms / core | — |
| Lateral Raise | ARM_TOO_LOW_L/R | left_arm / right_arm | up |
| Lateral Raise | ELBOW_TOO_BENT_L/R | left_elbow / right_elbow | — |
| Lateral Raise | ASYMMETRY / TORSO_LEAN | both_arms / core | — |
| Step Jack | STEP_TOO_SMALL / ARM_LEG_UNSYNCED / WRONG_SIDE_SEQUENCE | full_body | — |
| Step Jack | ARM_TOO_LOW / BODY_SWAY | both_arms / core | up / — |
| Squat | DEPTH_INSUFFICIENT | hip_depth | down |
| Squat | KNEE_VALGUS / LEFT_RIGHT_ASYMMETRY | knees | — |
| Squat | TORSO_LATERAL_LEAN | core | — |
| Knee Raise | KNEE_TOO_LOW_L/R | left_knee / right_knee | up |
| Knee Raise | BODY_SWAY / WRONG_SIDE_SEQUENCE / LEFT_RIGHT_HEIGHT_GAP | core / full_body / knees | — |
| 全部动作 | POSE_LOW_CONFIDENCE / BODY_OUT_OF_FRAME | none | — |

`TOO_FAST`、`INCOMPLETE_REP`、`INCOMPLETE_RETURN` 等已有错误也有保守的 full-body/both-arms 映射；未知映射降级为 `none`，文字仍显示。

## Pose Anchor 映射

`CoachPanel` 读取当前标准资产对应的 `*.pose.json`。`mapCoachHighlightAnchors()` 使用 0–1 normalized landmarks：

- elbow/knee：直接取对应 landmark；
- arm：shoulder/elbow/wrist 中点；
- hip_depth：leftHip/rightHip 的 `hipMid`；
- core：`shoulderMid` 与 `hipMid` 的中点；
- both_arms/knees：返回左右两个 anchor；
- full_body：由 nose 与双膝中心推导。

SVG 使用与 `object-fit: contain` 一致的 `viewBox="0 0 1 1"` 和 `preserveAspectRatio="xMidYMid meet"`，没有逐图手写像素坐标。视觉仅为珊瑚色半透明 Halo、小圆点和少量明确方向箭头；Coach 本体始终展示正确标准动作。

Pose anchor 请求失败、JSON 缺失或 region 无法映射时返回空 anchor；文字纠错、状态和目标照常工作，不 crash。

## Feedback、Speech 与暂停

`FeedbackPolicy` 保留原有 `update()` 语音事件输出和只读 snapshot：`confirmedPrimaryFeedback` 与 `recoveredFeedback`。确认、恢复和 cooldown 仍由同一套策略维护。`VoiceGuidePolicy` 只转发允许播报的 feedback event，并与 CourseController/Pose availability 边沿统一经过一个 speech 输出出口；Coach UI 仍只消费 snapshot，因此 speech 不可用、被静音或 cooldown 阻止播报时，Coach Card 仍能纠错或显示恢复反馈。

Coach Motion 不增加状态：PREPARING、ACTIVE、POSITIVE 和 TRANSITION 可循环合法序列；CORRECTING 强制 canonical 静态图以保护 Halo anchor；pause 冻结当前动画帧；reduced motion 与缺少合法素材时静态回退。

暂停时不处理新 Coach correction/recovery，不推进 countdown、transition 或 positive timer；恢复后继续暂停前的逻辑。Manual End Dialog 不改变 Coach 内部状态。

## 可访问性与性能

Primary message 使用 polite `aria-live`，稳定文案不会逐帧替换；状态与图标不依赖颜色单独表达。长文案限制两行，390×844 无横向 overflow。

Coach ViewModel 只在约 100ms 的既有低频 UI tick、readiness/progress/feedback/recovery/transition/pause 事件更新；Resolver 对未变化结果复用对象，`CoachPanel` 使用 React memo。静态 anchor 每个资产只在资源切换时读取，不随 Pose frame 计算或请求。
