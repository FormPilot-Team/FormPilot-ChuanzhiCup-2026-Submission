import { describe, expect, it } from 'vitest'
import { evaluateLateralRaiseRules } from '../src/features/exercises/lateralRaise/rules'
import type { MotionErrorCode } from '../src/features/exercises/types'
import { features, snapshot } from './helpers/fixtures'

function codes(featureChanges = {}, snapshotChanges = {}): MotionErrorCode[] {
  return evaluateLateralRaiseRules(features(featureChanges), snapshot(snapshotChanges)).errors.map((item) => item.code)
}

describe('lateral raise rules', () => {
  it('accepts a correctly aligned top position', () => {
    expect(codes()).toEqual([])
  })

  it.each([
    ['ARM_TOO_LOW_L', { peakShoulderL: 65 }],
    ['ARM_TOO_LOW_R', { peakShoulderR: 65 }],
    ['ELBOW_TOO_BENT_L', { minElbowL: 125 }],
    ['ELBOW_TOO_BENT_R', { minElbowR: 125 }],
    ['ASYMMETRY', { maxSymmetryDiff: 28 }],
    ['TORSO_LEAN', { maxTorsoLean: 18 }],
  ] satisfies Array<[MotionErrorCode, Record<string, number>]>)('detects %s', (expected, changes) => {
    expect(codes({}, changes)).toContain(expected)
  })

  it('gates coaching when the body is outside the frame', () => {
    const result = evaluateLateralRaiseRules(features({ bodyInFrame: false, confidence: 0.2 }), snapshot({ peakShoulderL: 40 }))
    expect(result.errors.map((item) => item.code)).toEqual(['BODY_OUT_OF_FRAME'])
    expect(result.currentScore).toBe(0)
    expect(result.metrics.amplitude.valid).toBe(false)
  })

  it('prioritizes low arm height over elbow, lean, tempo and incomplete errors', () => {
    const completedRep = {
      exerciseId: 'lateral_raise' as const,
      repIndex: 1,
      startedAt: 0,
      completedAt: 1000,
      durationMs: 1000,
      topHoldMs: 100,
      peakShoulderL: 60,
      peakShoulderR: 90,
      minElbowL: 120,
      minElbowR: 170,
      maxSymmetryDiff: 30,
      maxTorsoLean: 20,
    }
    const result = evaluateLateralRaiseRules(features(), snapshot({ phase: 'COMPLETE', incomplete: true, completedRep }))
    expect(result.primaryFeedback?.code).toBe('ARM_TOO_LOW_L')
    expect(result.errors.map((item) => item.code)).toEqual([
      'ARM_TOO_LOW_L',
      'ASYMMETRY',
      'ELBOW_TOO_BENT_L',
      'TORSO_LEAN',
      'TOO_FAST',
      'INCOMPLETE_REP',
    ])
  })
})
