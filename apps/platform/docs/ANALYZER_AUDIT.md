# 四个功法专项分析器 — 阶段 0 只读审计

- 日期：2026-10-01
- 仓库：`E:\FormPilot\FormPilot_v3`，基线 `main` @ `e4fdb41`；工作分支 `feature/routine-analyzers`（已创建，除本文件外没有任何改动，尚未提交）
- 基线测试：`vitest run` → 82 个文件 / 771 个用例全部通过
- 方法：只读阅读代码；另外用一个临时脚本（在会话临时目录，不进仓库）读取 `public/assets/routines/*-standard.pose.json`，测量了示范者的静止段与髋中心位置，作为第 4 节里步骤标注的数据依据。

---

## 0. 需要你先拍板的三件事

| # | 问题 | 我的建议 |
|---|---|---|
| D1 | **“平台篇 manifest 里列出的源文件”指哪些？** 平台 manifest 第二节“完整候选源码序列”列出了 `src/` 和 `reviewer_exe/src/` 下全部 287 个文件，包括 `useRoutineRuntime.ts`、`routineReport.ts`、`session/types.ts`、`RoutineReportView.tsx`。照字面理解，这次改动一个现有文件都不能碰，任务就做不了。 | 按“**平台篇 Word 实际打印的 21 个文件**”（manifest 第一节）理解。这 21 个文件都不需要改，平台篇 Word 的内容就会保持一致。第 3 节列出要改的现有文件，它们都在序列中部（不打印）。新增文件也会进入平台序列中部，所以平台 manifest 第二节的文件列表和总行数（30820）会变，打印内容不变。 |
| D2 | **新步骤字段（mode / weightShift / category / 主关节轨迹）放在哪里？** | **不改 `programs.ts`**，放进各分析器自己的步骤配置表（按 `chapterId` 索引），再加一个测试，保证四个功法的每一段都标注了。原因：`programs.ts` 的 `version` 注释写的是“章节内容变化就要升版本”，而 `compareWithPrevious` 要求 `programVersion` 相同才对比。如果在 programs 里加字段又升版本，用户所有旧记录都会失去“相比上次”。放在分析器里，`programs.ts`、`RoutineChapterSource` 类型、视频时间和版本号都不用动。 |
| D3 | **“姿态准确/目标姿态相似度”用什么算？** | 复用 `matcher.ts` 已导出的 `describePose` + `comparePoses`，不修改 matcher。<br>- 太极拳、五禽戏的“姿态”分：取该段 `FollowAlongMatch.similarity` 的平均值（与标准视频同一时刻的相似度）。<br>- 易筋经的“目标姿态”：取该势示范者**最长静止段中点**那一帧作为目标姿态（来自标准姿态轨迹），每个 tick 计算用户与它的相似度（同时比较原样和镜像，取较高者）。 |

---

## 1. 跟练引擎入口：当前式、评分、反馈、报告

| 职责 | 文件 | 关键位置 | 传递的类型 |
|---|---|---|---|
| 运行时总控（React hook） | `src/pages/Routines/useRoutineRuntime.ts` | `processFrame` L344–415；比对 tick 在 L393–410，每 100 ms 一次（`EVALUATION_INTERVAL_MS`） | `PoseFrame` → `PoseFilter` → `normalizePoseFrame` → `{ landmarks, confidence, aspect }` |
| 课程/播放时钟 | `CourseController` + `features/routines/routineCourse.ts` | `tick` L310–340；整个 scope 是一个 course step（`RoutineCourseStep`） | `CourseSnapshot` |
| **当前式** | `features/routines/scope.ts` `chapterAt(program, videoSeconds)` | 运行时 L327、L404：按视频时间定位当前章节（“视频即时钟”） | `RoutineChapter`（`id/kind/label/name/startSeconds/endSeconds/cue/index/formNumber`） |
| 跟练相似度 | `features/routines/followAlong/matcher.ts` `FollowAlongMatcher.evaluate` | 运行时 L396 | `FollowAlongMatch { status, similarity, timingOffsetMs, matchedAt, videoTime, regionScores, mirrored }` |
| 章节累计 | `features/routines/session/RoutineProgressRecorder.ts` | 运行时 L398 `recordComparison` | `RoutineChapterResult[]` |
| **动作规范评分（现有 Scoring v2.1）** | `features/scoring/routine/RoutineTechniqueEvaluator.ts` | 构造于 L593（参考轨迹加载后）；`observe` 在 L399；`snapshot` 在 L233/L402 | 输入 `TechniqueUserPose`；输出 `RoutineTechniqueRecord { version, criteria[{criterionId, chapterId, windows[]}] }` |
| 评分规则 | `features/scoring/criteria/{baduanjin,taijiquan,wuqinxi,yijinjing}.ts` 经 `routineMeasuredCriteria(id)` | 阶段窗口由 `phaseWindows.ts` 从标准姿态轨迹中检测；指标在 `poseMetrics.ts` | `EvaluationCriterion`（`measurement.kind === 'pose-window'`） |
| 实时反馈 | `features/routines/followAlong/feedbackPolicy.ts` `RoutineFeedbackPolicy.update(match, now, cue)` | 运行时 L405–408（必要时播报语音） | `RoutineFeedback { code, tone, message }` |
| 训练页“动作规范检查” | `features/routines/followAlong/liveChecks.ts` `liveChecks(...)` | `RoutineTrainingPage.tsx` L84，读取 `runtime.techniqueRecord` | `LiveCheck[]` |
| 持久化 | `session/types.ts` `RoutineSessionRecord` + `RoutineSessionRepository`（localStorage） | 运行时 `persist` L229–239：`record.chapters`、`record.technique` | `RoutineSessionRecord`（`technique?` 是 Scoring v2 新增的可选字段，有先例） |
| 报告 | `features/routines/report/routineReport.ts` `buildRoutineReport(record, history)` → `scoring/routine/techniqueReport.ts` `buildRoutineTechniqueReport` | 页面：`pages/Report/RoutineReportView.tsx` + `scoreExplanation.tsx` `RoutineTechniqueSection` | `RoutineReport`（`technique: RoutineTechniqueReport`） |

