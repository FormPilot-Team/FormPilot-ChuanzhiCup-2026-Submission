import type { CourseState } from '../course/CourseController'

export type TrainingExitPhase = 'preparing' | 'active' | 'complete'

type SessionStatus = 'ready' | 'active' | 'paused' | 'completed'

const FINISHED: ReadonlySet<CourseState> = new Set(['COURSE_COMPLETE', 'COURSE_INCOMPLETE'])

/**
 * 热身训练. Still preparing until the first exercise leaves PREPARING (the camera may already be on); a later
 * exercise waiting in PREPARING is mid-course, so leaving it asks first.
 */
export function warmUpExitPhase(input: { sessionStatus: SessionStatus; courseState: CourseState; exerciseIndex: number }): TrainingExitPhase {
  if (input.sessionStatus === 'completed' || FINISHED.has(input.courseState)) return 'complete'
  if (input.sessionStatus === 'ready') return 'preparing'
  return input.courseState === 'PREPARING' && input.exerciseIndex === 0 ? 'preparing' : 'active'
}

/** 跟练. The standard video has not started while the course is PREPARING; TRANSITION is the end of the routine. */
export function routineExitPhase(input: { sessionStatus: SessionStatus; courseState: CourseState }): TrainingExitPhase {
  if (input.sessionStatus === 'completed' || input.courseState === 'TRANSITION' || FINISHED.has(input.courseState)) return 'complete'
  if (input.sessionStatus === 'ready' || input.courseState === 'PREPARING') return 'preparing'
  return 'active'
}
