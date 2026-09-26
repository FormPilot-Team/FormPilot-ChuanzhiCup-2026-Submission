import { isCourseFlow } from '../analysis/rulesSupport'
import { ELECTRONIC_COACH_COURSE_V1 } from '../course/CourseDefinition'
import type { ExerciseId } from '../exercises/types'
import { REPORT_EXERCISE_PRESENTATION } from '../report/presentation'
import type { TrainingSessionState } from './types'

/**
 * What kind of training a saved session was, for presentation only. It never feeds analysis: analysis-v1 already
 * treats every non-course exercise order as NOT_COURSE_FLOW (no FULL comparison, no long-term course trend).
 */
export type TrainingScope =
  | { kind: 'full_course' }
  | { kind: 'free_training'; exerciseId: ExerciseId }
  | { kind: 'other' }

const COURSE_EXERCISES: ReadonlySet<string> = new Set(ELECTRONIC_COACH_COURSE_V1.steps.map((step) => step.exerciseId))

export function resolveTrainingScope(session: TrainingSessionState): TrainingScope {
  if (isCourseFlow(session)) return { kind: 'full_course' }
  const order = Array.isArray(session.exerciseOrder) ? session.exerciseOrder : []
  if (order.length === 1 && COURSE_EXERCISES.has(order[0])) return { kind: 'free_training', exerciseId: order[0] }
  return { kind: 'other' }
}

export function freeTrainingLabel(exerciseId: ExerciseId): string {
  return `自由训练 · ${REPORT_EXERCISE_PRESENTATION[exerciseId].name}`
}
