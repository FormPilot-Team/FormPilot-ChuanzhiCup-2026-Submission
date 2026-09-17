# AI 电子教练六步课程 v1 规格

## 固定定义

课程 ID 为 `electronic-coach-six-step`，版本 `1.0.0`。正式顺序和目标如下，`CourseDefinition.ts` 是运行时唯一来源：

1. 肩部环绕：15 秒有效运动时间，guidance。
2. 双臂上举：6 reps，scored。
3. 侧平举：6 reps，scored。
4. Step Jack：6 cycles，scored；一组为左、右各一次。
5. 徒手深蹲：6 reps，scored。
6. 原地交替提膝：10 reps，scored。

普通动作以 pose ready 为准备门；Squat 与 Knee Raise 需要 standing baseline。准备完成后执行 3、2、1 倒计时，动作之间过渡 2000 ms。

## 计时、暂停与结束

`PREPARING`、`COUNTDOWN` 和 `TRANSITION` 不处理 rep。课程只在 `ACTIVE` 将特征送入动作引擎并记录 Session。肩部环绕使用 `activeMotionMs` 作为 duration progress；静止时间和用户暂停时间不计入目标。应用暂停冻结 countdown、ACTIVE elapsed、transition remaining、动作时间戳和语音，恢复后从原点连续推进。

手动确认结束保存 `courseStatus: incomplete`。全部六步完成后进入 `COURSE_COMPLETE` 并保存 `courseStatus: completed`。

Session 保存成功后，完成弹层只提供简洁确认与“查看训练报告”入口。报告路由为 `/report/:sessionId`，刷新时从同一 Session Repository 恢复；不存在的 Session 显示明确空状态。

## Coach Card

Course state 不与 Coach state 一一复制。Course `COUNTDOWN` 在 Coach 中仍显示 `PREPARING` 并叠加 3/2/1；Course `PAUSED` 保持暂停前 Coach 业务状态并叠加“训练已暂停”；Course `TRANSITION` 显示当前动作完成、下一动作名称和下一动作配置化准备提示，并使用下一动作标准 Coach 资产。

训练期间 Coach 目标显示遵循 CourseDefinition：duration 为剩余秒数，reps 为 `current / target`，cycles 为 `current / target 组`。Shoulder Rotation 不显示圈数。

## 评分与 Session

肩部环绕是 guidance，不产生 numeric overall score。课程总分只平均其余五项有有效 repetition 的 scored 动作。双臂上举采用 engineering-v1：Amplitude 35%、Elbow Extension 25%、Synchronization 20%、Stability 10%、Tempo 10%；Completion 是 Rep Validity Gate，不是数值分项。

Session schema v2 保存 courseId、courseVersion、courseStatus、总时长、固定 exerciseOrder、各动作结果、反馈总数与高频错误。浏览器仓储键为 `ai-coach.sessions:v2`。

完整报告的课程总评继续使用该已保存值。Incomplete 报告不得称为课程总评，只可显示已完成计分动作平均分及其样本数，或显示 unavailable。报告的五维能力和 issues 均是只读派生，不改变课程计分规格。

## 自动化专用入口

`?demo=1&course=1` 运行六步演示。`fast=1&fixture=synthetic` 仅用于开发环境自动化，不改变正式课程规格或生产阈值。
