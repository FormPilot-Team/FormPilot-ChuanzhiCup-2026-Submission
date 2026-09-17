# Step Jack Engineering V1

## 动作定义与演示轨迹

本动作是低冲击侧步开合，不是Jumping Jack。Coach Demo采用：CENTER双脚靠拢、手臂自然下垂；左脚向左侧迈开时双臂同步沿身体两侧举成约140–150°宽V；回到CENTER后换右侧；全程至少一脚着地、不跳跃。静态Coach图展示`LEFT_OPEN`，与阈值`meanShoulderAngle >= 130°`一致。

## 特征

- `ankleWidth`、`hipWidth`
- `openRatio = ankleWidth / hipWidth`
- 左/右/平均肩角与双臂角差
- `leftStepOffset`、`rightStepOffset`：脚踝相对同侧髋的横向距离/髋宽
- `torsoLean`、`armVelocity`、`legVelocity`
- 复用全身入镜、关键点最低置信度和Phase 1滤波

## 状态机

```text
CENTER
  ├─ LEFT_OPENING → LEFT_OPEN → RETURNING_FROM_LEFT ─┐
  └─ RIGHT_OPENING → RIGHT_OPEN → RETURNING_FROM_RIGHT ┤
                                                       ▼
                                                     CENTER + rep
```

`lastCompletedSide`决定下一次期望侧；初始期望左侧。OPENING阶段允许未达到OPEN阈值便开始回收，从而完成一个可诊断的“步幅不足”attempt，而不是丢失该样本。连续3帧确认阶段切换。

## 配置阈值

| 参数 | V1 |
|---|---:|
| CENTER | openRatio ≤ 1.15 |
| 开始打开 | openRatio > 1.22且外展速度 > 0.15 ratio/s |
| OPEN | openRatio ≥ 1.60 |
| 顶部平均肩角 | ≥130° |
| 双臂角差 | ≤20° |
| 同步优秀/合格 | ≤200ms / ≤400ms |
| 单侧周期 | 1000–1800ms |
| 躯干倾斜 | ≤12° |
| 未回中超时 | 2300ms |

## 错误与优先级

`POSE_LOW_CONFIDENCE/BODY_OUT_OF_FRAME` > `WRONG_SIDE_SEQUENCE` > `INCOMPLETE_RETURN` > `STEP_TOO_SMALL` > `ARM_LEG_UNSYNCED` > `ARM_TOO_LOW` > `BODY_SWAY` > `TOO_FAST`。

文案使用产品要求：侧步再打开一些、手臂再抬高一些、手脚尽量同时打开、注意左右交替、保持核心稳定、节奏慢一些、先回到中间位置。

## 评分

- Coordination 30%
- Amplitude 25%（步幅和手臂高度平均）
- Tempo 20%
- Stability 15%
- Completion 10%

同步差≤200ms满分，200–400ms连续降至70分，超过400ms继续连续衰减。其他指标使用共享的区间、下限和越低越好评分原语。

## 已知限制

- 2D单目对脚向镜头前后移动不敏感，要求用户正面侧步。
- 髋宽受衣物和遮挡影响，openRatio必须真人校准。
- 状态机按画面解剖左右工作；镜像只发生在显示层。
- 静态Coach图不是最终动画，仅通过规范化Adapter提供正确关键姿势。
