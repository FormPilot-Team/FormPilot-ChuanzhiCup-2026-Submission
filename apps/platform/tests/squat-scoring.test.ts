import { describe, expect, it } from 'vitest'
import { calculateSquatMetrics, depthScore, weightedSquatScore } from '../src/features/exercises/squat/scoring'
import { squatFeatures } from './helpers/fixtures'
import type { SquatStateSnapshot } from '../src/features/exercises/squat/stateMachine'
import type { SquatRepSummary } from '../src/features/exercises/types'

const standing: SquatStateSnapshot = {
  phase: 'STANDING',
  repCount: 0,
  maxHipDrop: 0,
  minKneeSpreadRatio: 1,
  maxKneeHeightDiff: 0,
  maxTorsoLean: 0,
  incomplete: false,
  baselineReady: true,
}

function completed(overrides: Partial<SquatRepSummary> = {}): SquatStateSnapshot {
  const completedRep: SquatRepSummary = {
    exerciseId: 'squat',
    repIndex: 1,
    startedAt: 0,
    completedAt: 4000,
    durationMs: 4000,
    maxTorsoLean: 2,
    bottomTime: 1600,
    maxHipDrop: 0.34,
    minKneeSpreadRatio: 0.96,
    maxKneeHeightDiff: 0.02,
    depthScore: 0,
    stabilityScore: 0,
    symmetryScore: 0,
    completionScore: 0,
    tempoScore: 0,
    overallScore: 0,
    errors: [],
    ...overrides,
  }
  return {
    phase: 'COMPLETE',
    repCount: 1,
    maxHipDrop: completedRep.maxHipDrop,
    minKneeSpreadRatio: completedRep.minKneeSpreadRatio,
    maxKneeHeightDiff: completedRep.maxKneeHeightDiff,
    maxTorsoLean: completedRep.maxTorsoLean,
    incomplete: false,
    baselineReady: true,
    completedRep,
  }
}

describe('Squat scoring', () => {
  it('scores depth continuously and plateaus after the target', () => {
    expect(depthScore(0.1)).toBe(22)
    expect(depthScore(0.2)).toBe(64)
    expect(depthScore(0.3)).toBe(92)
    expect(depthScore(0.35)).toBe(100)
    expect(depthScore(0.5)).toBe(100)
  })

  it('has no cliff at the valid-depth threshold', () => {
    const below = depthScore(0.299)
    const above = depthScore(0.3)
    expect(Math.abs(above - below)).toBeLessThan(1)
    expect(below).toBeGreaterThan(90)
  })

  it('gives a high overall score to a correct squat', () => {
    const metrics = calculateSquatMetrics(completed(), squatFeatures({ timestamp: 4000, hipDrop: 0.34 }))
    expect(Object.keys(metrics)).toEqual(['amplitude', 'stability', 'symmetry', 'tempo', 'completion'])
    expect(weightedSquatScore(metrics)).toBeGreaterThan(85)
  })

  it('gives a partial depth score near the target', () => {
    const metrics = calculateSquatMetrics(completed({ maxHipDrop: 0.24 }), squatFeatures({ timestamp: 4000, hipDrop: 0.24 }))
    expect(metrics.amplitude.score).toBeGreaterThan(60)
    expect(metrics.amplitude.score).toBeLessThan(92)
  })

  it('scores a shallow squat much lower on depth', () => {
    const metrics = calculateSquatMetrics(completed({ maxHipDrop: 0.12 }), squatFeatures({ timestamp: 4000, hipDrop: 0.12 }))
    expect(metrics.amplitude.score).toBeLessThan(40)
  })

  it('penalizes severe valgus on symmetry', () => {
    const good = calculateSquatMetrics(completed(), squatFeatures({ timestamp: 4000 }))
    const valgus = calculateSquatMetrics(completed({ minKneeSpreadRatio: 0.55 }), squatFeatures({ timestamp: 4000, kneeSpreadRatio: 0.55 }))
    expect(valgus.symmetry.score).toBeLessThan(good.symmetry.score)
    expect(valgus.symmetry.score).toBeLessThan(20)
  })

  it('keeps idle standing from looking like a failed rep', () => {
    const metrics = calculateSquatMetrics(standing, squatFeatures())
    expect(metrics.completion.score).toBe(0)
    expect(metrics.tempo.score).toBeGreaterThan(0)
  })
})
