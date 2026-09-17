# Shoulder Rotation（肩部环绕）规则规格

肩部环绕是 15 秒引导动作，不做精确圈数识别，也不进入课程总分。状态仅为 `READY → ROTATING → COMPLETE`，完成依据为有效运动累计时长。

实时特征包括左右肩角、左右角速度、1.2 秒窗口内的左右 excursion、双臂速度同步度、运动连续度和躯干侧倾。姿态置信度与全身入镜是所有指导的前置门控。

规则代码：

- `MOTION_TOO_SMALL`：任一侧窗口幅度不足 35°。
- `ARMS_UNSYNCED`：左右速度同步度低于 0.55。
- `MOTION_PAUSED`：连续度低于 0.55，或停止运动超过 900 ms。
- `TORSO_LEAN`：躯干侧倾超过 10°。
- 通用错误：`POSE_LOW_CONFIDENCE`、`BODY_OUT_OF_FRAME`。

界面可以展示幅度、同步、连续与稳定性质量指标，但 `currentScore` 固定为 0；Session 将其记录为 `evaluationMode: guidance` 并明确排除课程总分。