注意：现有“八段锦评分”并不是八段锦专用代码。`RoutineTechniqueEvaluator` 是通用的，四个功法都通过它运行各自的 criteria：

| 功法 | 摄像头检查 | 其中 ADVISORY | 仅供参考 | 不可观测 |
|---|---|---|---|---|
| 八段锦 | 26 | 1 | 7 | 14 |
| 太极拳 | 3 | 2（另有节奏同步 1 项 follow-along 统计） | 1 | 4 |
| 五禽戏 | 5 | 0 | 7 | 5 |
| 易筋经 | 8 | 0 | 8 | 3 |

---

## 2. 评分数据流，以及接入 RoutineAnalyzer 的最小改动点

现有流程（每个比对 tick）：

```
相机帧 → PoseFilter → normalizePoseFrame
  └─(ACTIVE 且视频在播放，每 100 ms)
      matcher.evaluate ──► recorder.recordComparison ──► record.chapters
      technique.observe ──► technique.snapshot ─────────► record.technique
      feedbackPolicy.update ──► 训练页文案 / 语音
结束 / 每 10 s → persist → localStorage
报告页 → buildRoutineReport(record) → technique 报告 + 相似度报告
```

接入方式：只增加一层，原有调用一条都不改。

1. 新建共享层 `src/features/routines/analyzers/`：
   - `types.ts`：`RoutineAnalyzer` 接口和公共结果类型；
   - `timeWindow.ts`：时间窗口，环形缓冲，按时长裁剪；
   - `registry.ts`：按 `RoutineId` 查找分析器工厂；
   - `RoutineAnalysisEngine.ts`：按章节切分特征序列，调用分析器，生成快照；
   - `analysisRecord.ts`：可持久化的记录类型和守卫函数。
2. `useRoutineRuntime.ts` 只加三处，每处 1–3 行：
   - L593 旁：`analysisRef.current = createRoutineAnalysis(program, scope, track)`。功法没有注册分析器时返回 `undefined`，**回退到现有行为**。
   - L399 旁：`analysisRef.current?.observe(stage.currentTime, now, pose, result)`。
   - `persist` 里：`if (analysisRef.current) record.analysis = analysisRef.current.snapshot()`。

   另外每 500 ms 把实时视图交给页面，跟 `techniqueRecord` 的节流方式相同。
3. `session/types.ts`：新增可选字段 `analysis?: RoutineAnalysisRecord`。守卫只做浅层校验：`analysis` 缺失或是对象都接受。深层校验放在报告构建里，不合格的 `analysis` 直接忽略，不让整条记录作废，所以旧记录不受影响。
4. `routineReport.ts`：在返回对象上**新增**一个 `analysis` 字段，内容是分析器的 `buildReportMetrics`。`notes`、`focus`、`headline` 等现有数组和字符串**一个字都不改**，分析器自己的说明放进 `analysis` 内部。
5. 现有 `RoutineFeedbackPolicy` 和语音播报都不动。分析器反馈在训练页单独显示一行，**不播报语音**，所以现有反馈和语音行为不会变。

接口语义（类型名沿用现有风格，细节在阶段 1 定稿）：

