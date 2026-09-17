import { describe, expect, it } from 'vitest'
import { getCoachAnimationFrame } from '../src/adapters/coachAnimation/PlaceholderCoachAnimationAdapter'
import { CoachCardStateResolver } from '../src/features/coach/CoachCardStateResolver'
import type { CoachCardResolverInput } from '../src/features/coach/types'
import { lateralRaiseDefinition } from '../src/features/exercises/lateralRaise/definition'
import { squatDefinition } from '../src/features/exercises/squat/definition'
import type { MotionError } from '../src/features/exercises/types'
import type { FeedbackEvent } from '../src/features/feedback/types'

const lowRight: MotionError = { code: 'ARM_TOO_LOW_R', severity: .8, side: 'right', message: '右臂再抬高一些' }
const bentLeft: MotionError = { code: 'ELBOW_TOO_BENT_L', severity: .7, side: 'left', message: '左手肘再伸直一些' }

function input(overrides: Partial<CoachCardResolverInput> = {}): CoachCardResolverInput {
  return {
    now: 0,
    courseSnapshot: { state: 'ACTIVE', countdown: 0 },
    exerciseReady: true,
    exercise: {
      id: lateralRaiseDefinition.id,
      name: lateralRaiseDefinition.displayName,
      presentation: lateralRaiseDefinition.presentation,
      asset: getCoachAnimationFrame(lateralRaiseDefinition.id),
      referenceProfile: lateralRaiseDefinition.reference,
    },
    targetType: 'reps',
    currentProgress: 2,
    targetValue: 6,
    ...overrides,
  }
}

function recovered(code: FeedbackEvent['code'] = 'ARM_TOO_LOW_R', message = '很好，保持这个高度', timestamp = 100): FeedbackEvent {
  return { id: `${timestamp}-recovery-${code}`, timestamp, kind: 'recovery', exerciseId: 'lateral_raise', code, message, severity: .8 }
}

describe('CoachCardStateResolver', () => {
  it('resolves not ready to PREPARING', () => {
    expect(new CoachCardStateResolver().resolve(input({ exerciseReady: false })).state).toBe('PREPARING')
  })

  it('resolves ready and quiet to ACTIVE', () => {
    expect(new CoachCardStateResolver().resolve(input()).state).toBe('ACTIVE')
  })

  it('uses only the confirmed primary feedback for CORRECTING', () => {
    const view = new CoachCardStateResolver().resolve(input({ confirmedPrimaryFeedback: lowRight }))
    expect(view).toMatchObject({ state: 'CORRECTING', primaryMessage: '右臂再抬高一些', highlightRegion: 'right_arm' })
    expect(view.primaryMessage).not.toContain(bentLeft.message)
  })

  it('shows POSITIVE only for a recovered confirmed error', () => {
    const view = new CoachCardStateResolver().resolve(input({ now: 100, recoveredFeedback: recovered() }))
    expect(view).toMatchObject({ state: 'POSITIVE', primaryMessage: '很好，保持这个高度', positiveSourceError: 'ARM_TOO_LOW_R' })
  })

  it('returns POSITIVE to ACTIVE after the configured timeout', () => {
    const resolver = new CoachCardStateResolver(1200)
    resolver.resolve(input({ now: 100, recoveredFeedback: recovered() }))
    expect(resolver.resolve(input({ now: 1299 })).state).toBe('POSITIVE')
    expect(resolver.resolve(input({ now: 1300 })).state).toBe('ACTIVE')
  })

  it('lets a new confirmed error interrupt POSITIVE immediately', () => {
    const resolver = new CoachCardStateResolver()
    resolver.resolve(input({ now: 100, recoveredFeedback: recovered() }))
    expect(resolver.resolve(input({ now: 200, confirmedPrimaryFeedback: bentLeft }))).toMatchObject({ state: 'CORRECTING', highlightRegion: 'left_elbow' })
  })

  it('resolves course transition to TRANSITION with the next exercise', () => {
    const view = new CoachCardStateResolver().resolve(input({
      courseSnapshot: { state: 'TRANSITION', countdown: 0 },
      nextExercise: {
        id: squatDefinition.id,
        name: squatDefinition.displayName,
        presentation: squatDefinition.presentation,
        asset: getCoachAnimationFrame(squatDefinition.id),
        referenceProfile: squatDefinition.reference,
      },
    }))
    expect(view).toMatchObject({ state: 'TRANSITION', statusLabel: '本动作完成', nextExercise: { id: 'squat' } })
    expect(view.secondaryMessage).toContain('下一动作：徒手深蹲')
    expect(view.coachAsset.src).toContain('coach-squat.png')
  })

  it('gives TRANSITION priority over readiness and confirmed correction', () => {
    const view = new CoachCardStateResolver().resolve(input({
      courseSnapshot: { state: 'TRANSITION', countdown: 0 }, exerciseReady: false, confirmedPrimaryFeedback: lowRight,
    }))
    expect(view.state).toBe('TRANSITION')
  })

  it('freezes the positive timer and visual state while paused', () => {
    const resolver = new CoachCardStateResolver(1200)
    resolver.resolve(input({ now: 100, recoveredFeedback: recovered() }))
    const paused = resolver.resolve(input({ now: 400, courseSnapshot: { state: 'PAUSED', previousState: 'ACTIVE', countdown: 0 } }))
    expect(paused).toMatchObject({ state: 'POSITIVE', paused: true, positiveRemainingMs: 900 })
    expect(resolver.resolve(input({ now: 5400 })).state).toBe('POSITIVE')
    expect(resolver.resolve(input({ now: 6299 })).state).toBe('POSITIVE')
    expect(resolver.resolve(input({ now: 6300 })).state).toBe('ACTIVE')
  })

  it('keeps countdown inside PREPARING instead of creating a sixth state', () => {
    const view = new CoachCardStateResolver().resolve(input({ courseSnapshot: { state: 'COUNTDOWN', countdown: 3 } }))
    expect(view).toMatchObject({ state: 'PREPARING', countdown: 3, statusLabel: '准备中' })
  })

  it('maps a confirmed pose-quality issue to a text-only correction once active', () => {
    const poseError: MotionError = { code: 'POSE_LOW_CONFIDENCE', severity: 1, message: '请调整位置，确保全身完整入镜' }
    expect(new CoachCardStateResolver().resolve(input({ confirmedPrimaryFeedback: poseError }))).toMatchObject({ state: 'CORRECTING', highlightRegion: 'none' })
  })

  it('formats duration, reps, and cycles without circle-count wording', () => {
    const resolver = new CoachCardStateResolver()
    expect(resolver.resolve(input({ targetType: 'duration', currentProgress: 6, targetValue: 15 })).target.label).toBe('剩余 09s')
    expect(resolver.resolve(input({ targetType: 'reps', currentProgress: 4, targetValue: 6 })).target.label).toBe('4 / 6')
    expect(resolver.resolve(input({ targetType: 'cycles', currentProgress: 3, targetValue: 6 })).target.label).toBe('3 / 6 组')
  })
})
