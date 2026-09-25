import type { CourseState } from '../course/CourseController'

export function shouldShowPoseOverlay(courseState?: CourseState): boolean {
  if (courseState === undefined) return true
  return courseState === 'PREPARING' || courseState === 'COUNTDOWN'
}