```ts
interface AnalyzerSample<F> { at: number /* 帧时间 ms，用于速度类指标 */; videoSeconds: number; features: F | null }

interface RoutineAnalyzer<F, E> {
  id: RoutineId
  version: string
  config: Readonly<...>                     // 所有阈值集中在这里，带单位和“provisional / 待标定”注释
  extractFeatures(frame: AnalyzerPose, ctx: AnalyzerContext): F | null   // ctx: chapter, videoSeconds, aspect, match?
  evaluate(window: ReadonlyArray<AnalyzerSample<F>>, step: RoutineChapter): E | null   // 纯函数，不保存状态
  buildFeedback(evaluation: E, step: RoutineChapter): AnalyzerFeedbackItem[]            // 中文，带具体数值
  buildReportMetrics(evaluations: ReadonlyArray<{ chapterId: string; evaluation: E }>): AnalyzerReportMetrics
}
```

`evaluate` 被调用两次：

- 实时：对约 3 s 的滑动 `TimeWindow` 调用，结果用于实时反馈；
- 存档：对该章节的完整特征序列调用。完整序列有上限：最长一段约 126 s × 10 Hz ≈ 1260 个样本，结果写进 `record.analysis`。

因为 `evaluate` 是纯函数，易筋经状态机、太极停顿检测这些都能用合成序列直接测。

时间基准：

- 速度、抖动、急动度按帧的真实时间（ms）计算；
- 章节归属按视频时间判断。
- 两个样本间隔超过 `maxGapMs`（暂停、丢帧）时，在那里断开，不跨间隔计算速度。
- 快速模式（视频 8 倍速，仅测试用）下，速度类指标没有意义，报告里会标注。

需要“示范者参考值”的指标在分析器创建时从标准姿态轨迹计算一次，这和 Scoring v2 的阶段窗口是同一个思路（视频即时钟、参考值按示范实测）。具体包括：

- 易筋经：目标姿态、目标保持时长；
- 八段锦：峰值幅度。

---

## 3. 新增 / 修改文件清单

### 3.1 修改的现有文件（都不在平台篇 Word 打印的 21 个文件中）

| 文件 | 改动 | 原因 | 对平台篇的影响 |
|---|---|---|---|
| `src/pages/Routines/useRoutineRuntime.ts` | +约 10 行：创建、调用、持久化分析引擎，节流输出实时视图 | 引擎接入点 | 在平台序列中部，不打印，Word 不变；序列总行数变化 |
| `src/features/routines/session/types.ts` | +可选 `analysis` 字段 + 1 行守卫 | 持久化 | 同上 |
| `src/features/routines/report/routineReport.ts` | +`analysis` 字段（新增，不改现有字段） | 报告字段 | 同上 |
| `src/pages/Report/RoutineReportView.tsx` | +1 行挂载新的“专项分析”分区组件 | 阶段 4 报告展示 | 同上 |
| `src/pages/Routines/RoutineTrainingPage.tsx` 或 `src/components/routines/RoutineFeedbackPanel.tsx` | +一行专项实时指标 | 阶段 4 训练页展示 | 同上 |
| `tests/helpers/routineFixtures.ts`（可能） | 复用或补充辅助函数 | 测试 | 不在任何 manifest 中 |

**不修改：**

- `programs.ts`、`routines/types.ts`（见 D2）；
- `matcher.ts`、`feedbackPolicy.ts`、`liveChecks.ts`；
- `RoutineTechniqueEvaluator.ts`、`phaseWindows.ts`、`poseMetrics.ts`；
- 全部 criteria、`sources.ts`、`techniqueReport.ts`；
- 摄像头、MediaPipe、滤波、Session、视频、历史、Electron 相关文件。

分析器需要的有符号或特有几何量（例如带方向的转头、肩线与髋线夹角、耳—肩距离），都在分析器自己的文件里实现，不改 `poseMetrics.ts`。

### 3.2 新增文件（暂定路径）

| 文件 | 内容 |
|---|---|
| `src/features/routines/analyzers/types.ts` | 接口、`AnalyzerContext`、`MetricResult { metricId, value, targetRange, score }`、反馈条目、报告字段类型 |
| `…/analyzers/timeWindow.ts` | `TimeWindow<T>`：按时长裁剪的环形缓冲（只写这一次） |
| `…/analyzers/bodyFrame.ts` | 共享的二维身体坐标：aspect 校正、躯干长归一化、髋中心、肩中心、可见度判断（返回 null 的约定与 poseMetrics 一致） |
| `…/analyzers/signal.ts` | 共享的信号工具：平滑、速度、加速度、急动度、RMS、滞回穿越计数 |
| `…/analyzers/RoutineAnalysisEngine.ts` + `registry.ts` + `analysisRecord.ts` | 引擎、注册表、持久化类型与守卫 |
| `…/analyzers/baduanjin/{config,steps,BaduanjinAnalyzer}.ts` | 到位度（增量） |
| `…/analyzers/taijiquan/{config,steps,TaijiquanAnalyzer}.ts` | 连续性 |
| `…/analyzers/wuqinxi/{config,steps,profiles,WuqinxiAnalyzer}.ts` | 五戏 Profile |
| `…/analyzers/yijinjing/{config,steps,YijinjingAnalyzer}.ts` | 稳定性 |
| `src/components/routines/RoutineAnalyzerLive.tsx`、`src/pages/Report/RoutineAnalyzerSection.tsx` | 阶段 4 的最小 UI |
| `tests/helpers/syntheticPose.ts` | 合成关键点生成器：静止、匀速移动、晃动、停顿、单腿站立、躯干扭转、缺点、两踝过近 |
| `tests/routine-baseline.test.ts` + `tests/fixtures/routine-baseline/*.json` | 阶段 1 快照回归 |
| `tests/routine-analyzer-{engine,baduanjin,taijiquan,wuqinxi,yijinjing}.test.ts` | 每个分析器 ≥ 6 个用例 |

