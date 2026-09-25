import { ELECTRONIC_COACH_COURSE_V1 } from '../course/CourseDefinition'
import type { TrainingSessionState } from '../training/types'
import { ANALYSIS_CONFIG_V1 } from './config'
import { buildCapabilityModel } from './capabilityModelV2'
import { compareScore, isFullCourseScope, SCORED_EXERCISE_IDS, selectPreviousComparable } from './comparison'
import { buildDataQuality } from './dataQuality'
import { analyzeExercise } from './exerciseAnalysis'
import { buildNextFocus } from './nextFocus'
import { rankPriorityIssues } from './priorityRanking'
import { assessRulesSupport, resolveAnalysisMode } from './rulesSupport'
import { selectStrengths } from './strengths'
import { buildSummary } from './summary'
import type { TrainingAnalysis } from './types'
import { analyzeWithinSession } from './withinSession'

export const ANALYSIS_VERSION = 'analysis-v1' as const

function meanRounded(values: readonly number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}
export function analyzeTraining(
  current: TrainingSessionState,
  history: readonly TrainingSessionState[],
): TrainingAnalysis {
  const rules = assessRulesSupport(current)
  const mode = resolveAnalysisMode(current)
  const comparison = selectPreviousComparable(current, history)
  const previous = comparison.previousSessionId === null
    ? null
    : history.find((item) => item.id === comparison.previousSessionId) ?? null
  const exercises = ELECTRONIC_COACH_COURSE_V1.steps.map((step) => {
    const currentExercise = current.exercises.find((item) => item.exerciseId === step.exerciseId) ?? null
    const previousExercise = previous && comparison.commonExerciseIds.includes(step.exerciseId)
      ? previous.exercises.find((item) => item.exerciseId === step.exerciseId) ?? null
      : null
    return analyzeExercise(step.exerciseId, currentExercise, previousExercise)
  })
  const fullScope = isFullCourseScope(current)
  const scored = SCORED_EXERCISE_IDS.map((id) => exercises.find((item) => item.exerciseId === id)?.score ?? null)
  const overallScore = fullScope && scored.every((score): score is number => score !== null) ? meanRounded(scored) : null
  const previousScores = previous && comparison.level === 'FULL'
    ? SCORED_EXERCISE_IDS.map((id) => {
        const exercise = previous.exercises.find((item) => item.exerciseId === id) ?? null
        return analyzeExercise(id, exercise, null).score
      })
    : []
  const previousOverallScore = comparison.overallComparable
    && previousScores.length === SCORED_EXERCISE_IDS.length
    && previousScores.every((score): score is number => score !== null)
    ? meanRounded(previousScores)
    : null
  const withinSession = current.exercises.flatMap((exercise) => analyzeWithinSession(exercise))
  const issues = exercises.flatMap((exercise) => exercise.issues)
  const priorityIssues = rankPriorityIssues(issues, withinSession)
  const capabilities = buildCapabilityModel(current, comparison.level === 'NONE' ? null : previous)
  const strengths = selectStrengths(capabilities, exercises)
  const nextFocus = buildNextFocus(priorityIssues, capabilities)
  const overallTrend = overallScore !== null && previousOverallScore !== null
    ? compareScore(overallScore, previousOverallScore, ANALYSIS_CONFIG_V1.overallScoreDeadband) : null
  const summary = buildSummary({ overallScore, overallTrend, priorityIssues, strengths, withinSession })
  const dataQuality = buildDataQuality(current, comparison)
  return {
    version: ANALYSIS_VERSION,
    sessionId: current.id,
    sourceStartedAt: current.startedAt,
    rules,
    mode,
    comparison,
    scope: fullScope ? 'FULL_COURSE' : 'PARTIAL_COURSE',
    exercises,
    overallScore,
    overallScoreUnavailableReason: overallScore === null ? 'INCOMPLETE_SCOPE' : null,
    previousOverallScore,
    overallDelta: overallScore !== null && previousOverallScore !== null ? overallScore - previousOverallScore : null,
    overallTrend,
    issues,
    priorityIssues,
    capabilities,
    withinSession,
    strengths,
    nextFocus,
    summary,
    dataQuality,
  }
}
