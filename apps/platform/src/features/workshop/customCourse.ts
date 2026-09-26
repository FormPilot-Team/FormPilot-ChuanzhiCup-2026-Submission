import type { CourseSnapshot, CourseTimeline } from '../course/CourseController'
import type { VoiceGuideEvent } from '../voice/VoiceGuidePolicy'
import { PROFILE_OPTIONS } from './catalog'
import { goalText } from './definition'
import type { CustomActionDefinition } from './types'

/**
 * A custom action runs as a one-step course in the shared CourseController, like a follow-along routine: preparation,
 * the start gesture, the countdown, pausing and manual end behave as everywhere else. Progress is the recognizer's
 * count (repetitions, or whole seconds held).
 */
export interface CustomCourseStep {
  target: number
  unit: '次' | '秒'
}

export function createCustomCourse(action: CustomActionDefinition, fast = false): CourseTimeline<CustomCourseStep> {
  const step: CustomCourseStep = action.goal.type === 'reps' ? { target: action.goal.target, unit: '次' } : { target: action.goal.seconds, unit: '秒' }
  return { countdownSeconds: fast ? 0.1 : 3, transitionMs: fast ? 300 : 1200, steps: [step] }
}

export function customPreparationVoice(action: CustomActionDefinition): string {
  return `接下来练习${action.name}，目标${goalText(action.goal)}。请让${PROFILE_OPTIONS[action.recognition.profile].framing}完整入镜，然后双手在胸前合拢，开始训练。`
}

const COUNTDOWN_TEXT: Readonly<Record<number, string>> = { 3: '三', 2: '二', 1: '一' }

export function deriveCustomVoiceEvents(before: CourseSnapshot | undefined, after: CourseSnapshot, action: CustomActionDefinition, at: number): VoiceGuideEvent[] {
  const events: VoiceGuideEvent[] = []
  if (!before && after.state === 'PREPARING') events.push({ kind: 'preparation', text: customPreparationVoice(action), at })
  if (after.state === 'COUNTDOWN' && (before?.state !== 'COUNTDOWN' || before.countdown !== after.countdown) && COUNTDOWN_TEXT[after.countdown]) {
    events.push({ kind: 'countdown', text: COUNTDOWN_TEXT[after.countdown], at })
  }
  if (after.state === 'ACTIVE' && before?.state !== 'ACTIVE' && before?.state !== 'PAUSED') {
    events.push({ kind: 'start', text: action.goal.type === 'duration' ? '开始，做到完成姿势并保持住。' : '开始，做到完成姿势再回来。', at })
  }
  if (after.state === 'COURSE_COMPLETE' && before?.state !== 'COURSE_COMPLETE') {
    events.push({ kind: 'course_complete', text: `${action.name}完成，可以查看训练报告。`, at })
  }
  return events
}

/** Short spoken milestones: halfway and the last repetition (reps goals only). */
export function milestoneText(done: number, target: number, unit: '次' | '秒'): string | null {
  if (unit !== '次' || target < 4) return null
  if (done === Math.ceil(target / 2) && done < target) return '完成一半了，保持节奏。'
  if (done === target - 1) return '最后一次。'
  return null
}
