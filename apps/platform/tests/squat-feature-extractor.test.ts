import { describe, expect, it } from 'vitest'
import { createSquatDemoPoseFrame } from '../src/data/demoPose'
import { SquatFeatureExtractor } from '../src/features/exercises/squat/FeatureExtractor'
import { StandingBaseline } from '../src/features/exercises/squat/baseline'
import { SQUAT_V1 } from '../src/features/exercises/squat/config'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'
import { LANDMARK_INDEX, type PoseLandmark } from '../src/features/pose/types'

function point(x: number, y: number, visibility = 0.98): PoseLandmark {
  return { x, y, z: 0, visibility, presence: visibility }
}

function frameFromPoints(
  timestamp: number,
  coords: { shoulderY?: number; hipY?: number; kneeY?: number; kneeSpread?: number; scale?: number; visibility?: number; leftKneeY?: number; hipX?: number },
) {
  const scale = coords.scale ?? 1
  const shoulderY = (coords.shoulderY ?? 0.3) * scale
  const hipY = (coords.hipY ?? 0.52) * scale
  const kneeY = (coords.kneeY ?? 0.74) * scale
  const spread = (coords.kneeSpread ?? 0.1) * scale
  const vis = coords.visibility ?? 0.98
  const leftKneeY = (coords.leftKneeY ?? coords.kneeY ?? 0.74) * scale
  const hipShift = coords.hipX ?? 0
  const landmarks = Array.from({ length: 33 }, () => point(0.5 * scale, 0.5 * scale, vis))
  Object.assign(landmarks, {
    [LANDMARK_INDEX.nose]: point(0.5 * scale, 0.16 * scale, vis),
    [LANDMARK_INDEX.leftShoulder]: point(0.4 * scale, shoulderY, vis),
    [LANDMARK_INDEX.rightShoulder]: point(0.6 * scale, shoulderY, vis),
    [LANDMARK_INDEX.leftElbow]: point(0.38 * scale, (shoulderY / scale + 0.1) * scale, vis),
    [LANDMARK_INDEX.rightElbow]: point(0.62 * scale, (shoulderY / scale + 0.1) * scale, vis),
    [LANDMARK_INDEX.leftWrist]: point(0.36 * scale, (shoulderY / scale + 0.2) * scale, vis),
    [LANDMARK_INDEX.rightWrist]: point(0.64 * scale, (shoulderY / scale + 0.2) * scale, vis),
    [LANDMARK_INDEX.leftHip]: point((0.445 + hipShift) * scale, hipY, vis),
    [LANDMARK_INDEX.rightHip]: point((0.555 + hipShift) * scale, hipY, vis),
    [LANDMARK_INDEX.leftKnee]: point((0.5 - spread / 2 / scale) * scale, leftKneeY, vis),
    [LANDMARK_INDEX.rightKnee]: point((0.5 + spread / 2 / scale) * scale, kneeY, vis),
    [LANDMARK_INDEX.leftAnkle]: point(0.45 * scale, 0.93 * scale, vis),
    [LANDMARK_INDEX.rightAnkle]: point(0.55 * scale, 0.93 * scale, vis),
  })
  const normalized = normalizePoseFrame({ timestamp, landmarks, confidence: vis })
  if (!normalized) throw new Error('Fixture should normalize')
  return normalized
}

function stabilizeBaseline(extractor: SquatFeatureExtractor, start = 0) {
  let features = extractor.extract(frameFromPoints(start, {}))
  for (let index = 1; index < SQUAT_V1.baselineStableFrames + 2; index += 1) {
    features = extractor.extract(frameFromPoints(start + index * 40, {}))
  }
  return features
}

