import { describe, expect, it } from 'vitest'
import { selectChineseVoice } from '../src/adapters/speech/BrowserSpeechAdapter'
import type { CourseSnapshot } from '../src/features/course/CourseController'
import { deriveCourseVoiceEvents, VoiceGuidePolicy, type VoiceGuideContext, type VoiceGuideEvent, type VoicePriority } from '../src/features/voice/VoiceGuidePolicy'
import { EncouragementPolicy } from '../src/features/voice/EncouragementPolicy'

const exercises = [
  { id: 'shoulder_rotation', name: '肩部环绕' },
  { id: 'overhead_raise', name: '双臂上举' },
  { id: 'lateral_raise', name: '侧平举' },
  { id: 'step_jack', name: '侧步开合' },
  { id: 'squat', name: '徒手深蹲' },
  { id: 'knee_raise', name: '交替提膝' },
] as const

const context = (changes: Partial<VoiceGuideContext> = {}): VoiceGuideContext => ({
  muted: false,
  available: true,
  paused: false,
  ...changes,
})

const snapshot = (changes: Partial<CourseSnapshot> = {}): CourseSnapshot => ({
  state: 'PREPARING', stepIndex: 0, countdown: 3, elapsedMs: 0, transitionRemainingMs: 0, ...changes,
})

const event = (kind: VoiceGuideEvent['kind'], changes: Partial<VoiceGuideEvent> = {}): VoiceGuideEvent => ({
  kind, text: kind, at: 0, ...changes,
})

