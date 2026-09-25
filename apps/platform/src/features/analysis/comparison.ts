import { ELECTRONIC_COACH_COURSE_V1 } from '../course/CourseDefinition'
import type { ExerciseId } from '../exercises/types'
import type { TrainingSessionState } from '../training/types'
import { ANALYSIS_CONFIG_V1 } from './config'
import { analyzedRepetitions } from './repetitionValidity'
import { assessRulesSupport, resolveAnalysisMode, sameRulesVersion } from './rulesSupport'
import type { ComparisonSelection, ScoreTrend } from './types'

export const SCORED_EXERCISE_IDS: readonly ExerciseId[] = Object.freeze(
  ELECTRONIC_COACH_COURSE_V1.steps.filter((step) => step.evaluationMode === 'scored').map((step) => step.exerciseId),
)

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function scoredExerciseIds(session: TrainingSessionState): ExerciseId[] {
  return SCORED_EXERCISE_IDS.filter((id) => {
    const exercise = session.exercises.find((item) => item.exerciseId === id)
    return Boolean(exercise && analyzedRepetitions(exercise).length >= ANALYSIS_CONFIG_V1.minScoredReps)
  })
}

export function isFinalized(session: TrainingSessionState): boolean {
  return session.status === 'completed' && typeof session.endedAt === 'number' && Number.isFinite(session.endedAt)
}

export function isNormalCourseFlow(session: TrainingSessionState): boolean {
  const expectedOrder = ELECTRONIC_COACH_COURSE_V1.steps.map((step) => step.exerciseId)
  return session.courseId === ELECTRONIC_COACH_COURSE_V1.id
    && session.courseVersion === ELECTRONIC_COACH_COURSE_V1.version
    && session.exerciseOrder.length === expectedOrder.length
    && expectedOrder.every((id, index) => session.exerciseOrder[index] === id)
}

export function isFullCourseScope(session: TrainingSessionState): boolean {
  return isFinalized(session)
    && session.courseStatus === 'completed'
    && isNormalCourseFlow(session)
    && SCORED_EXERCISE_IDS.every((id) => scoredExerciseIds(session).includes(id))
}

function baseComparable(current: TrainingSessionState, candidate: TrainingSessionState): boolean {
  return candidate.id !== current.id
    && candidate.source === 'live'
    && resolveAnalysisMode(candidate) === 'normal'
    && assessRulesSupport(candidate).support === 'SUPPORTED'
    && sameRulesVersion(current, candidate)
    && isFinalized(candidate)
    && isNormalCourseFlow(candidate)
    && candidate.startedAt < current.startedAt
    && candidate.courseId === current.courseId
    && candidate.courseVersion === current.courseVersion
}

export function selectPreviousComparable(current: TrainingSessionState, history: readonly TrainingSessionState[]): ComparisonSelection {
  if (current.source !== 'live') return none('CURRENT_NON_LIVE')
  const mode = resolveAnalysisMode(current)
  if (mode !== 'normal') return none('CURRENT_MODE_NOT_NORMAL')
  const rules = assessRulesSupport(current)
  if (rules.support === 'LEGACY_UNVERSIONED') return none('CURRENT_RULES_LEGACY')
  if (rules.support === 'UNSUPPORTED') return none('CURRENT_RULES_UNSUPPORTED')
  if (!isFinalized(current)) return none('CURRENT_NOT_FINALIZED')
  if (!history.some((item) => item.id !== current.id)) return none('NO_HISTORY')

  const currentIds = scoredExerciseIds(current)
  const candidates = history.filter((item) => baseComparable(current, item)).slice().sort((left, right) =>
    right.startedAt - left.startedAt || codeUnitCompare(left.id, right.id))
  if (candidates.length === 0) return none('NO_COMPATIBLE_HISTORY')

  for (const candidate of candidates) {
    const common = currentIds.filter((id) => scoredExerciseIds(candidate).includes(id))
    if (isFullCourseScope(current) && isFullCourseScope(candidate) && common.length === SCORED_EXERCISE_IDS.length) {
      return selected('FULL', candidate, common, true)
    }
  }
  for (const candidate of candidates) {
    const common = currentIds.filter((id) => scoredExerciseIds(candidate).includes(id))
    if (common.length >= ANALYSIS_CONFIG_V1.partialComparisonMinCommonExercises) return selected('PARTIAL', candidate, common, false)
  }
  return none('INSUFFICIENT_COMMON_EXERCISES')
}

function none(reason: Exclude<ComparisonSelection['unavailableReason'], null>): ComparisonSelection {
  return { level: 'NONE', previousSessionId: null, previousStartedAt: null, commonExerciseIds: [], overallComparable: false, unavailableReason: reason }
}

function selected(level: 'FULL' | 'PARTIAL', session: TrainingSessionState, common: ExerciseId[], overall: boolean): ComparisonSelection {
  return { level, previousSessionId: session.id, previousStartedAt: session.startedAt, commonExerciseIds: common, overallComparable: overall, unavailableReason: null }
}

export function compareScore(current: number, previous: number, deadband: number): ScoreTrend {
  const delta = current - previous
  return delta >= deadband ? 'IMPROVED' : delta <= -deadband ? 'REGRESSED' : 'STABLE'
}