---

## 4. programs.ts 的步骤结构与缺失字段

现有字段：

- `RoutineChapterSource`：`id, kind('opening'|'form'|'closing'), label, name, startSeconds, cue`；
- `buildChapters` 派生：`index, formNumber, endSeconds`。

四个功法都没有以下任何字段：动作类型、重心方向、五戏类别、主关节轨迹、左右侧模式、目标保持时长、目标幅度。

| 功法 | 缺少的字段 | 建议来源 |
|---|---|---|
| 易筋经 | `mode: 'hold' \| 'transition'` | 分析器步骤表（D2）；目标保持时长、目标姿态从示范轨迹实测 |
| 太极拳 | `weightShift: 'left' \| 'right' \| 'transfer' \| 'balanced'` | 分析器步骤表；实现时用示范轨迹做一致性检查 |
| 五禽戏 | `category: 'tiger' \| 'deer' \| 'bear' \| 'ape' \| 'bird'` | 分析器步骤表（现有 `label` 已是“虎戏/鹿戏…”，但只是显示文字） |
| 八段锦 | `mainTrajectory`（主关节轨迹指标）、`sides: 'bilateral' \| 'alternating'`、目标峰值 | 分析器步骤表；目标峰值从示范轨迹实测 |

### 4.1 易筋经 mode 标注（建议值 + 示范实测）

“静止”的测法：腕、肩、髋六点中的最大速度低于 0.25 躯干长/s（审计用的阈值，不是产品阈值）。

| 段 | 名称 | 示范静止占比 | 最长静止 s | 建议 | 需复核 |
|---|---|---|---|---|---|
| yjj-open | 预备势 | 96% | 14.8 | hold | ✔（预备势是否计入保持评价） |
| yjj-1 | 韦驮献杵第一势 | 79% | 5.8 | hold | |
| yjj-2 | 韦驮献杵第二势 | 70% | 6.5 | hold | |
| yjj-3 | 韦驮献杵第三势 | 78% | 9.5 | hold | |
| yjj-4 | 摘星换斗势 | 29% | 2.2 | transition | ✔（有“目视掌心”定势，但示范静止很短） |
| yjj-5 | 倒拽九牛尾势 | 30% | 1.2 | transition | |
| yjj-6 | 出爪亮翅势 | 81% | 11.9 | transition | ✔（描述是推出、回收往复；示范动作慢，静止占比高） |
| yjj-7 | 九鬼拔马刀势 | 24% | 3.0 | transition | ✔（拔伸位有短暂停留） |
| yjj-8 | 三盘落地势 | 38% | 3.4 | hold | ✔（三次下蹲，每次短暂停留） |
| yjj-9 | 青龙探爪势 | 23% | 5.8 | transition | |
| yjj-10 | 卧虎扑食势 | 42% | 5.3 | transition | ✔（有塌腰抬头的定势） |
| yjj-11 | 打躬势 | 37% | 13.7 | transition | ✔（开头的“鸣天鼓”是静止段） |
| yjj-12 | 掉尾势 | 18% | 1.5 | transition | |
| yjj-close | 收势 | 55% | 8.6 | transition | ✔ |

transition 势不计算保持完成度。总分按“姿态 0.40 + 稳定性 0.35”重新归一化，稳定性只看动作中的抖动（jitter），不看晃动。这个规则写进 config，请确认。

### 4.2 太极拳 weightShift 标注（建议值 + 示范实测）

`supportRatio = (髋中心x − 左踝x) / (右踝x − 左踝x)`，0 = 左踝上方，1 = 右踝上方。左右指人体解剖左右（MediaPipe 的 left/right）。两踝间距小于 0.25 躯干长时记为 unknown。

