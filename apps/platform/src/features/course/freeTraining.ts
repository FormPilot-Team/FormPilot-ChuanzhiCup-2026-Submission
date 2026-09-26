import type { ExerciseId } from '../exercises/types'
import { ELECTRONIC_COACH_COURSE_V1, type CourseDefinition } from './CourseDefinition'

/**
 * Free training runs one step of the standard course through the same CourseController flow (preparation, start
 * gesture, countdown, voice), so its target and evaluation mode are exactly the course step's. The session records
 * that single exercise as its exercise order, which analysis-v1 treats as NOT_COURSE_FLOW.
 */
export function createFreeTrainingCourse(exerciseId: ExerciseId): Readonly<CourseDefinition> {
  const step = ELECTRONIC_COACH_COURSE_V1.steps.find((item) => item.exerciseId === exerciseId)
  if (!step) throw new Error(`Exercise is not a course step: ${exerciseId}`)
  return Object.freeze({ ...ELECTRONIC_COACH_COURSE_V1, steps: Object.freeze([step]) })
}
