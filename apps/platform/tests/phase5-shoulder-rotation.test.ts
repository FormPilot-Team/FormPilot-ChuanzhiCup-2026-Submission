import { describe, expect, it } from 'vitest'
import type { ShoulderRotationFeatures } from '../src/features/motion/types'
import { ShoulderRotationStateMachine, type ShoulderRotationStateSnapshot } from '../src/features/exercises/shoulderRotation/stateMachine'
import { SHOULDER_ROTATION_V1 } from '../src/features/exercises/shoulderRotation/config'
import { evaluateShoulderRotationRules } from '../src/features/exercises/shoulderRotation/rules'
import { features } from './helpers/fixtures'

const rotation = (changes: Partial<ShoulderRotationFeatures> = {}): ShoulderRotationFeatures => ({
  ...features(), shoulderVelocityL: 30, shoulderVelocityR: 28, leftExcursion: 60, rightExcursion: 58,
  motionSync: .94, motionContinuity: .9, moving: true, ...changes,
})
const state = (changes: Partial<ShoulderRotationStateSnapshot> = {}): ShoulderRotationStateSnapshot => ({
  phase: 'ROTATING', repCount: 0, activeMotionMs: 3000, paused: false, ...changes,
})

describe('Shoulder Rotation guidance mode', () => {
  it('completes by active motion duration and never counts repetitions', () => {
    const machine = new ShoulderRotationStateMachine({ ...SHOULDER_ROTATION_V1, targetDurationMs: 1000 })
    expect(machine.update(rotation({ timestamp: 0 })).phase).toBe('ROTATING')
    expect(machine.update(rotation({ timestamp: 500 })).activeMotionMs).toBe(500)
    expect(machine.update(rotation({ timestamp: 1100 })).phase).toBe('COMPLETE')
    expect(machine.getSnapshot().repCount).toBe(0)
  })

  it('does not count stationary wall-clock time toward the duration target', () => {
    const machine = new ShoulderRotationStateMachine({ ...SHOULDER_ROTATION_V1, targetDurationMs: 1000, pauseTimeoutMs: 500 })
    machine.update(rotation({ timestamp: 0 }))
    const stopped = machine.update(rotation({ timestamp: 5000, moving: false, motionContinuity: 0 }))
    expect(stopped).toMatchObject({ phase: 'ROTATING', activeMotionMs: 0, paused: true })
    const resumed = machine.update(rotation({ timestamp: 5100 }))
    expect(resumed).toMatchObject({ phase: 'ROTATING', activeMotionMs: 100, paused: false })
  })

  it('accepts a normal continuous rotation without motion errors', () => {
    expect(evaluateShoulderRotationRules(rotation(), state()).errors).toEqual([])
  })

  it.each([
    ['MOTION_TOO_SMALL', { leftExcursion: 10, rightExcursion: 12 }, {}],
    ['ARMS_UNSYNCED', { motionSync: .2 }, {}],
    ['MOTION_PAUSED', { motionContinuity: .2, moving: false }, { paused: true }],
    ['TORSO_LEAN', { torsoLean: 15 }, {}],
  ] as const)('reports %s independently', (code, featureChanges, stateChanges) => {
    const result = evaluateShoulderRotationRules(rotation(featureChanges), state(stateChanges))
    expect(result.errors.map((error) => error.code)).toContain(code)
  })

  it('reports pose quality failures', () => {
    expect(evaluateShoulderRotationRules(rotation({ confidence: .2 }), state()).errors.map((error) => error.code)).toContain('POSE_LOW_CONFIDENCE')
    expect(evaluateShoulderRotationRules(rotation({ bodyInFrame: false }), state()).errors.map((error) => error.code)).toContain('BODY_OUT_OF_FRAME')
  })

  it('always excludes guidance mode from numeric scoring', () => {
    const good = evaluateShoulderRotationRules(rotation(), state())
    const poor = evaluateShoulderRotationRules(rotation({ leftExcursion: 5, rightExcursion: 5, motionSync: 0, motionContinuity: 0, torsoLean: 30 }), state({ paused: true }))
    expect(good.currentScore).toBe(0)
    expect(poor.currentScore).toBe(0)
  })
})