| # | 名称 | 示范 p10/p50/p90 | 建议 | 需复核 |
|---|---|---|---|---|
| 1 | 起势 | 0.48/0.52/0.98 | balanced | |
| 2 | 左右野马分鬃 | 0.06/0.59/1.02（穿越 12 次） | transfer | |
| 3 | 白鹤亮翅 | 0.03/1.02/1.16 | right（左虚步） | |
| 4 | 搂膝拗步 | 0.09/0.52/1.13（9 次） | transfer | |
| 5 | 手挥琵琶 | −0.42/**−0.11**/0.27 | right（左虚步） | ✔ **示范实测偏左，与描述相反** |
| 6 | 倒卷肱 | −0.28/0.34/1.01（11 次） | transfer | |
| 7 | 左揽雀尾 | 0.29/0.53/0.81（9 次） | transfer | |
| 8 | 右揽雀尾 | 0.16/0.39/0.72（20 次） | transfer | |
| 9 | 单鞭 | 0.26/0.62/1.05 | transfer | ✔（定势是左弓步，是否应标 left） |
| 10 | 云手 | −0.13/0.63/1.02 | transfer | |
| 11 | 单鞭 | 0.11/0.67/1.13 | transfer | ✔ 同 9 |
| 12 | 高探马 | 0.87/1.16/1.41 | right | |
| 13 | 右蹬脚 | −0.27/−0.05/0.06 | left（左腿支撑） | |
| 14 | 双峰贯耳 | −0.08/**0.20**/0.48 | right（右弓步） | ✔ **示范实测偏左，与描述相反** |
| 15 | 转身左蹬脚 | 0.46/1.00/1.17 | right（右腿支撑） | |
| 16 | 左下势独立 | 0.07/0.98/1.41 | transfer | |
| 17 | 右下势独立 | −0.08/0.20/0.78 | transfer | |
| 18 | 左右穿梭 | 0.12/0.71/1.07 | transfer | |
| 19 | 海底针 | 0.21/1.20/1.85 | right | |
| 20 | 闪通臂 | 0.33/0.53/1.38 | transfer | ✔（定势是左弓步） |
| 21 | 转身搬拦捶 | −0.22/0.32/1.08 | transfer | |
| 22 | 如封似闭 | 0.27/0.37/0.77 | transfer | |
| 23 | 十字手 | −0.09/0.52/0.73（2 次） | balanced | ✔（中途有右移再回中） |
| 24 | 收势 | 0.23/0.41/0.44 | balanced | |

5 和 14 两式的矛盾正好说明了这个二维近似的局限。示范者侧身或背身时，前后两脚在画面中的左右位置会交换，MediaPipe 在人背对镜头时也可能把左右标反。所以：

- `left` / `right` 一致性得分权重只有 0.20；
- 用户镜像跟练时（`match.mirrored`）会翻转期望的左右；
- 报告和 UI 一律称“基于姿态关键点的二维髋中心近似”。

### 4.3 五禽戏 category（无歧义）

| 段 | category |
|---|---|
| wqx-1 虎举、wqx-2 虎扑 | tiger |
| wqx-3 鹿抵、wqx-4 鹿奔 | deer |
| wqx-5 熊运、wqx-6 熊晃 | bear |
| wqx-7 猿提、wqx-8 猿摘 | ape |
| wqx-9 鸟伸、wqx-10 鸟飞 | bird |

起势和收势不标注，分析器对这两段不输出 Profile。

### 4.4 八段锦主关节轨迹（建议，需复核的在右列标出）

| 式 | 主轨迹（峰值方向） | 左右 | 需复核 |
|---|---|---|---|
| 1 托天 | 两腕高出头部（↑） | 双侧同时 | |
| 2 开弓 | 推弓手腕距肩中点的水平距离 / 肩宽（↑） | 交替 | |
| 3 单举 | 上举手腕高出同侧肩（↑） | 交替 | |
| 4 后瞧 | 带方向的转头幅度（↑） | 交替 | |
| 5 摇头摆尾 | 肩中心相对髋中心的侧移 / 躯干长（↑） | 交替 | ✔（二维只能看到侧摆分量） |
| 6 攀足 | 两腕低于髋部的距离 / 躯干长（↑） | 双侧同时 | |
| 7 冲拳 | 腕离开肩的图像平面位移 | 交替 | ✔（向前冲拳在正面画面中有透视缩短，幅度可能不可靠，可能只做阶段检测、不评幅度） |
| 8 颠足 | 肩中心绝对高度相对本段基线的抬升 / 躯干长（↑） | — | ✔（依赖相机固定，属代理指标） |

---

## 5. 风险点与回归测试方案

### 5.1 风险

