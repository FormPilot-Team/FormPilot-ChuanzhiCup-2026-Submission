# FormPilot Web V1.1 — 核心训练页面产品化升级 + 动作工坊 V2 整合

分支 `feat/web-v1-product-closeout`（PR #53）。基线：`origin/main` 合并提交 `92a80d3`（含 PR #56 动作工坊 V2，squash `0b29905`）。
设计依据：负责人已批准的 C1–C5 概念（`F:\ProjectEvidence\FormPilot\20261110-ui-ux-review\02-concepts`）。

## 1. 动作工坊 V2 整合

- **以 #56 为新基线**：`git merge origin/main`（普通合并，无强推、无覆盖）。唯一冲突在 `tests/e2e/workshop.spec.ts`，取 main 的完整版本，只把“我的动作在训练中心可见”的断言改到 `/training`。#56 的页面、识别逻辑（`features/workshop/*`）、视频示范采集、W1–W8 修复与全部测试保持原样。
- **入口**：训练中心 `我的动作`（`training-my-actions`）、`我的` 页 `打开动作工坊`、首页工坊卡片；路由 `/workshop`、`/workshop/new`、`/workshop/:id`、`/workshop/:id/train` 不变。
- **本轮只改展示层**（不改数据结构、存储键、识别与计数）：
  - 向导步骤命名改为 `动作信息 → 示范采集 → 识别测试 → 保存并训练`（`ActionEditorPage` 的 `STEPS` 与 `WORKSHOP_FLOW`）；阈值等高级选项仍在 #56 的 `高级设置` 折叠区。
  - 工坊首页：`创建动作` 为本页唯一青柠主操作；新增 `继续完善「…」`（最近编辑且未通过识别测试的动作）；动作卡显示 名称 / 类型 / 识别测试状态 / 是否可训练（`isRecognitionReady`）/ 编辑；导入导出降为动作库旁的次要按钮。
  - 自定义动作训练页：改用 C3 的深色沉浸式语言（摄像头为主画面、计数卡、画面下方一条教练提示、深色控制条）；次数与保持时间分开表述（“已完成 N 次” / “已保持 N 秒”）。不出现数字人：唯一的“示范”是用户自己示范时记录的关键点示意图。
- **数据兼容**：`formpilot.custom-actions:v1`、`formpilot.custom-action-sessions:v1`、旧版动作库导入路径均未改动；历史只认 `source: live`。
- **实验原型边界**：#56 的三阶段时序识别（`temporalPrototype`）仍是隔离的实验原型，本轮未接入任何页面、未作为正式功能宣传。

## 2. 沉浸式训练外壳（C2 / C3 / 自定义动作）

`src/components/immersive/`：

| 组件 | 作用 |
|---|---|
| `ImmersiveShell` / `ImmersiveTopBar` | 深色训练外壳，不显示一级导航；顶栏 = 品牌标 + 退出 + 标题/进度 + 状态 + 操作 |
| `ImmersiveCameraPanel` | 用户真实摄像头画面（镜像、`object-contain`）+ MediaPipe 骨架；状态标签在画面上方条带，教练提示/倒计时/准备提示在画面下方条带，均不压在身体上 |
| `useBodyFraming` + `features/framing/bodyFraming.ts` | 自动取景（见下） |
| `DemoStage` | 标准示范舞台（C5，见第 3 节） |
| `DetailsDrawer` | `详细数据` 抽屉：实时反馈、动作规范检查、本段要点、入镜与识别状态（内容常驻，只隐藏） |
| `CoachToast` | 唯一一条教练提示 |

### 自动取景（不强制裁切人体）

- 画面始终 `object-contain` 完整显示；只在**可证明不裁到四肢**时放大：以最近 2.5 秒内所有可见关键点（含手、脚）的外接框并集为准，四周留 14% 框高余量与 5% 舞台边距；平移被双重夹紧，**身体框约束优先于“铺满画面”**。
- 关键关节（鼻、双肩、双肘、双腕、双髋、双膝、双踝）任一不可见、超过 0.9 秒没有新帧、Framing Assist 未就绪、尺寸变化 → 立即回到完整画面。当前帧身体框一旦越界，立即重新取景（180 ms 过渡）。
- 骨架画布与视频在同一个变换层里移动，坐标与画面始终一致；识别输入（模型拿到的帧）不受影响。
- 用户可在画面上方切换 `自动取景 / 完整画面`。
- 只在“画面与关键点同源”时启用：实时摄像头，或带逐帧图像的测试夹具。功法的合成测试夹具画面是静态海报、关键点来自参考轨迹，二者不同步，因此该模式下始终显示完整画面（`data-framing-available="false"`）。
- 单元测试：`tests/body-framing.test.ts`（任何位置的身体框在放大后都留在舞台内；关键关节缺失回退；时间窗内动作全程可见；微小变化不抖动）。

