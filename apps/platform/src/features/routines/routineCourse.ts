import type { CourseSnapshot, CourseTimeline } from '../course/CourseController'
import type { VoiceGuideEvent } from '../voice/VoiceGuidePolicy'
import { scopeBounds, scopeChapters, chapterDisplayName, type ScopeBounds } from './scope'
import type { RoutineProgram, RoutineScope } from './types'

/** 跟练作为单步课程运行在公共 CourseController 上；进度取标准视频在范围内的位置，由视频而不是动作决定节奏 */
export interface RoutineCourseStep extends ScopeBounds {
  scope: RoutineScope
}

/** 视频结束时刻不精确到帧，离结尾这么近即算完成 */
export const ROUTINE_END_TOLERANCE_SECONDS = 0.3

export function createRoutineCourse(program: RoutineProgram, scope: RoutineScope, fast = false): CourseTimeline<RoutineCourseStep> {
  return {
    countdownSeconds: fast ? 0.1 : 3,
    transitionMs: fast ? 300 : 1500,
    steps: [{ scope, ...scopeBounds(program, scope) }],
  }
}

export function routineCourseProgress(step: RoutineCourseStep, videoSeconds: number): { progress: number; target: number } {
  const target = Math.max(0.5, step.endSeconds - step.startSeconds - ROUTINE_END_TOLERANCE_SECONDS)
  return { progress: Math.max(0, videoSeconds - step.startSeconds), target }
}

const COUNTDOWN_TEXT: Readonly<Record<number, string>> = { 3: '三', 2: '二', 1: '一' }

export function routinePreparationVoice(program: RoutineProgram, scope: RoutineScope): string {
  const what = scope.kind === 'full' ? `${program.title}整套跟练` : `${program.title}，${chapterDisplayName(scopeChapters(program, scope)[0])}`
  return `接下来是${what}。请后退一些，确保全身完整入镜，然后双手在胸前合拢，开始跟练。`
}

/** 课程状态变化的语音事件；章节切换不播报，标准视频自带口令 */
export function deriveRoutineVoiceEvents(
  before: CourseSnapshot | undefined,
  after: CourseSnapshot,
  program: RoutineProgram,
  scope: RoutineScope,
  at: number,
): VoiceGuideEvent[] {
  const events: VoiceGuideEvent[] = []
  if (!before && after.state === 'PREPARING') events.push({ kind: 'preparation', text: routinePreparationVoice(program, scope), at })
  if (after.state === 'COUNTDOWN' && (before?.state !== 'COUNTDOWN' || before.countdown !== after.countdown) && COUNTDOWN_TEXT[after.countdown]) {
    events.push({ kind: 'countdown', text: COUNTDOWN_TEXT[after.countdown], at })
  }
  if (after.state === 'ACTIVE' && before?.state !== 'ACTIVE' && before?.state !== 'PAUSED') {
    events.push({ kind: 'start', text: '开始，跟着视频一起练。', at })
  }
  if (after.state === 'COURSE_COMPLETE' && before?.state !== 'COURSE_COMPLETE') {
    events.push({ kind: 'course_complete', text: '本次跟练完成，可以查看跟练报告。', at })
  }
  return events
}