describe('SquatFeatureExtractor', () => {
  it('normalizes hipDrop against standing torso length', () => {
    const extractor = new SquatFeatureExtractor()
    stabilizeBaseline(extractor)
    const bottom = extractor.extract(frameFromPoints(800, { hipY: 0.52 + 0.3 * 0.22, shoulderY: 0.3 + 0.3 * 0.22 }))
    expect(bottom.baselineReady).toBe(true)
    expect(bottom.hipDrop).toBeCloseTo(0.3, 1)
  })

  it('keeps hipDrop, kneeSpreadRatio and kneeHeightDiff scale invariant', () => {
    const a = new SquatFeatureExtractor()
    const b = new SquatFeatureExtractor()
    stabilizeBaseline(a)
    for (let index = 0; index < SQUAT_V1.baselineStableFrames + 2; index += 1) {
      b.extract(frameFromPoints(index * 40, { scale: 0.8 }))
    }
    const first = a.extract(frameFromPoints(900, { hipY: 0.61, shoulderY: 0.39, kneeSpread: 0.08, leftKneeY: 0.76 }))
    const second = b.extract(frameFromPoints(900, { scale: 0.8, hipY: 0.61, shoulderY: 0.39, kneeSpread: 0.08, leftKneeY: 0.76 }))
    expect(second.hipDrop).toBeCloseTo(first.hipDrop, 2)
    expect(second.kneeSpreadRatio).toBeCloseTo(first.kneeSpreadRatio, 2)
    expect(second.kneeHeightDiff).toBeCloseTo(first.kneeHeightDiff, 2)
  })

  it('derives kneeSpreadRatio and kneeHeightDiff from landmarks', () => {
    const extractor = new SquatFeatureExtractor()
    const features = extractor.extract(frameFromPoints(0, { kneeSpread: 0.04, leftKneeY: 0.8 }))
    expect(features.kneeSpreadRatio).toBeLessThan(0.75)
    expect(features.kneeHeightDiff).toBeGreaterThan(0.08)
  })

  it('reports downward hip velocity while descending', () => {
    const extractor = new SquatFeatureExtractor()
    stabilizeBaseline(extractor)
    extractor.extract(frameFromPoints(600, { hipY: 0.53, shoulderY: 0.31 }))
    const moving = extractor.extract(frameFromPoints(1000, { hipY: 0.58, shoulderY: 0.36 }))
    expect(moving.hipVerticalVelocity).toBeGreaterThan(0)
  })

  it('computes torso lateral lean from shared geometry', () => {
    const extractor = new SquatFeatureExtractor()
    const features = extractor.extract(frameFromPoints(0, { hipX: 0.08 }))
    expect(features.torsoLean).toBeGreaterThan(10)
  })

  it('uses demo squat frames without NaN features', () => {
    const extractor = new SquatFeatureExtractor()
    const standing = extractor.extract(normalizePoseFrame(createSquatDemoPoseFrame(0))!)
    const bottom = extractor.extract(normalizePoseFrame(createSquatDemoPoseFrame(2500))!)
    expect(Number.isFinite(standing.kneeSpreadRatio)).toBe(true)
    expect(bottom.hipKneeSeparation).toBeLessThan(standing.hipKneeSeparation)
  })
})

describe('StandingBaseline', () => {
  const sample = (overrides: Partial<Parameters<StandingBaseline['update']>[0]> = {}) => ({
    hipY: 0.52,
    torsoLength: 0.22,
    hipWidth: 0.11,
    kneeWidth: 0.1,
    hipKneeSeparation: 1,
    hipVerticalVelocity: 0,
    confidence: 0.99,
    bodyInFrame: true,
    ...overrides,
  })

  it('freezes after a stable standing window and does not reset every frame', () => {
    const baseline = new StandingBaseline({ ...SQUAT_V1, baselineStableFrames: 8 })
    for (let index = 0; index < 8; index += 1) baseline.update(sample({ hipY: 0.52 + index * 0.0001 }))
    const ready = baseline.snapshot()
    expect(ready.ready).toBe(true)
    const hipY = ready.standingHipY
    baseline.update(sample({ hipY: 0.53 }))
    expect(baseline.snapshot().standingHipY).toBe(hipY)
  })

  it('does not capture a squat pose as standing', () => {
    const baseline = new StandingBaseline({ ...SQUAT_V1, baselineStableFrames: 8 })
    for (let index = 0; index < 10; index += 1) baseline.update(sample({ hipKneeSeparation: 0.4 }))
    expect(baseline.snapshot().ready).toBe(false)
  })

  it('ignores low-confidence frames and rebuilds after leaving the frame', () => {
    const baseline = new StandingBaseline({ ...SQUAT_V1, baselineStableFrames: 4, baselineLostFramesToReset: 3 })
    for (let index = 0; index < 4; index += 1) baseline.update(sample())
    expect(baseline.snapshot().ready).toBe(true)
    for (let index = 0; index < 3; index += 1) baseline.update(sample({ bodyInFrame: false, confidence: 0.2 }))
    expect(baseline.snapshot().ready).toBe(false)
    for (let index = 0; index < 4; index += 1) baseline.update(sample({ hipY: 0.5 }))
    expect(baseline.snapshot()).toMatchObject({ ready: true, standingHipY: 0.5 })
  })
})
