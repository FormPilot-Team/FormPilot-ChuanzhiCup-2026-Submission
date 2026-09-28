import { describe, expect, it } from 'vitest'
import { OVERHEAD_RAISE_V1 } from '../src/features/exercises/overheadRaise/config'
import { OverheadRaiseStateMachine } from '../src/features/exercises/overheadRaise/stateMachine'
import type { OverheadRaiseRepSummary } from '../src/features/exercises/types'
import { features } from './helpers/fixtures'

function completeRep(
  topFrames: Array<{ left: number; right: number; confidence?: number }> = [{ left: 165, right: 166 }],
  raisingElbows = { left: 90, right: 95 },
  loweringElbows = { left: 80, right: 85 },
): OverheadRaiseRepSummary {
  const machine = new OverheadRaiseStateMachine({ ...OVERHEAD_RAISE_V1, phasePersistenceFrames: 1 })
  machine.update(features({
    timestamp: 0,
    meanShoulderAngle: 40,
    shoulderVelocity: 30,
    elbowAngleL: raisingElbows.left,
    elbowAngleR: raisingElbows.right,
  }))
  topFrames.forEach((frame, index) => machine.update(features({
    timestamp: 1000 + index * 200,
    meanShoulderAngle: 160,
    shoulderAngleL: 160,
    shoulderAngleR: 160,
    shoulderVelocity: index === 0 ? 20 : 0,
    elbowAngleL: frame.left,
    elbowAngleR: frame.right,
    confidence: frame.confidence ?? 0.99,
  })))
  machine.update(features({
    timestamp: 2000,
    meanShoulderAngle: 120,
    shoulderVelocity: -20,
    elbowAngleL: loweringElbows.left,
    elbowAngleR: loweringElbows.right,
  }))
  const complete = machine.update(features({
    timestamp: 3000,
    meanShoulderAngle: 20,
    shoulderVelocity: -20,
    elbowAngleL: 70,
    elbowAngleR: 75,
  }))
  if (!complete.completedRep) throw new Error('Expected a completed overhead repetition')
  return complete.completedRep
}

describe('Overhead Raise TOP elbow analytics evidence', () => {
  it('uses the lower quartile of qualified TOP frames instead of one noisy minimum', () => {
    const rep = completeRep([
      { left: 90, right: 92 },
      { left: 160, right: 162 },
      { left: 160, right: 162 },
      { left: 160, right: 162 },
      { left: 160, right: 162 },
    ])
    expect(rep).toMatchObject({ topElbowL: 160, topElbowR: 162 })
  })

  it('does not let naturally bent raising elbows contaminate TOP evidence', () => {
    const rep = completeRep([{ left: 164, right: 165 }], { left: 75, right: 80 })
    expect(rep).toMatchObject({ minElbowL: 70, minElbowR: 75, topElbowL: 164, topElbowR: 165 })
  })

  it('does not let lowering elbows contaminate TOP evidence', () => {
    const rep = completeRep([{ left: 163, right: 164 }], undefined, { left: 60, right: 65 })
    expect(rep).toMatchObject({ topElbowL: 163, topElbowR: 164 })
  })

  it('tracks left and right TOP evidence independently', () => {
    const rep = completeRep([{ left: 120, right: 170 }, { left: 160, right: 145 }])
    expect(rep.topElbowL).toBe(130)
    expect(rep.topElbowR).toBeCloseTo(151.25)
  })

  it('omits TOP elbow evidence when every TOP measurement is below confidence threshold', () => {
    const rep = completeRep([{ left: 0, right: 0, confidence: 0.4 }])
    expect(rep.topElbowL).toBeUndefined()
    expect(rep.topElbowR).toBeUndefined()
    expect(JSON.stringify(rep)).not.toContain('topElbow')
  })

  it('does not deduct elbow extension for naturally bent transition frames', () => {
    const rep = completeRep([{ left: 170, right: 170 }], { left: 100, right: 100 })
    expect(rep.topElbowL).toBe(170)
    expect(rep.minElbowL).toBe(70)
    expect(rep.elbowScore).toBe(100)
    expect(rep.errors).not.toContain('ELBOW_TOO_BENT_L')
  })

  it('deducts elbow extension when the TOP window remains bent', () => {
    const rep = completeRep(Array.from({ length: 5 }, () => ({ left: 120, right: 122 })))
    expect(rep.elbowScore).toBe(25)
    expect(rep.errors).toContain('ELBOW_TOO_BENT_L')
    expect(rep.errors).toContain('ELBOW_TOO_BENT_R')
  })
})
