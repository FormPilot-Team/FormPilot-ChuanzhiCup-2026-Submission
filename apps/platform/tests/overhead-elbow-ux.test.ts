import { describe, expect, it } from 'vitest'
import { createGestureDemoPoseFrame } from '../src/data/demoPose'
import { OVERHEAD_RAISE_V1 } from '../src/features/exercises/overheadRaise/config'
import { createOverheadRaiseEngine } from '../src/features/exercises/overheadRaise/engine'
import { OverheadRaiseFeatureExtractor } from '../src/features/exercises/overheadRaise/FeatureExtractor'
import { evaluateOverheadRaiseRules } from '../src/features/exercises/overheadRaise/rules'
import { calculateOverheadRaiseScoreComponents } from '../src/features/exercises/overheadRaise/scoring'
import type { OverheadRaiseStateSnapshot } from '../src/features/exercises/overheadRaise/stateMachine'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'
import { features } from './helpers/fixtures'

const topState = (changes: Partial<OverheadRaiseStateSnapshot> = {}): OverheadRaiseStateSnapshot => ({
  phase: 'TOP', repCount: 0, repStartedAt: 0, peakShoulderL: 165, peakShoulderR: 165,
  minElbowL: 170, minElbowR: 170, maxSymmetryDiff: 2, maxTorsoLean: 2, incomplete: false,
  ...changes,
})

const codes = (left: number, right = 170, state = topState()) => evaluateOverheadRaiseRules(
  features({ elbowAngleL: left, elbowAngleR: right }), state,
).errors.map((error) => error.code)

describe('Overhead Raise elbow human UX', () => {
  it('keeps straight and tolerance-zone elbows free of correction', () => {
    expect(codes(170)).not.toContain('ELBOW_TOO_BENT_L')
    expect(codes(142)).not.toContain('ELBOW_TOO_BENT_L')
    expect(codes(135)).not.toContain('ELBOW_TOO_BENT_L')
  })

  it('uses current independent elbow measurements instead of a stale per-rep minimum', () => {
    expect(codes(150, 170, topState({ minElbowL: 120 }))).not.toContain('ELBOW_TOO_BENT_L')
    expect(codes(130, 170)).toContain('ELBOW_TOO_BENT_L')
    expect(codes(170, 130)).toContain('ELBOW_TOO_BENT_R')
    expect(codes(130, 170)).not.toContain('ELBOW_TOO_BENT_R')
  })

  it('confidence-gates elbow correction', () => {
    const result = evaluateOverheadRaiseRules(features({ confidence: 0.4, elbowAngleL: 120 }), topState())
    expect(result.errors.map((error) => error.code)).toEqual(['POSE_LOW_CONFIDENCE'])
  })

  it('requires 650 ms of sustained correction and 500 ms of stable recovery', () => {
    const engine = createOverheadRaiseEngine({ ...OVERHEAD_RAISE_V1, phasePersistenceFrames: 1 })
    engine.process(features({ timestamp: 0, meanShoulderAngle: 40, shoulderVelocity: 30 }))
    engine.process(features({ timestamp: 10, meanShoulderAngle: 160, shoulderAngleL: 160, shoulderAngleR: 160, shoulderVelocity: 20 }))
    expect(engine.process(features({ timestamp: 100, elbowAngleL: 125 })).confirmedPrimaryFeedback).toBeUndefined()
    expect(engine.process(features({ timestamp: 749, elbowAngleL: 125 })).confirmedPrimaryFeedback).toBeUndefined()
    expect(engine.process(features({ timestamp: 750, elbowAngleL: 125 })).confirmedPrimaryFeedback?.code).toBe('ELBOW_TOO_BENT_L')
    expect(engine.process(features({ timestamp: 900, elbowAngleL: 150 })).recoveredFeedback).toBeUndefined()
    expect(engine.process(features({ timestamp: 1400, elbowAngleL: 150 })).recoveredFeedback?.code).toBe('ELBOW_TOO_BENT_L')
  })

  it('times left and right correction episodes independently', () => {
    const engine = createOverheadRaiseEngine({ ...OVERHEAD_RAISE_V1, phasePersistenceFrames: 1 })
    engine.process(features({ timestamp: 0, meanShoulderAngle: 40, shoulderVelocity: 30 }))
    engine.process(features({ timestamp: 10, meanShoulderAngle: 160, shoulderAngleL: 160, shoulderAngleR: 160, shoulderVelocity: 20 }))
    engine.process(features({ timestamp: 100, elbowAngleL: 120 }))
    expect(engine.process(features({ timestamp: 750, elbowAngleL: 120 })).confirmedPrimaryFeedback?.code).toBe('ELBOW_TOO_BENT_L')
    expect(engine.process(features({ timestamp: 900, elbowAngleL: 160, elbowAngleR: 120 })).confirmedPrimaryFeedback?.code).toBe('ELBOW_TOO_BENT_L')
    engine.process(features({ timestamp: 1400, elbowAngleL: 160, elbowAngleR: 120 }))
    expect(engine.process(features({ timestamp: 1550, elbowAngleL: 160, elbowAngleR: 120 })).confirmedPrimaryFeedback?.code).toBe('ELBOW_TOO_BENT_R')
  })

  it('preserves anatomical sides when display coordinates are mirrored', () => {
    const frame = createGestureDemoPoseFrame(0, 'start')
    const mirrored = { ...frame, landmarks: frame.landmarks.map((landmark) => ({ ...landmark, x: 1 - landmark.x })) }
    const normalPose = normalizePoseFrame(frame)
    const mirroredPose = normalizePoseFrame(mirrored)
    if (!normalPose || !mirroredPose) throw new Error('Pose fixtures must normalize')
    const normal = new OverheadRaiseFeatureExtractor().extract(normalPose)
    const reflected = new OverheadRaiseFeatureExtractor().extract(mirroredPose)
    expect(reflected.elbowAngleL).toBeCloseTo(normal.elbowAngleL)
    expect(reflected.elbowAngleR).toBeCloseTo(normal.elbowAngleR)
  })

  it('keeps the 150 degree scoring ideal and continuous scoring behavior', () => {
    expect(OVERHEAD_RAISE_V1.elbowMinAngle).toBe(150)
    expect(OVERHEAD_RAISE_V1.elbowCorrectionAngle).toBe(135)
    expect(calculateOverheadRaiseScoreComponents(165, 165, 150, 150, 2, 2, 3000).elbow).toBe(100)
    expect(calculateOverheadRaiseScoreComponents(165, 165, 142, 142, 2, 2, 3000).elbow).toBeLessThan(100)
  })
})
