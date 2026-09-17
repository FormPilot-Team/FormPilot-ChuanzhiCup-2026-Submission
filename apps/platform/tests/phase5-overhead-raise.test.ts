import { describe, expect, it } from 'vitest'
import { features } from './helpers/fixtures'
import { OVERHEAD_RAISE_SCORING, OVERHEAD_RAISE_V1 } from '../src/features/exercises/overheadRaise/config'
import { calculateOverheadRaiseScoreComponents } from '../src/features/exercises/overheadRaise/scoring'
import { OverheadRaiseStateMachine, type OverheadRaiseStateSnapshot } from '../src/features/exercises/overheadRaise/stateMachine'
import { evaluateOverheadRaiseRules } from '../src/features/exercises/overheadRaise/rules'

const state = (changes: Partial<OverheadRaiseStateSnapshot> = {}): OverheadRaiseStateSnapshot => ({
  phase: 'TOP', repCount: 0, repStartedAt: 0, peakShoulderL: 165, peakShoulderR: 165,
  minElbowL: 170, minElbowR: 170, maxSymmetryDiff: 2, maxTorsoLean: 2, incomplete: false,
  ...changes,
})

describe('Overhead Raise engineering-v1', () => {
  it('Case A: counts one rep only after START → RAISING → TOP → LOWERING → COMPLETE', () => {
    const machine = new OverheadRaiseStateMachine({ ...OVERHEAD_RAISE_V1, phasePersistenceFrames: 1 })
    expect(machine.update(features({ timestamp: 100, meanShoulderAngle: 40, shoulderVelocity: 30 })).phase).toBe('RAISING')
    expect(machine.update(features({ timestamp: 1200, meanShoulderAngle: 160, shoulderAngleL: 160, shoulderAngleR: 162, shoulderVelocity: 20 })).phase).toBe('TOP')
    expect(machine.update(features({ timestamp: 1800, meanShoulderAngle: 155, shoulderVelocity: -20 })).phase).toBe('LOWERING')
    const done = machine.update(features({ timestamp: 3200, meanShoulderAngle: 15, shoulderVelocity: -20 }))
    expect(done).toMatchObject({ phase: 'COMPLETE', repCount: 1 })
    expect(done.completedRep?.overallScore).toBeGreaterThan(80)
    expect(evaluateOverheadRaiseRules(features({ timestamp:3200 }), done).currentScore).toBe(done.completedRep?.overallScore)
  })

  it('Case B: reaching TOP without a return does not count', () => {
    const machine = new OverheadRaiseStateMachine({ ...OVERHEAD_RAISE_V1, phasePersistenceFrames: 1 })
    machine.update(features({ timestamp: 0, meanShoulderAngle: 40, shoulderVelocity: 30 }))
    const top = machine.update(features({ timestamp: 1000, meanShoulderAngle: 160, shoulderAngleL: 160, shoulderAngleR: 160, shoulderVelocity: 20 }))
    expect(top).toMatchObject({ phase: 'TOP', repCount: 0 })
    expect(top.completedRep).toBeUndefined()
  })

  it('Case C: entering LOWERING but not returning before timeout remains invalid', () => {
    const config = { ...OVERHEAD_RAISE_V1, phasePersistenceFrames: 1, incompleteTimeoutMs: 500 }
    const machine = new OverheadRaiseStateMachine(config)
    machine.update(features({ timestamp: 0, meanShoulderAngle: 40, shoulderVelocity: 30 }))
    machine.update(features({ timestamp: 100, meanShoulderAngle: 165, shoulderAngleL: 165, shoulderAngleR: 165, shoulderVelocity: 20 }))
    machine.update(features({ timestamp: 200, meanShoulderAngle: 150, shoulderVelocity: -20 }))
    const stalled = machine.update(features({ timestamp: 600, meanShoulderAngle: 70, shoulderVelocity: -10 }))
    expect(stalled).toMatchObject({ phase: 'LOWERING', repCount: 0, incomplete: true })
    expect(stalled.completedRep).toBeUndefined()
    expect(evaluateOverheadRaiseRules(features({ timestamp: 600 }), stalled, config).errors.map((error) => error.code)).toContain('INCOMPLETE_REP')
  })

  it('Case D: a high-quality but timed-out attempt cannot produce a high saved repetition', () => {
    const config = { ...OVERHEAD_RAISE_V1, phasePersistenceFrames: 1, incompleteTimeoutMs: 500 }
    const machine = new OverheadRaiseStateMachine(config)
    machine.update(features({ timestamp: 0, meanShoulderAngle: 40, shoulderVelocity: 30 }))
    machine.update(features({ timestamp: 100, meanShoulderAngle: 165, shoulderAngleL: 165, shoulderAngleR: 165, elbowAngleL: 175, elbowAngleR: 175, shoulderVelocity: 20 }))
    machine.update(features({ timestamp: 200, meanShoulderAngle: 155, shoulderVelocity: -20 }))
    const invalid = machine.update(features({ timestamp: 800, meanShoulderAngle: 15, shoulderVelocity: -20 }))
    expect(invalid).toMatchObject({ phase: 'COMPLETE', repCount: 0, incomplete: true })
    expect(invalid.completedRep).toBeUndefined()
    expect(evaluateOverheadRaiseRules(features({ timestamp: 800 }), invalid, config).errors.map((error) => error.code)).toContain('INCOMPLETE_REP')
  })

  it.each([
    ['ARMS_TOO_LOW', { peakShoulderL: 140 }],
    ['ELBOW_TOO_BENT_L', { minElbowL: 140 }],
    ['ELBOW_TOO_BENT_R', { minElbowR: 140 }],
    ['ASYMMETRY', { maxSymmetryDiff: 20 }],
    ['TORSO_LEAN', { maxTorsoLean: 16 }],
  ] as const)('reports %s independently', (code, changes) => {
    const result = evaluateOverheadRaiseRules(features(), state(changes))
    expect(result.errors.map((error) => error.code)).toContain(code)
  })

  it('reports pose confidence and frame-boundary quality failures', () => {
    expect(evaluateOverheadRaiseRules(features({ confidence: .2 }), state()).errors.map((error) => error.code)).toContain('POSE_LOW_CONFIDENCE')
    expect(evaluateOverheadRaiseRules(features({ bodyInFrame: false }), state()).errors.map((error) => error.code)).toContain('BODY_OUT_OF_FRAME')
  })

  it('reports fast tempo and incomplete validity separately from numeric dimensions', () => {
    const completedRep = {
      exerciseId: 'overhead_raise' as const, repIndex: 1, startedAt: 0, completedAt: 1000, durationMs: 1000,
      peakShoulderL: 165, peakShoulderR: 165, minElbowL: 170, minElbowR: 170, maxSymmetryDiff: 2, maxTorsoLean: 2,
      amplitudeScore: 100, elbowScore: 100, synchronizationScore: 100, stabilityScore: 100, tempoScore: 0, overallScore: 90, errors: [],
    }
    const result = evaluateOverheadRaiseRules(features({ timestamp: 1000 }), state({ phase: 'COMPLETE', repCount: 1, completedRep, incomplete: true }))
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(['TOO_FAST', 'INCOMPLETE_REP']))
    expect(result.metrics).not.toHaveProperty('completion')
  })

  it('freezes the 35/25/20/10/10 weights and their sum', () => {
    expect(OVERHEAD_RAISE_SCORING.weights).toEqual({ amplitude: .35, elbow: .25, synchronization: .2, stability: .1, tempo: .1 })
    expect(Object.values(OVERHEAD_RAISE_SCORING.weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
  })

  it('penalizes amplitude, elbow extension, synchronization, stability, and tempo independently', () => {
    const good = calculateOverheadRaiseScoreComponents(165, 165, 170, 170, 2, 2, 3000)
    const variants = [
      calculateOverheadRaiseScoreComponents(105, 105, 170, 170, 2, 2, 3000),
      calculateOverheadRaiseScoreComponents(165, 165, 120, 120, 2, 2, 3000),
      calculateOverheadRaiseScoreComponents(165, 165, 170, 170, 26, 2, 3000),
      calculateOverheadRaiseScoreComponents(165, 165, 170, 170, 2, 18, 3000),
      calculateOverheadRaiseScoreComponents(165, 165, 170, 170, 2, 2, 500),
    ]
    const keys = ['amplitude', 'elbow', 'synchronization', 'stability', 'tempo'] as const
    variants.forEach((variant, index) => {
      expect(variant[keys[index]]).toBeLessThan(good[keys[index]])
      expect(variant.overall).toBeLessThan(good.overall)
    })
  })

  it('keeps score functions continuous around engineering boundaries', () => {
    const before = calculateOverheadRaiseScoreComponents(149.9, 149.9, 149.9, 149.9, 11.9, 9.9, 1999)
    const after = calculateOverheadRaiseScoreComponents(150.1, 150.1, 150.1, 150.1, 12.1, 10.1, 2001)
    for (const key of ['amplitude', 'elbow', 'synchronization', 'stability', 'tempo'] as const) {
      expect(Math.abs(before[key] - after[key])).toBeLessThan(2)
    }
  })
})
