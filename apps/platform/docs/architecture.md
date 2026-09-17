# AI 电子教练架构（Phase 6C）

Phase 4 在既有 Exercise Contract 上增加原地交替提膝插件。不新建 Camera / Feedback 管线，不为 Knee Raise 在 TrainingPage 硬编码指标。

Phase 2.1 的 Reference Pose 分层与 Demo 同源检测保持不变。Existing Code Audit 之后，训练页只做 composition；extractor 与 engine 由 `createExerciseRuntime()` 成对创建。

## 数据流

```text
CameraAdapter / Demo Image
          │ PoseFrame
          ▼
PoseDetector → PoseFilter → PoseNormalizer
                                  │
                                  ▼
                     createExerciseRuntime(definition)
                        ├─ FeatureExtractor
                        ├─ ExerciseEngine
                        │     StateMachine + Rules + FeedbackPolicy
                        └─ presentation / debug / reference
                                  │
                                  ▼
                    features + RuleResult + ExerciseState + Feedback
                       ├─ generic Training UI (~100ms)
                       ├─ imperative PoseOverlay
                       ├─ SessionDiagnosticsRecorder
                       └─ TrainingSession
                                │
                                ▼
              TrainingSessionRepository interface
                ├─ Memory (domain default)
                └─ LocalStorage (page injects)
                                │ saved Session v2
                                ▼
                     TrainingReportBuilder
                 aggregation + presentation model
                                │ report-v1
                                ▼
                       TrainingReportPage
```

## UI 组成

`TrainingPage` 只组装布局。`useTrainingRuntime` 持有 Camera / Detector / Filter / Runtime / Session / Speech / Diagnostics。`SessionCompleteDialog` 用 Radix AlertDialog 管理完成态焦点。

完成弹层只确认 Session 已保存并导航到 `/report/:sessionId`。`TrainingReportPage` 从 Repository 重新取 Session，以纯 TypeScript `TrainingReportBuilder` 生成 report-v1；它不加载 MediaPipe、不访问动作引擎，也不把派生展示字段写回 Session。页面刷新可恢复，缺失 Session 显示明确空状态。

左侧 `CoachPanel` 不读取 CourseController、FeedbackPolicy、ExerciseEngine 或 Session；`CoachCardStateResolver` 将 Course snapshot、readiness、低频 progress、confirmed primary、recovery event、transition metadata 和 Exercise presentation 解析为单一 `CoachCardViewModel`。业务状态仅有 PREPARING、ACTIVE、CORRECTING、POSITIVE、TRANSITION。Countdown 与 pause 是 overlay，不扩展 Coach 状态机。

`FeedbackPolicy.update()` 继续产生受 speech cooldown 约束的播报事件；`getSnapshot()` 独立暴露 confirmed primary 与 recovery event。运行时在低频 UI tick 消费 recovery 前做一次性缓冲，因此 UI 不依赖语音成功与否，也不会漏掉单帧恢复事件。

`VoiceGuidePolicy` 是语音的单一事件策略，只消费 FeedbackPolicy speech event、CourseController snapshot 边沿和 runtime 已去抖的 Pose availability 边沿。它负责优先级、去重、Pose Lost 滞回与 cancel/drop 决策；renderer 中唯一 speech 输出出口调用 `BrowserSpeechAdapter`。语音不可用时策略静默丢弃，课程与视觉路径不等待 utterance。

Coach 局部提示读取现有 `coach-*.pose.json`，从 normalized shoulder/elbow/wrist/hip/knee anchor 推导 Halo 位置。缺失 anchor 时只降级视觉增强，文字和状态继续工作。

`CoachMotion` 只解释 Coach 图片序列，不进入 `CoachCardStateResolver`。双臂上举、深蹲、提膝使用 CSS step-style 循环；纠错态回到 canonical 静态图保证 Halo anchor 准确，暂停冻结，reduced motion 与缺少合法序列时均静态回退。

动作取景由 `FramingProfile` presentation 配置表达。前三个上肢动作的 FeatureExtractor 只将 pose quality bounds 指向 `UPPER_BODY_WITH_HIPS`；后三个动作与没有显式传参的调用继续使用默认 `FULL_BODY_BOUNDS`。

## Exercise Plugin Contract

`ExerciseDefinition<TFeatures, TState>` 仍冻结：动作 ID/名称、特征提取器工厂、引擎工厂、动态指标与阶段文案、调试字段、Reference Profile。`createExerciseRuntime` 把 extractor 与 engine 绑成一对，页面不再分别持有二者。

动作切换只替换 runtime，并重置滤波、骨架、语音和反馈显示。`BrowserCameraAdapter`、`PoseDetector` 和已加载 MediaPipe 模型保持原实例。