1. **平台文件口径**（D1）：如果你要求连平台序列中部的文件也不能改，引擎就无法接入。需要你确认。
2. **programs 版本号**（D2）：改 programs 并升版本会破坏历史对比；本方案不改。
3. **二维近似的局限：**
   - 太极支撑比例在侧身、背身时可能左右颠倒（示范实测已有 2 式矛盾）；
   - 五禽戏的躯干前倾、扭转在正面画面中都只是代理量；
   - 鸟戏的抬脚高度依赖踝点可见；
   - 猿戏的耸肩需要耳部关键点（7/8），现有代码没用过这两个点。

   这些都会以 PROXY 的形式写进 config 注释和报告说明。
4. **阈值没有真人标定。** 全部标为 provisional / 待标定。唯一的合理性检查是“示范者自己跑一遍应得高分”，这和 Scoring v2 的单元测试用法相同。它只能证明阈值没有和示范冲突，不代表准确。
5. **快照稳定性：**
   - 现有评分没有随机数和墙钟依赖（matcher 的时间都由参数传入），可以做到逐字节一致；
   - 但报告中的 `record.id`、`startedAt` 必须在夹具里固定。
6. **报告“只新增字段”：**
   - `notes`、`focus`、`headline` 不能追加分析器内容，否则快照会变；
   - `RoutineSessionRecord` 的守卫也不能变严，否则旧记录会被拒。
7. **性能：**
   - 每 100 ms 多一次特征提取，都是常数级几何运算；
   - 每章序列最多约 1300 个样本；
   - 每 10 s 持久化时对当前章做一次纯函数评估；
   - 预计开销可以忽略，阶段 3 会给出实测耗时。
8. **localStorage 体积**：每章只存汇总数值（约 0.5–2 KB），全套 26 段不超过约 50 KB。
9. **软著：**
   - 新增的接口、窗口工具和引擎在四篇里是共用代码，四篇之间仍会有可观的重合；
   - 专项占比在实现完成前无法准确预估，阶段 5 会如实统计，不挑选无关代码来降重。

### 5.2 回归测试方案

1. **基线快照（阶段 1 的第一个提交，先于任何源码改动）：**
   - 输入：四条真实标准姿态轨迹（仓库内，确定性），加上确定性变换：原样、滞后 0.6 s、镜像、种子固定的噪声、双肘屈曲 30°、间歇丢帧；再加合成生成器序列。
   - 记录：`RoutineTechniqueEvaluator.snapshot()`、`FollowAlongMatcher` + `RoutineProgressRecorder` 的章节结果、`RoutineFeedbackPolicy` 的输出序列、`liveChecks`、`buildRoutineReport` 全部字段（`criterion` 对象折成 id）。
   - 夹具在 `e4fdb41` 的代码上生成，存成 JSON。之后断言为：删除新增字段（`analysis`）后，结果与夹具深度相等。
   - 生成脚本受环境变量保护（`UPDATE_ROUTINE_BASELINE=1`），正常运行只做比较。
2. 现有 771 个单元测试保持全部通过。
3. 每个分析器 ≥ 6 个用例，包括：
   - 好动作得高分、明显错误得低分的对照；
   - 缺失关键点；
   - 两踝过近；
   - 窗口不足（样本少于下限时返回 null，不给分）；
   - 示范轨迹自测。
4. 每次提交前运行：

   ```
   pnpm test
   pnpm typecheck
   pnpm lint
   pnpm build
   ```

   阶段 4 之后再运行与跟练相关的 e2e：`routines`、`scoring-v2`、`routine-layout`、`round2-usability`、`report-v2`。
5. 阶段 5：
   - 平台篇重新生成后，与现有 PDF 的抽取文字逐字比对；
   - 四篇用 Word 另存 PDF，逐页检查，出 `render_check`。

---

确认 D1–D3，并复核第 4 节标 ✔ 的步骤后，我开始阶段 1。

---

## 6. 决策落实与实测（阶段 1–2，2026-10-01）

D1–D3 均按建议采纳：平台篇只锁定 Word 实际打印的 21 个文件；mode / weightShift / category 放进各分析器自己的步骤表（`src/features/routines/analyzers/<功法>/steps.ts`），`programs.ts` 与 `programVersion` 不变；目标姿态相似度复用 `describePose` / `comparePoses`，不改 matcher。

### 6.1 易筋经 hold / transition（按规则，不按主观判断）

规则：预备势、收势为 hold；其余势在示范者存在连续静止段 ≥ 1500 ms（`YIJINJING_ANALYZER_CONFIG.stillness.holdMinMs`）时为 hold，否则 transition。静止的测法与第 4.1 节相同（腕、肩、髋六点逐帧最大速度 < 0.25 当前帧躯干长/s，原始位置，不平滑），这是你做决定时依据的测法，实现时没有换成别的定义。`tests/routine-analyzer-yijinjing.test.ts` 用示范轨迹逐势复核规则与步骤表一致。

