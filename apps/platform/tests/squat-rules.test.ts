import { describe, expect, it } from 'vitest'
import { evaluateSquatRules } from '../src/features/exercises/squat/rules'
import type { SquatStateSnapshot } from '../src/features/exercises/squat/stateMachine'
import type { MotionErrorCode, SquatRepSummary } from '../src/features/exercises/types'
import { squatFeatures } from './helpers/fixtures'

function state(overrides: Partial<SquatStateSnapshot> = {}): SquatStateSnapshot {
  return {
    phase: 'BOTTOM',
    repCount: 0,
    repStartedAt: 0,
    bottomEnteredAt: 1200,
    maxHipDrop: 0.34,
    minKneeSpreadRatio: 0.96,
    maxKneeHeightDiff: 0.02,
    maxTorsoLean: 3,
    incomplete: false,
    baselineReady: true,
    ...overrides,
  }
}

function rep(overrides: Partial<SquatRepSummary> = {}): SquatRepSummary {
  return {
    exerciseId: 'squat',
    repIndex: 1,
    startedAt: 0,
    completedAt: 4000,
    durationMs: 4000,
    maxTorsoLean: 3,
    bottomTime: 1500,
    maxHipDrop: 0.34,
    minKneeSpreadRatio: 0.96,
    maxKneeHeightDiff: 0.02,
    depthScore: 90,
    stabilityScore: 90,
    symmetryScore: 90,
    completionScore: 100,
    tempoScore: 100,
    overallScore: 90,
    errors: [],
    ...overrides,
  }
}

function codes(stateChanges: Partial<SquatStateSnapshot> = {}, featureChanges: Parameters<typeof squatFeatures>[0] = {}): MotionErrorCode[] {
  return evaluateSquatRules(squatFeatures({ hipDrop: 0.34, ...featureChanges }), state(stateChanges)).errors.map((item) => item.code)
}

describe('Squat rules', () => {
  it('accepts a correct squat bottom', () => {
    expect(codes()).toEqual([])
  })

  it('detects a shallow squat that still reached BOTTOM', () => {
    expect(codes({ phase: 'BOTTOM', maxHipDrop: 0.18 })).toContain('DEPTH_INSUFFICIENT')
  })

  it('detects knee valgus', () => {
    expect(codes({ minKneeSpreadRatio: 0.6 })).toContain('KNEE_VALGUS')
  })

  it('detects left/right instability', () => {
    expect(codes({ maxKneeHeightDiff: 0.14 })).toContain('LEFT_RIGHT_ASYMMETRY')
  })

  it('detects torso side lean', () => {
    expect(codes({ maxTorsoLean: 16 })).toContain('TORSO_LATERAL_LEAN')
  })

  it('detects a completed rep that is too fast', () => {
    expect(codes({ phase: 'COMPLETE', completedRep: rep({ completedAt: 1800, durationMs: 1800 }) })).toContain('TOO_FAST')
  })

  it('detects an incomplete return to standing', () => {
    expect(codes({ incomplete: true, phase: 'ASCENDING' })).toContain('INCOMPLETE_REP')
  })

  it('gates coaching when confidence is low', () => {
    expect(codes({}, { confidence: 0.4 })).toEqual(['POSE_LOW_CONFIDENCE'])
  })

  it('gates coaching when the body is out of frame', () => {
    const result = evaluateSquatRules(squatFeatures({ bodyInFrame: false, confidence: 0.2, hipDrop: 0.12 }), state({ maxHipDrop: 0.12 }))
    expect(result.errors.map((item) => item.code)).toEqual(['BODY_OUT_OF_FRAME'])
    expect(result.currentScore).toBe(0)
  })

  it('enforces the specified squat feedback priority', () => {
    const result = evaluateSquatRules(squatFeatures(), state({
      incomplete: true,
      minKneeSpreadRatio: 0.55,
      maxHipDrop: 0.16,
      maxKneeHeightDiff: 0.14,
      maxTorsoLean: 18,
      phase: 'COMPLETE',
      completedRep: rep({ durationMs: 1600, completedAt: 1600, maxHipDrop: 0.16, minKneeSpreadRatio: 0.55, maxKneeHeightDiff: 0.14, maxTorsoLean: 18 }),
    }))
    expect(result.errors.map((item) => item.code)).toEqual([
      'INCOMPLETE_REP',
      'KNEE_VALGUS',
      'DEPTH_INSUFFICIENT',
      'LEFT_RIGHT_ASYMMETRY',
      'TORSO_LATERAL_LEAN',
      'TOO_FAST',
    ])
  })
})
