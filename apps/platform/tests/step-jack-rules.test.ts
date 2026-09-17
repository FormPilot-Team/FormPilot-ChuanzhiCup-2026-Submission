import { describe, expect, it } from 'vitest'
import { evaluateStepJackRules } from '../src/features/exercises/stepJack/rules'
import type { StepJackStateSnapshot } from '../src/features/exercises/stepJack/stateMachine'
import type { MotionErrorCode, StepJackRepSummary } from '../src/features/exercises/types'
import { stepFeatures } from './helpers/fixtures'

function state(overrides: Partial<StepJackStateSnapshot> = {}): StepJackStateSnapshot {
  return {
    phase: 'LEFT_OPEN', repCount: 0, activeSide: 'left', repStartedAt: 0,
    armOpenAt: 500, legOpenAt: 650, peakOpenRatio: 1.7, peakMeanShoulderAngle: 145,
    maxArmAngleDiff: 5, maxTorsoLean: 3, wrongSideSequence: false, incompleteReturn: false,
    ...overrides,
  }
}

function rep(overrides: Partial<StepJackRepSummary> = {}): StepJackRepSummary {
  return {
    exerciseId: 'step_jack', repIndex: 1, startedAt: 0, completedAt: 1300, durationMs: 1300,
    maxTorsoLean: 3, side: 'left', peakOpenRatio: 1.7,
    peakMeanShoulderAngle: 145, maxArmAngleDiff: 5, syncGapMs: 150,
    wrongSideSequence: false, incompleteReturn: false, ...overrides,
  }
}

function codes(stateChanges = {}, featureChanges = {}): MotionErrorCode[] {
  return evaluateStepJackRules(stepFeatures(featureChanges), state(stateChanges)).errors.map((item) => item.code)
}

describe('Step Jack rules', () => {
  it('accepts a coordinated open position', () => expect(codes()).toEqual([]))
  it('detects insufficient step amplitude', () => expect(codes({ phase: 'RETURNING_FROM_LEFT', peakOpenRatio: 1.35 })).toContain('STEP_TOO_SMALL'))
  it('detects insufficient arm height', () => expect(codes({ peakMeanShoulderAngle: 105 })).toContain('ARM_TOO_LOW'))
  it('detects arm/leg timing beyond 400ms', () => expect(codes({ armOpenAt: 100, legOpenAt: 650 })).toContain('ARM_LEG_UNSYNCED'))
  it('detects repeated side sequence', () => expect(codes({ wrongSideSequence: true })).toContain('WRONG_SIDE_SEQUENCE'))
  it('detects excessive torso sway', () => expect(codes({ maxTorsoLean: 18 })).toContain('BODY_SWAY'))
  it('detects incomplete return', () => expect(codes({ incompleteReturn: true })).toContain('INCOMPLETE_RETURN'))

  it('detects a completed rep that is too fast', () => {
    expect(codes({ phase: 'CENTER', completedRep: rep({ completedAt: 700, durationMs: 700 }) })).toContain('TOO_FAST')
  })

  it('gates rule feedback for low confidence', () => {
    expect(codes({}, { confidence: 0.4 })).toEqual(['POSE_LOW_CONFIDENCE'])
  })

  it('gates rule feedback when body is out of frame', () => {
    const result = evaluateStepJackRules(stepFeatures({ bodyInFrame: false, confidence: 0.2 }), state({ peakOpenRatio: 1.2 }))
    expect(result.errors.map((item) => item.code)).toEqual(['BODY_OUT_OF_FRAME'])
    expect(result.currentScore).toBe(0)
  })

  it('enforces the specified feedback priority', () => {
    const result = evaluateStepJackRules(stepFeatures(), state({
      wrongSideSequence: true, incompleteReturn: true, peakOpenRatio: 1.3,
      peakMeanShoulderAngle: 90, armOpenAt: 0, legOpenAt: 900, maxTorsoLean: 20,
    }))
    expect(result.errors.map((item) => item.code)).toEqual([
      'WRONG_SIDE_SEQUENCE', 'INCOMPLETE_RETURN', 'STEP_TOO_SMALL', 'ARM_LEG_UNSYNCED', 'ARM_TOO_LOW', 'BODY_SWAY',
    ])
  })
})
