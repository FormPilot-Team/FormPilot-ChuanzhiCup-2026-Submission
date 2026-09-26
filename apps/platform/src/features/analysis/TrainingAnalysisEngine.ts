import { ELECTRONIC_COACH_COURSE_V1 } from '../course/CourseDefinition'
import type { TrainingSessionState } from '../training/types'
import { buildCapability } from './capability'
import { selectPreviousComparable } from './comparison'
import { ANALYSIS_CONFIG_V1 } from './config'
import { guidanceText } from './copy'
import { buildDataQuality } from './dataQuality'
import { analyzeExercise } from './exerciseAnalysis'
import { buildImprovements, selectStrengths } from './findings'
import { buildNextFocus } from './nextFocus'
import { rankPriorityIssues } from './priorityRanking'
import { meanRounded, scoreTrend } from './ratio'
import { resolveSource } from './rulesSupport'
import { buildSessionFacts, type SessionFacts } from './sessionFacts'
import { buildSummary } from './summary'
import type { Overall, TrainingAnalysis } from './types'

export const ANALYSIS_VERSION = 'analysis-v1' as const

function overallScore(facts: SessionFacts): Pick<Overall, 'scope' | 'score' | 'scoredExerciseCount'> {
  if (facts.fullScope) {
    return { scope: 'FULL_COURSE', score: meanRounded(facts.exercises.map((item) => item.score as number)), scoredExerciseCount: facts.exercises.length }
  }
  // A complete course with an unscorable exercise gets no overall score at all (never a partial average).
  if (facts.courseComplete) return { scope: 'UNAVAILABLE', score: null, scoredExerciseCount: 0 }
  const scored = facts.exercises.filter((item) => item.completion.status === 'completed' && item.score !== null)
  if (!scored.length) return { scope: 'UNAVAILABLE', score: null, scoredExerciseCount: 0 }
  return { scope: 'COMPLETED_EXERCISES', score: meanRounded(scored.map((item) => item.score as number)), scoredExerciseCount: scored.length }
}

/**
 * analysis-v1: pure and deterministic. Never persists, never mutates its inputs, never reads stored aggregates
 * (overallScore, metricAverages, topErrors, courseOverallScore, topRecurringErrors, totalFeedbackCount).
 */
export function analyzeTraining(current: TrainingSessionState, history: readonly TrainingSessionState[]): TrainingAnalysis {
  const facts = buildSessionFacts(current)
  const rulesSupported = facts.rulesSupport !== 'UNSUPPORTED'
  const { comparison, previous } = selectPreviousComparable(facts, history)
  const common = new Set(comparison.commonExerciseIds)

  const exercises = facts.exercises.map((item, index) => analyzeExercise(
    item,
    previous && common.has(item.exerciseId) ? previous.exercises[index] : null,
    rulesSupported,
  ))

  const own = overallScore(facts)
  const previousOverall = comparison.level === 'FULL' && previous ? overallScore(previous) : null
  const comparableOverall = own.scope === 'FULL_COURSE' && own.score !== null && previousOverall?.scope === 'FULL_COURSE' && previousOverall.score !== null
  const overall: Overall = {
    ...own,
    completedExercises: facts.completedExercises,
    totalExercises: 6,
    previousScore: comparableOverall ? previousOverall.score : null,
    delta: comparableOverall ? (own.score as number) - (previousOverall.score as number) : null,
    trend: comparableOverall ? scoreTrend(own.score as number, previousOverall.score as number, ANALYSIS_CONFIG_V1.deadband.overall) : null,
  }

  const capability = buildCapability(facts, previous, comparison.commonExerciseIds, rulesSupported)
  const issues = exercises.flatMap((item) => item.issues)
  const priorityIssues = rulesSupported ? rankPriorityIssues(issues) : []
  const improvements = rulesSupported ? buildImprovements(exercises, overall) : []
  const strengths = rulesSupported ? selectStrengths({ exercises, capability, improvements }) : []
  const nextFocus = rulesSupported ? buildNextFocus(priorityIssues, capability, exercises) : []
  const summary = buildSummary({
    overall, comparison, courseComplete: facts.courseComplete, rulesSupport: facts.rulesSupport,
    exercises, improvements, priorityIssues, strengths,
  })
  const guidanceStep = ELECTRONIC_COACH_COURSE_V1.steps.find((step) => step.exerciseId === 'shoulder_rotation')

  return {
    analysisVersion: ANALYSIS_VERSION,
    sessionId: current.id,
    sessionStartedAt: current.startedAt,
    source: resolveSource(current),
    mode: facts.mode,
    rulesVersion: current.rulesVersion ? { spec: current.rulesVersion.spec, threshold: current.rulesVersion.threshold } : null,
    courseComplete: facts.courseComplete,
    comparison,
    overall,
    exercises,
    guidance: {
      exerciseId: 'shoulder_rotation',
      status: facts.guidanceStatus,
      targetSeconds: guidanceStep?.target.value ?? 0,
      text: guidanceText(facts.guidanceStatus),
    },
    capability,
    priorityIssues,
    improvements,
    strengths,
    nextFocus,
    summary,
    dataQuality: buildDataQuality({ facts, exercises, comparison, capability }),
  }
}