四个动作共享：`createExerciseEngine`、`PhasePersistenceGate`、`collectPoseQualityErrors`。状态机拓扑仍分文件，没有万能状态机框架。

`RepSummary` 为 discriminated union：侧平举、Step Jack、Squat 与 Knee Raise 各自携带专属字段。Knee Raise 的单侧 rep 另由状态机汇总 alternating cycle。

深蹲独有 Standing Baseline：在 FeatureExtractor 内冻结站立髋高，不进入另外一套检测管线。状态机拓扑仍分文件，没有万能状态机框架。

Knee Raise 独有轻量 Center Baseline：只冻结 hipMid X/Y 与 torso length。Baseline ready 前保持 preparation state，不计次；这不复制 Squat 的下蹲深度基线。

## 共享与专属边界

| 共享 | 侧平举 | Step Jack | Squat | Knee Raise |
|---|---|---|---|---|
| Camera/Pose/Normalizer | FeatureExtractor | FeatureExtractor | FeatureExtractor + Standing Baseline | FeatureExtractor + Center Baseline |
| 状态 | START→TOP→LOWERING | CENTER→左右OPEN→RETURN | STANDING→BOTTOM→ASCENDING | CENTER→左右RAISING→TOP→RETURNING |
| 评分 | 幅度/对称/稳定/节奏 | 协调/幅度/节奏/稳定/完整 | 深度/稳定/对称/完整/节奏 | 幅度/稳定/交替/对称/节奏 |
| 专属摘要 | LateralRaiseRepSummary | StepJackRepSummary | SquatRepSummary | KneeRaiseRepSummary |

生产规则阈值仍只写在各动作 `config.ts`。评分 falloff/权重在同文件的 `*_SCORING` 常量中，不进入校准 proposal 字段集。引擎通过 `getActiveConfig()` 读取当前 active 阈值（现为 engineering-v1）。

## 会话结构

`TrainingSessionState schemaVersion=2` 包含有序 `exercises[]` 和 `source: live | demo | synthetic`。每个动作结果独立记录。业务层默认使用内存仓储；浏览器页注入 `LocalStorageTrainingSessionRepository`，键为 `ai-coach.sessions:v2`。写失败返回 `false`，完成弹层提示“仅在本页有效”。损坏 JSON 与非 v2 对象被丢弃，不为 v1 做完整 migration。

## Diagnostics

导出 JSON 必须带 `dataSource`（`camera | demo_image | demo_image_sequence | synthetic_fixture`）、`captureSource`、`specVersion`、`thresholdVersion` 和单位元数据。Knee Raise 增量字段进入同一个 recorder/CSV，不保存视频或 landmarks。

## 性能策略

MediaPipe 动态导入本地 Lite / WASM。`PoseDetector.initialize` 共用 in-flight Promise，避免 StrictMode 双创建。逐帧数据在 ref / Canvas；React UI 约 100ms。暂停跳过 detect，不停摄像头 track。坐标映射集中在 `mapNormalizedLandmarkToCanvas`。Worker 仍不实施，见 `performance.md`。

## Phase 6C 产品集成边界

正式入口由轻量 pathname 分发：`/` 为 Home，`/train` 为 Training，`/report/:sessionId` 为 Report；带既有 `demo/course/debug/fast/exercise/fixture/coachFixture` 参数的 `/` 继续进入历史训练入口。三页只设置各自浏览器 title，不引入 Router 依赖。

Camera UI 将授权等待、模型加载、ready 与错误分开表达。`BrowserCameraAdapter` 对浏览器异常做 `permission_denied / device_unavailable / constraint_failed / unknown_error` 映射；Overconstrained 首次失败后只尝试一次宽松 `video: true`。模型错误独立显示，不向正式 UI 泄漏 WASM/Emscripten 信息。`PoseDetector.initialize` 仍复用 in-flight Promise，但创建失败会清除 rejected cache，保证 Retry 能重新初始化并保留 StrictMode close protection。

No Pose 是 runtime 可用性层状态，不进入动作阈值或 Exercise Engine：连续 500ms 无 Pose 后清空 Canvas。PREPARING 保持准备；COUNTDOWN 以 `ready:false` 回到准备；ACTIVE 使用 CourseController 既有 pause/resume 时间补偿且不注入空帧；TRANSITION 继续按墙钟推进；最终 transition 可直接触发 Session save 与完成弹层。用户主动 Pause 优先，Resume 后仍需等 Pose 返回。

LocalStorage Repository 将 stale active 明确定义为：`courseStatus=in_progress`、状态为 ready/active/paused、无 endedAt，且全部动作零 completed、零 repetitions、零 feedback、零 score。保存时只移除其它符合该定义的记录；completed 与用户 Manual End 产生的 incomplete 不参与清理，随后仍遵守原最近 20 条 eviction。
