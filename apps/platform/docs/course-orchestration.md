# 六步课程编排

`CourseDefinition` 是课程顺序和目标的唯一来源：

1. 肩部环绕：15 秒，guidance。
2. 双臂上举：6 次，scored。
3. 侧平举：6 次，scored。
4. Step Jack：6 组；一组为左、右各一次，scored。
5. 徒手深蹲：6 次，scored。
6. 原地交替提膝：10 次（5 个左右周期），scored。

`CourseController` 管理 `PREPARING / COUNTDOWN / ACTIVE / PAUSED / TRANSITION / COURSE_COMPLETE / COURSE_INCOMPLETE`。肩部环绕、双臂上举和侧平举以 `UPPER_BODY_WITH_HIPS` 姿态质量作为准备门；侧步开合、深蹲和提膝继续使用 `FULL_BODY`，其中深蹲和提膝还必须先完成站立基线。倒计时为 3 秒，动作间过渡为 2 秒。肩部环绕的 duration target 使用状态机累计的 `activeMotionMs`，不是墙钟 elapsed；静止和应用暂停均不推进该目标。暂停会冻结倒计时、动作计时、过渡计时、rep 处理和语音；恢复时排除暂停时间。手动结束保存 `incomplete`，不会伪装成完整课程。

课程总评分只平均五项 scored 动作；肩部环绕只保存完成状态和指导记录。Session 同时保存课程 ID/版本、总时长、反馈总数和高频错误。

`?demo=1` 继续保留 Phase 1–4 的四动作兼容验收；`?demo=1&course=1` 进入六步演示；`fast=1&fixture=synthetic` 仅供自动化状态机测试。