| 段 | 名称 | 示范最长静止 | 结果 | 与第 4.1 节建议相比 |
|---|---|---|---|---|
| yjj-open | 预备势 | 14.8 s | hold | 同 |
| yjj-1 | 韦驮献杵第一势 | 5.8 s | hold | 同 |
| yjj-2 | 韦驮献杵第二势 | 6.5 s | hold | 同 |
| yjj-3 | 韦驮献杵第三势 | 9.5 s | hold | 同 |
| yjj-4 | 摘星换斗势 | 2.2 s | hold | 原建议 transition |
| yjj-5 | 倒拽九牛尾势 | 1.2 s | **transition** | 同 |
| yjj-6 | 出爪亮翅势 | 11.9 s | hold | 原建议 transition |
| yjj-7 | 九鬼拔马刀势 | 3.1 s | hold | 原建议 transition |
| yjj-8 | 三盘落地势 | 3.4 s | hold | 同 |
| yjj-9 | 青龙探爪势 | 5.8 s | hold | 原建议 transition |
| yjj-10 | 卧虎扑食势 | 5.3 s | hold | 原建议 transition |
| yjj-11 | 打躬势 | 13.7 s | hold | 原建议 transition |
| yjj-12 | 掉尾势 | **1.5 s（恰好 1500 ms）** | hold | 原建议 transition；正好落在阈值上，按 “≥” 判为 hold，少一帧就会变成 transition |
| yjj-close | 收势 | 8.6 s | hold | 原建议 transition；规则规定收势为 hold |

结果：只有倒拽九牛尾势是 transition。目标姿态 = 示范者该势最长静止段中点的帧；有左右之分的势（摘星换斗、倒拽九牛尾、九鬼拔马刀、青龙探爪、卧虎扑食、掉尾）只按原样比较，不取镜像。

### 6.2 太极拳 scoreShift（按规则）

定势窗口：示范者在该式后 60% 时间内速度最低的 2 s。规则：定势窗口内示范者已知帧中与标注方向一致的比例 ≥ 70% 才计分（left < 0.4，right > 0.6，balanced 0.3–0.7）；transfer 式要求全式已知帧 ≥ 70% 且至少一次左右穿越。

| 式 | 标注 | 示范一致比例 | scoreShift |
|---|---|---|---|
| 手挥琵琶 | right（按描述保留） | 0% | false（二维近似在侧身时左右颠倒） |
| 双峰贯耳 | right（按描述保留） | 0% | false（同上） |
| 单鞭（第 9 式） | left | 0% | **false**（按规则） |
| 单鞭（第 11 式） | left | 35% | **false**（按规则） |
| 十字手 | balanced | 0% | **false**（按规则） |
| 左下势独立 | transfer | 已知帧 58% | **false**（按规则） |
| 闪通臂 | left | 85% | true |
| 其余 17 式 | 见步骤表 | 73%–100% / transfer 已知帧 76%–99% | true |

单鞭 ×2、十字手、左下势独立是规则算出来的 false，不是我改的标注：标注方向仍是你定的 left / balanced / transfer，只记录不计分，权重按比例分给其他项。

### 6.3 八段锦与五禽戏的落实

- 第五式摇头摆尾：阶段轨迹 = 头部相对髋中心的水平偏移；躯干侧倾角作为第二幅度，两者平均计入幅度。
- 第七式攒拳：只做阶段检测（拳从腰间抬至肩高），评估记录与报告字段 `amplitudeEvaluated=false`，幅度指标显示“未评估幅度”，权重 0。
- 第八式颠足：指标名 `heelRiseProxy`（肩中心抬升近似提踵），权重 0.10（其余式幅度 0.40），文案写“近似”，说明“不是精确测量”。
- 五禽戏：起势、收势不出 Profile；十动按 虎、鹿、熊、猿、鸟 分组，报告给出每戏的特征幅度与得分。

## 7. 示范者自检（`tests/routine-analyzer-self-check.test.ts`）

方法：用四段标准视频自带的姿态轨迹，让“示范者跟练自己”（逐 0.1 s 走完整套，与运行时相同的比对、记录和分析流程），再对同一序列做三类扰动。参数在 `src/features/routines/analyzers/selfCheckConfig.ts`：

- 噪声：每个关键点加标准差 0.05 躯干长的高斯噪声（按真实比例各向同性，固定种子）；
- 幅度 0.6：每个关键点（相对髋中心）和髋中心轨迹都向本段平均姿态收缩到 0.6 倍；
- 时间错位 + 停顿：落后视频 2 s，且每 6 s 先停住 1.5 s 再加快追上（实际落后 2–3.5 s）。

验收：示范者每个计分段 ≥ 80；每类扰动使该分析器平均分至少下降 15。

### 7.1 结果（各段专项分平均）