### 纠错高亮

- 功法跟练：跟练中骨架默认隐藏（沿用 `shouldShowPoseOverlay`），当反馈策略确认了某一身体区域的问题（`MISMATCH_ARMS / TORSO / LEGS`，来自比对器的区域分数）时，只在用户自己的骨架上高亮该区域。
- 热身：确认的侧别纠正（`confirmedPrimaryFeedback.side`）时只高亮该侧手臂，侧别仍由规则引擎的 `errors[].side` 决定。

## 3. DemoStage 与数字人接入（C5）

- `features/demo/demoPresenter.ts`：`presenter = real | digital-human | cartoon`。构建变量 `VITE_DEMO_PRESENTER` 选择；DEV 下可用 `?presenter=` 检查回退。
- **只换画面**：评分参考轨迹 `program.video.poseTrackSrc`（由真人视频提取）、章节时间、播放/暂停/跳转、原声开关全部不变。
- **对齐门槛**：替代素材必须声明 `alignedTo` = 原视频，时长与每个章节起点与原视频偏差 ≤ 1 帧（0.04 s）；否则回退真人视频，并在 `data-presenter-fallback` 写明 `asset_missing` / `not_aligned`。
- **当前状态**：`ROUTINE_PRESENTER_ASSETS` 为空——没有交付数字人或卡通功法视频，按要求不生成低质量素材。默认与回退都是现有真人视频。
- **不缩放示范画面**：四个功法视频带第三方水印（见 `docs/integration/TRAINING_MODES.md`），水印必须保留，因此示范画面不做按人体放大，只按内容宽高比显示（太极拳仍只裁掉黑边）。
- 不依赖：自由视角、实时驱动、实时背景合成。
- 单元测试：`tests/demo-presenter.test.ts`；E2E：`routine-layout.spec.ts` 的 C5 回退用例。

## 4. 各页面

- **C1 功法详情**（`RoutineEntryPage`）：大示范、按时长的章节条、选中章节卡（要领 + 评分注册表中的动作要求）、继续练习卡、动作组成列表、训练前准备、最近跟练。**历史数据只来自最近一次可靠的整套记录**（`isReliableRoutineSession` + 同一课程版本）；章节相似度只显示样本充足的章节；“最弱章节”建议只在报告给出 `weakestChapter`（≥ 2 个有效章节）时出现；没有这样的记录时不显示任何历史数字。
- **C2 功法跟练**（`RoutineTrainingPage`）：横屏并排（同高），竖屏上下叠放；顶栏状态、示范舞台、我的画面、画面下方一条提示、章节条（宽度 = 时长，可跳段）、`详细数据` 抽屉。计数/匹配/动作规范检查/状态机/记录完全沿用 `useRoutineRuntime`（只新增 `observe` 调用把每帧关键点交给取景）。
- **C3 热身 / 单动作**（`TrainingPage`）：摄像头为主画面；右侧小示范窗、大计数与动作阶段（`phaseLabels` 原样）、AI 教练（静态教练、智能训练决策、详细指标，侧栏内滚动）；底部深色控制条。计数、评分、阶段、异常退出逻辑不变。
- **C4 报告**（`reportShell` + 三种报告）：首屏三问 `这次怎么样 / 主要问题 · 只看这一处 / 下次怎么练`，只映射原有字段（`ReportSummary` 的 score / trend / summary / comparison / takeaways，功法报告的 `weakestChapter` 与 `focusItems`）。功法报告新增“分段表现”色条（颜色阈值 = `similarityBand` 的 80 / 60），原“分段明细”、专项分析、相比上次保持展开；分区表现、评分说明（动作规范检查）、数据说明收进折叠区——维度、证据、历史对比都没有删除。

## 5. 视觉规范

- 训练页（功法跟练、热身、自定义动作）深色沉浸；浏览、创建、报告页浅色。
- 青柠 `#d9f54a`（`.fp-cta`）只用于每页唯一的主操作；次要主操作用深色 `.fp-cta-dark`。
- 令牌沿用概念稿：night `#192233`、blue `#79b8ff`、violet `#a78bfa`、coral `#ff8f86`、mint `#91e6d2`。

## 6. 测试变化说明

旧的布局断言（三栏、画面中央的倒计时、`实时动作检测` 标题、训练页一级导航）是旧版式的合同，按已批准的 C2/C3 更新为新合同；被替换的断言与理由见证据目录的测试报告。新增：`body-framing.test.ts`、`demo-presenter.test.ts`、`web-v11-evidence.spec.ts`、`routine-layout.spec.ts`（重写，覆盖 1440×900 / 1024×768 / 768×1024 / 390×844 / 1920×1080 / 1366×768）。
