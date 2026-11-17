# Web 页面与集成

正式入口是平台根路由 `/`。安装、开发、比赛构建与游戏连接见[运行说明](../../../../docs/submission/RUNNING.md)。

| 板块 | 路由 | 实现 |
| --- | --- | --- |
| 首页 | `/` | `pages/Web/HomeV1Page.tsx` |
| 训练中心 | `/training` | `pages/Web/TrainingCenterPage.tsx` |
| 功法训练 | `/routines`、`/routines/:id`、`/routines/:id/train` | `RoutinesV1Page`、`RoutineEntryPage`、`RoutineTrainingPage` |
| 游戏中心 | `/games` | `pages/Web/GamesCenterPage.tsx`，打开独立游戏应用 |
| AI Coach | `/coach` | `pages/Web/CoachPage.tsx` |
| 我的与动作工坊 | `/me`、`/history`、`/report/:id`、`/workshop` | 设置、记录、报告与动作工坊页面 |

首页和趋势使用本机真实训练记录；没有记录时显示首次使用状态。趋势只包含可靠的完整热身训练，游戏成绩独立。动作工坊支持动作信息、摄像头或视频示范采集、识别测试、保存与正式训练；隔离的 `temporalPrototype` 属于研究原型。

训练页使用深色沉浸布局。自动取景依据近期关键点边界，在保证四肢可见时放大；关键点缺失时恢复完整画面。视频与骨架共享显示变换，姿态识别输入不受影响。功法示范默认使用匹配参考轨迹的真人视频；没有可用且逐帧对齐的替代素材时不切换数字人。

AI Coach 的画像与授权输入经 `collectLocalDecisionInput` → `recommendCoachDecision`。普通构建 OFF，比赛构建 ACTIVE 并允许带身份标识的实验性模型；模型、候选池、弃权和 Guard 契约见[接口说明](../ai-coach-agent/decision-model/WEB_INTEGRATION_READY.md)。SHADOW 仅用于开发验证，本机日志可导出、不会上传。

体感游戏服务地址由 `VITE_MOTION_GAMES_URL` 配置。页面检查服务可用性，连接后在新窗口启动摘苹果、林间划船或林间射箭。摄像头及游戏识别在游戏应用内处理。

视觉资源来源见 [ASSET_SOURCES.md](../../public/web-v1/ASSET_SOURCES.md)。样式、自动取景、示范回退和页面行为由单元测试及 `tests/visual-web-v1`、`tests/e2e` 覆盖，合成输入不能代替真人摄像头验证。
