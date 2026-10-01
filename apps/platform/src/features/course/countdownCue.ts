import type { CourseSnapshot } from './CourseController'

/** How long “开始” stays on the camera after the countdown reaches zero. */
export const COUNTDOWN_GO_MS = 900

/**
 * The large step shown for a course moment: 3 → 2 → 1 while counting down, then 开始 for a moment once the course turns
 * ACTIVE straight out of the countdown. Never shown in any other state (preparing, paused, a resumed course).
 */
export function countdownCue(course: Pick<CourseSnapshot, 'state' | 'countdown'> | undefined, justStarted: boolean): string | null {
  if (!course) return null
  if (course.state === 'COUNTDOWN') return String(Math.max(1, Math.ceil(course.countdown)))
  if (course.state === 'ACTIVE' && justStarted) return '开始'
  return null
}