| 分析器 | 示范者平均（最低段） | 噪声 | 幅度 0.6 | 时间错位 + 停顿 |
|---|---|---|---|---|
| 八段锦到位度（8 式） | 99.6（97） | 73.1（−26.5） | 78.5（−21.1） | 70.4（−29.2） |
| 太极拳连续性（24 式） | 100（100） | 76.2（−23.8） | 76.2（−23.8） | 70.0（−30.0） |
| 五禽戏五戏特征（10 动） | 100（100） | 75.6（−24.4） | 65.6（−34.4） | 79.9（−20.1） |
| 易筋经稳定性（14 段） | 99.6（95） | 52.9（−46.7） | 81.4（−18.2） | 84.4（−15.2） |

### 7.2 各指标对扰动的反应（该指标在计分段上的平均分：示范 / 噪声 / 幅度 / 时间）

| 分析器 | 指标 | 示范 | 噪声 | 幅度 | 时间 |
|---|---|---|---|---|---|
| 八段锦 | 到位幅度 | 100 | 100 | 33 | 97 |
| | 到位时机 | 100 | 100 | 100 | 33 |
| | 定势稳定 | 99 | 5 | 100 | 98 |
| | 完成次数 | 100 | 100 | 100 | 78 |
| | heelRiseProxy（颠足） | 100 | 100 | 27 | 100 |
| 太极拳 | 架势与示范一致 | 100 | 77 | 64 | 71 |
| | 动作圆顺不抖 | 100 | 17 | 100 | 95 |
| | 连贯不停顿 | 100 | 100 | 100 | 19 |
| | 舒展度 | 100 | 100 | 30 | 93 |
| | 重心转移（计分的式） | 100 | 99 | 79 | 82 |
| 五禽戏 | 五戏特征（13 个特征，均值范围） | 100 | 100 | 10–38 | 92–100 |
| | 形似示范 | 100 | 77 | 73 | 89 |
| | 动作节律 | 100 | 100 | 100 | 14 |
| | 动作稳定 | 100 | 1 | 100 | 100 |
| 易筋经 | 姿态（目标 / 跟练相似度） | 100 | 90 | 80 | 92 |
| | 保持完成度 | 100 | 0 | 77 | 54 |
| | 稳定性 | 99 | 45 | 99 | 95 |

每个保留下来的指标至少对一类扰动有明显反应。

### 7.3 因“无区分度”而更换或调整的地方

| 分析器 | 原做法 | 自检表现 | 处理 |
|---|---|---|---|
| 太极拳 | “速度均匀”：速度围绕 ±1 s 趋势的相对波动 | 示范 96 / 噪声 96 / 幅度 96 / 时间 89，三类扰动都分不开（噪声同时抬高平均速度，比值不变） | 删除；改为位置抖动（“动作圆顺不抖”），示范 ≤ 0.019，噪声 ≥ 0.027 躯干长 |
| 太极拳 | 只有“架势一致”反映幅度，幅度扰动只降 10 分 | — | 新增“舒展度”（你的运动路程 / 示范者同一时刻的路程，权重 0.15）；架势相似度满分线由 85% 调到 90%、零分线由 55% 调到 60% |
| 五禽戏 | 鹿抵的“转腰”代理：肩宽 / 髋宽之比的变化 | 示范 100 / 噪声 100 / 幅度 100 / 时间 100 | 删除；鹿抵第二特征改为屈膝（弓步，示范 54°） |
| 易筋经 | 保持完成度满分线 0.8、零分线 0.3（相对示范静止时长） | 时间扰动只降 12 分 | 改为 0.9 / 0.4。评价窗口本来就比示范静止段多留 1 s，落后 1 s 以内仍是满分 |

### 7.4 需要知道的局限

- 易筋经对“时间错位 + 停顿”只降 15.2 分，刚过 15 分线：它评的是定势稳不稳，长定势本身能吸收 2–3.5 s 的落后。这是该分析器的性质，没有为了过线去加与稳定性无关的时机指标。
- 易筋经的幅度扰动主要由卧虎扑食势、掉尾势体现（这两势降到 0）；其余以静止为主的势，“向本段平均姿态收缩”几乎不改变定势本身，所以该扰动对它们影响小。
- 八段锦第七式在时间扰动下为 0 分：冲拳持续 2–4 s，落后 2–3.5 s 时在示范的冲拳时段内看不到你的冲拳。第八式颠足每 7 s 重复一次，落后约 7 s 时会与下一次对齐（周期混叠），时间扰动下仍有 95 分。
- 全部阈值是暂定值。自检只证明“阈值不和示范冲突、扰动能被分辨”，不代表对真人准确。真人录像标定后才能定稿。
- 易筋经“静止”沿用第 4.1 节的测法（原始位置逐帧速度）。改用轻度平滑的位置会让每一势都超过 1.5 s，规则结果会完全不同；实现时没有改测法。
