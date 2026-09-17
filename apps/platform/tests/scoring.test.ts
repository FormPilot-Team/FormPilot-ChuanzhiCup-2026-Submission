import { describe, expect, it } from 'vitest'
import { bandScore, lowerIsBetterScore } from '../src/features/exercises/scoring'
import { calculateMetrics, weightedScore } from '../src/features/exercises/lateralRaise/scoring'
import { snapshot } from './helpers/fixtures'

describe('continuous scoring', () => {
  it('scores ideal, boundary and clearly poor values continuously', () => {
    expect(bandScore(90, 80, 100, 40)).toBe(100)
    expect(bandScore(80, 80, 100, 40)).toBe(100)
    expect(bandScore(60, 80, 100, 40)).toBe(50)
    expect(lowerIsBetterScore(5, 5, 35)).toBe(100)
    expect(lowerIsBetterScore(20, 5, 35)).toBe(50)
  })

  it('has no score discontinuity just outside an ideal threshold', () => {
    expect(bandScore(79.9, 80, 100, 40)).toBeGreaterThan(99)
    expect(lowerIsBetterScore(5.1, 5, 35)).toBeGreaterThan(99)
  })

  it('applies the documented 35/25/20/10/10 weighting', () => {
    const metrics = calculateMetrics(snapshot({ phase: 'COMPLETE', completedRep: {
      exerciseId: 'lateral_raise',
      repIndex: 1,
      startedAt: 0,
      completedAt: 3000,
      durationMs: 3000,
      topHoldMs: 400,
      peakShoulderL: 90,
      peakShoulderR: 90,
      minElbowL: 170,
      minElbowR: 170,
      maxSymmetryDiff: 4,
      maxTorsoLean: 2,
    } }), { shoulderL: 90, shoulderR: 90, symmetry: 4, torsoLean: 2, timestamp: 3000 })
    expect(weightedScore(metrics)).toBe(100)
  })

  it('includes the documented top hold in tempo quality', () => {
    const complete = snapshot({ phase: 'COMPLETE', completedRep: {
      exerciseId: 'lateral_raise',
      repIndex: 1, startedAt: 0, completedAt: 3000, durationMs: 3000, topHoldMs: 0,
      peakShoulderL: 90, peakShoulderR: 90, minElbowL: 170, minElbowR: 170,
      maxSymmetryDiff: 4, maxTorsoLean: 2,
    } })
    const metrics = calculateMetrics(complete, { shoulderL: 90, shoulderR: 90, symmetry: 4, torsoLean: 2, timestamp: 3000 })
    expect(metrics.tempo.score).toBeLessThan(100)
  })
})