describe('VoiceGuidePolicy', () => {
  it('derives preparation from the initial course state', () => {
    expect(deriveCourseVoiceEvents(undefined, snapshot(), exercises, 0)).toEqual([
      expect.objectContaining({ kind: 'preparation', text: '接下来进行肩部环绕，请确保上半身和髋部完整入镜。' }),
    ])
  })

  it('derives countdown 3, 2, 1 only from CourseController countdown changes', () => {
    const texts = [3, 2, 1].flatMap((countdown, index) => deriveCourseVoiceEvents(
      snapshot({ state: index === 0 ? 'PREPARING' : 'COUNTDOWN', countdown: index === 0 ? 3 : countdown + 1 }),
      snapshot({ state: 'COUNTDOWN', countdown }), exercises, index * 1000,
    ).filter((item) => item.kind === 'countdown').map((item) => item.text))
    expect(texts).toEqual(['三', '二', '一'])
  })

  it('derives start from COUNTDOWN to ACTIVE', () => {
    expect(deriveCourseVoiceEvents(snapshot({ state: 'COUNTDOWN', countdown: 1 }), snapshot({ state: 'ACTIVE', countdown: 0 }), exercises, 3000))
      .toContainEqual(expect.objectContaining({ kind: 'start', text: '开始。' }))
  })

  it('derives transition and full-body preparation for the upper-to-lower switch', () => {
    const transition = deriveCourseVoiceEvents(snapshot({ state: 'ACTIVE', stepIndex: 2 }), snapshot({ state: 'TRANSITION', stepIndex: 2 }), exercises, 10)
    const preparation = deriveCourseVoiceEvents(snapshot({ state: 'TRANSITION', stepIndex: 2 }), snapshot({ state: 'PREPARING', stepIndex: 3 }), exercises, 20)
    expect(transition).toContainEqual(expect.objectContaining({ kind: 'transition', text: '侧平举完成，下一项侧步开合。' }))
    expect(preparation).toContainEqual(expect.objectContaining({ kind: 'preparation', text: '下一项侧步开合，请后退一些，确保全身完整入镜。' }))
  })

  it('derives course completion', () => {
    expect(deriveCourseVoiceEvents(snapshot({ state: 'TRANSITION', stepIndex: 5 }), snapshot({ state: 'COURSE_COMPLETE', stepIndex: 5 }), exercises, 10))
      .toContainEqual(expect.objectContaining({ kind: 'course_complete', text: '本次训练完成，可以查看训练报告。' }))
  })

  it('forwards a confirmed correction once by FeedbackPolicy event id', () => {
    const policy = new VoiceGuidePolicy()
    const correction = event('confirmed_correction', { id: 'feedback-1', text: '右臂再抬高一些。', code: 'ARM_TOO_LOW_R' })
    expect(policy.handle(correction, context())).toMatchObject({ kind: 'speak', text: '右臂再抬高一些。' })
    expect(policy.handle(correction, context())).toEqual({ kind: 'drop' })
  })

  it('keeps a real-action recovery positive at lowest priority', () => {
    const policy = new VoiceGuidePolicy()
    expect(policy.handle(event('recovery_positive', { id: 'recovery-1', text: '很好，保持这个高度。', code: 'ARM_TOO_LOW_R' }), context()))
      .toMatchObject({ kind: 'speak', priority: 5 })
  })

  it('deduplicates framing corrections and suppresses their generic recovery', () => {
    const policy = new VoiceGuidePolicy()
    expect(policy.handle(event('confirmed_correction', { id: 'frame-1', text: '请确保上半身和髋部完整入镜', code: 'BODY_OUT_OF_FRAME' }), context())).toMatchObject({ kind: 'speak' })
    expect(policy.handle(event('confirmed_correction', { id: 'frame-2', text: '请确保上半身和髋部完整入镜', code: 'POSE_LOW_CONFIDENCE' }), context())).toEqual({ kind: 'drop' })
    expect(policy.handle(event('recovery_positive', { id: 'frame-r', text: '很好，保持这个状态', code: 'BODY_OUT_OF_FRAME' }), context())).toEqual({ kind: 'drop' })
    expect(policy.handle(event('confirmed_correction', { id: 'frame-3', text: '请确保上半身和髋部完整入镜', code: 'BODY_OUT_OF_FRAME' }), context())).toMatchObject({ kind: 'speak' })
  })

  it('speaks Pose Lost once, rearms after one second of recovery, and enforces eight seconds between prompts', () => {
    const policy = new VoiceGuidePolicy()
    expect(policy.onPoseAvailability(false, 0, context())).toMatchObject({ kind: 'speak', text: '请回到画面中。' })
    expect(policy.onPoseAvailability(false, 5000, context())).toEqual({ kind: 'drop' })
    policy.onPoseAvailability(true, 6000, context())
    policy.onPoseAvailability(true, 6999, context())
    expect(policy.onPoseAvailability(false, 7000, context())).toEqual({ kind: 'drop' })
    policy.onPoseAvailability(true, 8000, context())
    policy.onPoseAvailability(true, 9000, context())
    expect(policy.onPoseAvailability(false, 9001, context())).toMatchObject({ kind: 'speak' })
  })

  it('drops countdown and recovery while any speech is active', () => {
    const policy = new VoiceGuidePolicy()
    expect(policy.handle(event('countdown'), context({ currentPriority: 2 }))).toEqual({ kind: 'drop' })
    expect(policy.handle(event('recovery_positive'), context({ currentPriority: 5 }))).toEqual({ kind: 'drop' })
  })

  it('lets higher-priority events interrupt and drops lower-priority events', () => {
    const policy = new VoiceGuidePolicy()
    expect(policy.handle(event('pose_lost'), context({ currentPriority: 3 }))).toMatchObject({ kind: 'speak', priority: 1, interrupt: true })
    expect(policy.handle(event('confirmed_correction'), context({ currentPriority: 2 }))).toEqual({ kind: 'drop' })
  })

  it.each(['mute', 'exercise_switch', 'manual_end'] as const)('%s cancels active speech', (kind) => {
    expect(new VoiceGuidePolicy().handle(event(kind), context())).toEqual({ kind: 'cancel' })
  })

  it('interrupts current speech with pause and speaks resume once unpaused', () => {
    const policy = new VoiceGuidePolicy()
    expect(policy.handle(event('pause', { text: '训练已暂停。' }), context({ paused: true, currentPriority: 5 }))).toMatchObject({
      kind: 'speak', event: 'pause', priority: 1, interrupt: true,
    })
    expect(policy.handle(event('resume', { text: '继续训练。' }), context())).toMatchObject({
      kind: 'speak', event: 'resume', priority: 1,
    })
  })

  it('drops speech while muted, paused, or unavailable without affecting policy callers', () => {
    const policy = new VoiceGuidePolicy()
    expect(policy.handle(event('start'), context({ muted: true }))).toEqual({ kind: 'drop' })
    expect(policy.handle(event('start'), context({ paused: true }))).toEqual({ kind: 'drop' })
    expect(policy.handle(event('start'), context({ available: false }))).toEqual({ kind: 'drop' })
  })

  it('prioritizes a local Chinese voice by language instead of a fixed voice name', () => {
    const voice = (name: string, lang: string, localService: boolean, isDefault = false) => ({ name, lang, localService, default: isDefault, voiceURI: name }) as SpeechSynthesisVoice
    const chosen = selectChineseVoice([
      voice('English Default', 'en-US', true, true),
      voice('Remote Chinese', 'zh-Hans', false),
      voice('Local Chinese', 'zh-CN', true),
    ])
    expect(chosen?.name).toBe('Local Chinese')
    expect(selectChineseVoice([voice('English Only', 'en-US', true)])).toBeUndefined()
  })

  it('uses the frozen priority numbers', () => {
    const policy = new VoiceGuidePolicy()
    const priorities = new Map<string, VoicePriority>()
    for (const kind of ['course_complete', 'start', 'confirmed_correction', 'countdown', 'recovery_positive'] as const) {
      const command = policy.handle(event(kind, { id: kind }), context())
      if (command.kind === 'speak') priorities.set(kind, command.priority)
    }
    expect(Object.fromEntries(priorities)).toEqual({ course_complete: 1, start: 2, confirmed_correction: 3, countdown: 4, recovery_positive: 5 })
  })
})

describe('EncouragementPolicy', () => {
  const input = (changes: Partial<Parameters<EncouragementPolicy['update']>[0]> = {}) => ({
    exerciseId: 'shoulder_rotation' as const,
    exerciseIndex: 0,
    courseState: 'ACTIVE' as const,
    poseValid: true,
    hasCorrection: false,
    hasRecovery: false,
    at: 0,
    ...changes,
  })

  it('speaks once after six continuously stable seconds per exercise', () => {
    const policy = new EncouragementPolicy()
    expect(policy.update(input())).toBeUndefined()
    expect(policy.update(input({ at: 5999 }))).toBeUndefined()
    expect(policy.update(input({ at: 6000 }))).toBe('很好，保持这个节奏。')
    expect(policy.update(input({ at: 12000 }))).toBeUndefined()
  })

  it('resets the stable window for corrections, recovery, pose loss, or higher-priority speech', () => {
    const policy = new EncouragementPolicy()
    policy.update(input())
    expect(policy.update(input({ at: 4000, hasCorrection: true }))).toBeUndefined()
    expect(policy.update(input({ at: 5000 }))).toBeUndefined()
    expect(policy.update(input({ at: 11000, currentVoicePriority: 2 }))).toBeUndefined()
    expect(policy.update(input({ at: 12000 }))).toBeUndefined()
    expect(policy.update(input({ at: 18000 }))).toBe('很好，保持这个节奏。')
  })
})
