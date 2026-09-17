import { describe, expect, it } from 'vitest'
import { calculateStepJackMetrics, coordinationScore, weightedStepJackScore } from '../src/features/exercises/stepJack/scoring'
import { stepFeatures } from './helpers/fixtures'
import type { StepJackStateSnapshot } from '../src/features/exercises/stepJack/stateMachine'

const state: StepJackStateSnapshot = {
  phase: 'LEFT_OPEN', repCount: 0, activeSide: 'left', repStartedAt: 0, armOpenAt: 500, legOpenAt: 650,
  peakOpenRatio: 1.7, peakMeanShoulderAngle: 145, maxArmAngleDiff: 5, maxTorsoLean: 3,
  wrongSideSequence: false, incompleteReturn: false,
}

describe('Step Jack scoring', () => {
  it('maps synchronization bands continuously', () => {
    expect(coordinationScore(200)).toBe(100)
    expect(coordinationScore(300)).toBe(85)
    expect(coordinationScore(400)).toBe(70)
    expect(coordinationScore(401)).toBeLessThan(70)
  })

  it('uses coordination/amplitude/tempo/stability/completion metrics', () => {
    const metrics = calculateStepJackMetrics(state, stepFeatures({ timestamp: 1300 }))
    expect(Object.keys(metrics)).toEqual(['amplitude', 'coordination', 'stability', 'tempo', 'completion'])
    expect(weightedStepJackScore(metrics)).toBeGreaterThan(75)
  })
})
