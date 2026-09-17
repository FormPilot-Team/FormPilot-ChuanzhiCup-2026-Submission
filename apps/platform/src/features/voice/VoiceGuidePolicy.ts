import type { CourseSnapshot } from '../course/CourseController'
import type { ExerciseId, MotionErrorCode } from '../exercises/types'

export type VoicePriority = 1 | 2 | 3 | 4 | 5
export type VoiceGuideEventKind =
  | 'preparation'
  | 'countdown'
  | 'start'
  | 'confirmed_correction'
  | 'recovery_positive'
  | 'pose_lost'
  | 'transition'
  | 'course_complete'
  | 'pause'
  | 'exercise_switch'
  | 'manual_end'
  | 'mute'

export interface VoiceGuideEvent {
  kind: VoiceGuideEventKind
  text?: string
  at: number
  id?: string
  code?: MotionErrorCode
}

export interface VoiceGuideContext {
  muted: boolean
  available: boolean
  paused: boolean
  currentPriority?: VoicePriority
}

export type VoiceGuideCommand =
  | { kind: 'speak'; text: string; priority: VoicePriority; interrupt: boolean }
  | { kind: 'cancel' }
  | { kind: 'drop' }

export interface VoiceCourseExercise {
  id: ExerciseId
  name: string
}

const EVENT_PRIORITY: Record<Exclude<VoiceGuideEventKind, 'pause' | 'exercise_switch' | 'manual_end' | 'mute'>, VoicePriority> = {
  pose_lost: 1,
  course_complete: 1,
  start: 2,
  preparation: 2,
  transition: 2,
  confirmed_correction: 3,
  countdown: 4,
  recovery_positive: 5,
}

const POSE_QUALITY_CODES: ReadonlySet<MotionErrorCode> = new Set(['BODY_OUT_OF_FRAME', 'POSE_LOW_CONFIDENCE'])
const COUNTDOWN_TEXT: Record<number, string> = { 3: '三', 2: '二', 1: '一' }

export function preparationVoice(exercise: VoiceCourseExercise): string {
  const messages: Record<ExerciseId, string> = {
    shoulder_rotation: '接下来进行肩部环绕，请确保上半身和髋部完整入镜。',
    overhead_raise: '接下来进行双臂上举，请保持上半身和髋部入镜，双臂自然下垂。',
    lateral_raise: '接下来进行侧平举，请保持上半身和髋部入镜，双臂自然下垂。',
    step_jack: '下一项侧步开合，请后退一些，确保全身完整入镜。',
    squat: '接下来进行徒手深蹲，请后退一些，确保全身完整入镜。',
    knee_raise: '接下来进行交替提膝，请后退一些，确保全身完整入镜。',
  }
  return messages[exercise.id]
}

export function deriveCourseVoiceEvents(
  before: CourseSnapshot | undefined,
  after: CourseSnapshot,
  exercises: ReadonlyArray<VoiceCourseExercise>,
  at: number,
): VoiceGuideEvent[] {
  const events: VoiceGuideEvent[] = []
  const current = exercises[after.stepIndex]
  if ((!before || before.stepIndex !== after.stepIndex) && current) {
    events.push({ kind: 'preparation', text: preparationVoice(current), at })
  }
  if (after.state === 'COUNTDOWN' && (before?.state !== 'COUNTDOWN' || before.countdown !== after.countdown) && COUNTDOWN_TEXT[after.countdown]) {
    events.push({ kind: 'countdown', text: COUNTDOWN_TEXT[after.countdown], at })
  }
  if (after.state === 'ACTIVE' && before?.state !== 'ACTIVE') {
    events.push({ kind: 'start', text: '开始。', at })
  }
  if (after.state === 'TRANSITION' && before?.state === 'ACTIVE') {
    const next = exercises[after.stepIndex + 1]
    if (current && next) events.push({ kind: 'transition', text: `${current.name}完成，下一项${next.name}。`, at })
  }
  if (after.state === 'COURSE_COMPLETE' && before?.state !== 'COURSE_COMPLETE') {
    events.push({ kind: 'course_complete', text: '本次训练完成，可以查看训练报告。', at })
  }
  return events
}

export class VoiceGuidePolicy {
  private lastFeedbackId?: string
  private framingEpisodeActive = false
  private poseLostEpisode = false
  private poseLostArmed = true
  private poseAvailableSince?: number
  private lastPoseLostAt = Number.NEGATIVE_INFINITY

  handle(event: VoiceGuideEvent, context: VoiceGuideContext): VoiceGuideCommand {
    if (event.kind === 'pause' || event.kind === 'exercise_switch' || event.kind === 'manual_end' || event.kind === 'mute') {
      return { kind: 'cancel' }
    }
    if (context.muted || !context.available || context.paused || !event.text) return { kind: 'drop' }
    if (event.id && event.id === this.lastFeedbackId) return { kind: 'drop' }

    if (event.kind === 'confirmed_correction' && event.code && POSE_QUALITY_CODES.has(event.code)) {
      if (this.framingEpisodeActive) return { kind: 'drop' }
      this.framingEpisodeActive = true
    } else if (event.kind === 'recovery_positive' && event.code && POSE_QUALITY_CODES.has(event.code)) {
      this.framingEpisodeActive = false
      if (event.id) this.lastFeedbackId = event.id
      return { kind: 'drop' }
    }

    if (event.id) this.lastFeedbackId = event.id
    const priority = EVENT_PRIORITY[event.kind]
    const current = context.currentPriority
    if (current !== undefined) {
      if (priority > current) return { kind: 'drop' }
      if (priority === current && priority >= 4) return { kind: 'drop' }
    }
    return { kind: 'speak', text: event.text, priority, interrupt: current !== undefined }
  }

  onPoseAvailability(available: boolean, at: number, context: VoiceGuideContext): VoiceGuideCommand {
    if (available) {
      this.poseLostEpisode = false
      this.poseAvailableSince ??= at
      if (!this.poseLostArmed && at - this.poseAvailableSince >= 1000) this.poseLostArmed = true
      return { kind: 'drop' }
    }

    this.poseAvailableSince = undefined
    if (this.poseLostEpisode) return { kind: 'drop' }
    this.poseLostEpisode = true
    if (!this.poseLostArmed || at - this.lastPoseLostAt < 8000) return { kind: 'drop' }
    this.poseLostArmed = false
    this.lastPoseLostAt = at
    return this.handle({ kind: 'pose_lost', text: '请回到画面中。', at }, context)
  }
}
