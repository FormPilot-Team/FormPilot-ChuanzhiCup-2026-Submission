import type { CourseTargetType, EvaluationMode } from '../course/CourseDefinition'
import type { ExerciseId } from '../exercises/types'
import type { ExerciseSessionResult, TrainingSessionState } from '../training/types'
import { aggregateCapabilities } from './capabilityAggregation'
import { aggregateConfirmedIssues } from './issueAggregation'
import { REPORT_COURSE_NAME, REPORT_EXERCISE_PRESENTATION, scorePresentation } from './presentation'
import { buildRecommendations } from './recommendationRules'
import { TRAINING_REPORT_VERSION, type ExerciseReportSummary, type ReportIssue, type TrainingReportData } from './types'

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function mean(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
}

function evaluationMode(exerciseId: ExerciseId, exercise?: ExerciseSessionResult): EvaluationMode {
  return exercise?.evaluationMode ?? (exerciseId === 'shoulder_rotation' ? 'guidance' : 'scored')
}

function progress(exercise: ExerciseSessionResult | undefined, mode: EvaluationMode): number | null {
  if (!exercise) return null
  if (mode === 'guidance') return exercise.completed && finite(exercise.targetValue) ? exercise.targetValue : null
  if (exercise.targetType === 'cycles') return Math.floor(exercise.repetitions.length / 2)
  return exercise.repetitions.length
}

function exerciseCompleted(
  session: TrainingSessionState,
  exerciseId: ExerciseId,
  exercise: ExerciseSessionResult | undefined,
  value: number | null,
): ExerciseReportSummary['completion'] {
  if (!exercise) return 'unavailable'
  if (session.courseStatus === 'completed') return 'completed'
  if (exercise.completed) return 'completed'
  const index = session.exerciseOrder.indexOf(exerciseId)
  const activeIndex = session.exerciseOrder.indexOf(session.activeExerciseId)
  if (index >= 0 && activeIndex >= 0 && index < activeIndex) return 'completed'
  if (value !== null && finite(exercise.targetValue) && value >= exercise.targetValue) return 'completed'
  return 'incomplete'
}

function summaryText(summary: Pick<ExerciseReportSummary, 'evaluationMode' | 'completion' | 'score' | 'topIssues'>): string {
  if (summary.evaluationMode === 'guidance') {
    return summary.completion === 'completed'
      ? '本次已完成肩部环绕引导；该动作不参与课程数值总分。'
      : '本次没有完整的肩部环绕引导记录；该动作不参与课程数值总分。'
  }
  if (summary.score === null) return '本次没有可用的已保存计分动作记录。'
  if (summary.topIssues[0]) return `本次主要记录到：${summary.topIssues[0].reportLabel}。`
  if (summary.score >= 90) return '本次已保存的动作评分表现稳定。'
  if (summary.score >= 75) return '本次已保存的动作评分整体良好。'
  return '建议结合本次已记录指标和纠错信息继续调整。'
}

function buildExerciseSummary(
  session: TrainingSessionState,
  exerciseId: ExerciseId,
  issues: ReadonlyArray<ReportIssue>,
): ExerciseReportSummary {
  const exercise = session.exercises.find((item) => item.exerciseId === exerciseId)
  const presentation = REPORT_EXERCISE_PRESENTATION[exerciseId]
  const mode = evaluationMode(exerciseId, exercise)
  const currentProgress = progress(exercise, mode)
  const topIssues = issues.filter((issue) => issue.exerciseId === exerciseId).slice(0, 3)
  const completion = exerciseCompleted(session, exerciseId, exercise, currentProgress)
  const metrics = presentation.metricKeys.map(({ key, label }) => ({
    key,
    label,
    value: finite(exercise?.metricAverages[key]) ? Math.round(exercise.metricAverages[key]) : null,
  }))
  const score = mode === 'scored' && exercise?.repetitions.length && finite(exercise.overallScore)
    ? Math.round(exercise.overallScore)
    : null
  const targetType: CourseTargetType | null = exercise?.targetType ?? null
  const result: ExerciseReportSummary = {
    exerciseId,
    name: presentation.name,
    evaluationMode: mode,
    completion,
    progress: currentProgress,
    target: finite(exercise?.targetValue) ? exercise.targetValue : null,
    targetType,
    score,
    metrics,
    repCount: exercise ? exercise.repetitions.length : null,
    cycleCount: exercise?.targetType === 'cycles' ? Math.floor(exercise.repetitions.length / 2) : null,
    durationMs: exercise && finite(exercise.endedAt) ? Math.max(0, exercise.endedAt - exercise.startedAt) : null,
    topIssues,
    summaryText: '',
  }
  result.summaryText = summaryText(result)
  return result
}

