# Training Report 数据契约

## Version and Ownership

`TrainingReportData.reportVersion = report-v1`。它是 `TrainingSessionState schemaVersion=2` 的只读派生模型，不写回 Session；`reportVersion`、`courseVersion`、Session schema version 和 threshold version 是相互独立的版本域。

## Root Shape

```text
TrainingReportData
├─ identity: reportVersion, sessionId, courseId, courseName, courseVersion
├─ timing: startedAt, endedAt?, durationMs?
├─ state: courseStatus, completion { status, completed, total, label }
├─ score: overallScore?, overallScoreLabel, overallScoreScope, description
├─ exercises: guidanceExercises[], scoredExercises[], exerciseSummaries[]
├─ analysis: capabilitySummary[], topIssues[], recommendations[]
├─ feedbackCount
└─ metadata: sourceSessionSchemaVersion, captureSource, scoreSource, confirmedIssueCount
```

## ExerciseReportSummary

每项包括 `exerciseId/name/evaluationMode`、`completion`、`progress/target/targetType`、可空 `score`、presentation 选择的 `metrics[]`、可空 `repCount/cycleCount/durationMs`、`topIssues[]` 和 `summaryText`。Guidance 的 score 永远为 null；cycles 使用成对 rep 计算；不可用数据保持 null。

## CapabilitySummaryItem

每项包括固定 dimension、中文 label、可空 0–100 value、`sampleCount`、`availableExerciseCount`、`totalExerciseCount` 和逐 exercise contribution。Contribution 明确记录 metric keys 与单动作贡献值，便于审计聚合来源。

## ReportIssue

每项包括稳定 id、exercise identity、error code、report label、原 confirmed message、count、可选 side、最大 severity 与首次时间。只由 confirmed correction event 构建。

## ReportRecommendation

每项包括 `id/priority/sourceType/text`，并按来源可选记录 `sourceExercise/sourceError`。`sourceType` 仅为 `issue | capability | exercise_metric | neutral`。

## Score Source Metadata

- `session`：完整课程直接使用保存的 `courseOverallScore`。
- `derived_from_saved_exercise_results`：完整课程缺总分时的兼容 fallback，或 incomplete 的已完成动作平均分。
- `unavailable`：没有足够的保存结果。

Builder 不读取 DOM、React、Camera、Pose 或任何运行时 engine；所有排序与 fallback 都有固定规则并由测试覆盖。