export class TrainingReportBuilder {
  build(session: TrainingSessionState): TrainingReportData {
    const allIssues = aggregateConfirmedIssues(session.exercises)
    const exerciseSummaries = session.exerciseOrder.map((exerciseId) => buildExerciseSummary(session, exerciseId, allIssues))
    const guidanceExercises = exerciseSummaries.filter((item) => item.evaluationMode === 'guidance')
    const scoredExercises = exerciseSummaries.filter((item) => item.evaluationMode === 'scored')
    const courseStatus = session.courseStatus === 'completed' ? 'completed' : 'incomplete'
    const completedCount = courseStatus === 'completed'
      ? session.exerciseOrder.length
      : exerciseSummaries.filter((item) => item.completion === 'completed').length
    const completedScored = scoredExercises.filter((item) => item.completion === 'completed' && item.score !== null)

    let overallScore: number | null = null
    let overallScoreScope: TrainingReportData['overallScoreScope'] = 'unavailable'
    let scoreSource: TrainingReportData['metadata']['scoreSource'] = 'unavailable'
    let overallScoreDescription = '当前没有足够的已保存计分结果。'
    if (courseStatus === 'completed') {
      overallScore = finite(session.courseOverallScore) ? Math.round(session.courseOverallScore) : mean(scoredExercises.flatMap((item) => item.score === null ? [] : [item.score]))
      overallScoreScope = overallScore === null ? 'unavailable' : 'complete_course'
      scoreSource = finite(session.courseOverallScore) ? 'session' : overallScore === null ? 'unavailable' : 'derived_from_saved_exercise_results'
      if (overallScore !== null) overallScoreDescription = '完整课程总评；肩部环绕引导不参与数值计算。'
    } else {
      overallScore = mean(completedScored.map((item) => item.score as number))
      overallScoreScope = overallScore === null ? 'unavailable' : 'completed_scored_average'
      scoreSource = overallScore === null ? 'unavailable' : 'derived_from_saved_exercise_results'
      overallScoreDescription = overallScore === null
        ? '课程未完成，当前没有已完成的计分动作。'
        : `已完成动作平均分；基于当前已完成的 ${completedScored.length} 个计分动作。`
    }

    const capabilitySummary = aggregateCapabilities(scoredExercises)
    const topIssues = allIssues.slice(0, 3)
    const scoreCopy = scorePresentation(overallScore)
    return {
      reportVersion: TRAINING_REPORT_VERSION,
      sessionId: session.id,
      courseId: session.courseId ?? null,
      courseName: session.courseId ? REPORT_COURSE_NAME : '训练记录',
      courseVersion: session.courseVersion ?? null,
      courseStatus,
      startedAt: session.startedAt,
      endedAt: finite(session.endedAt) ? session.endedAt : null,
      durationMs: finite(session.totalDurationMs) ? session.totalDurationMs : finite(session.endedAt) ? Math.max(0, session.endedAt - session.startedAt) : null,
      completion: {
        status: courseStatus === 'completed' ? 'complete' : 'incomplete',
        completed: completedCount,
        total: session.exerciseOrder.length,
        label: courseStatus === 'completed' ? '训练完成' : '训练未完成',
      },
      overallScore,
      overallScoreLabel: courseStatus === 'incomplete' && overallScore !== null ? '已完成动作平均分' : scoreCopy.label,
      overallScoreScope,
      overallScoreDescription,
      guidanceExercises,
      scoredExercises,
      exerciseSummaries,
      capabilitySummary,
      topIssues,
      recommendations: buildRecommendations(topIssues, capabilitySummary, scoredExercises),
      feedbackCount: finite(session.totalFeedbackCount)
        ? session.totalFeedbackCount
        : session.exercises.reduce((sum, item) => sum + item.feedbackEvents.length, 0),
      metadata: {
        sourceSessionSchemaVersion: session.schemaVersion,
        captureSource: session.source,
        scoreSource,
        confirmedIssueCount: allIssues.reduce((sum, issue) => sum + issue.count, 0),
      },
    }
  }
}

export function buildTrainingReport(session: TrainingSessionState): TrainingReportData {
  return new TrainingReportBuilder().build(session)
}
