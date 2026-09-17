import lateralRaiseAnchorJson from '../public/assets/coach-lateral-raise.pose.json'
import stepJackAnchorJson from '../public/assets/coach-step-jack.pose.json'
import squatAnchorJson from '../public/assets/coach-squat.pose.json'
import kneeRaiseAnchorJson from '../public/assets/coach-knee-raise.pose.json'
import { describe, expect, it } from 'vitest'
import { LateralRaiseFeatureExtractor } from '../src/features/exercises/lateralRaise/FeatureExtractor'
import { StepJackFeatureExtractor } from '../src/features/exercises/stepJack/FeatureExtractor'
import { SquatFeatureExtractor } from '../src/features/exercises/squat/FeatureExtractor'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'
import { LANDMARK_INDEX, type PoseFrame, type PoseLandmark } from '../src/features/pose/types'
import { KNEE_RAISE_REFERENCE, LATERAL_RAISE_REFERENCE, STEP_JACK_REFERENCE, SQUAT_REFERENCE } from '../src/features/referencePose/definitions'
import { mirrorReferencePose } from '../src/features/referencePose/mirrorReferencePose'
import type { ReferencePose } from '../src/features/referencePose/types'
import { validateSquatCoachAsset } from '../src/features/referencePose/coachAssetValidation'

function frameFromAnchor(anchor: ReferencePose): PoseFrame {
  const fallback: PoseLandmark = { x: 0.5, y: 0.5, z: 0, visibility: 0.99, presence: 0.99 }
  const landmarks = Array.from({ length: 33 }, () => ({ ...fallback }))
  for (const [name, point] of Object.entries(anchor.landmarks)) {
    landmarks[LANDMARK_INDEX[name as keyof typeof LANDMARK_INDEX]] = { ...point, presence: point.visibility }
  }
  return { timestamp: 0, landmarks, confidence: Math.min(...Object.values(anchor.landmarks).map((point) => point.visibility)) }
}

describe('reference pose model', () => {
  const lateralRaiseAnchor = lateralRaiseAnchorJson as ReferencePose
  const stepJackAnchor = stepJackAnchorJson as ReferencePose

  it('defines canonical targets separately from wider user acceptance', () => {
    const top = LATERAL_RAISE_REFERENCE.canonicalPoses.find((pose) => pose.id === 'lateral_raise.TOP')
    const user = LATERAL_RAISE_REFERENCE.userAcceptance.find((item) => item.canonicalPoseId === top?.id)
    const asset = LATERAL_RAISE_REFERENCE.coachAssetAcceptance.find((item) => item.canonicalPoseId === top?.id)
    expect(top?.metrics.find((metric) => metric.key === 'shoulderAngle')?.target).toBe(90)
    expect(user?.metrics.find((metric) => metric.key === 'shoulderAngle')).toMatchObject({ min: 80, max: 100 })
    expect(asset?.metrics.find((metric) => metric.key === 'shoulderAngle')).toMatchObject({ min: 85, max: 95 })
  })

  it('keeps Step Jack LEFT_OPEN and RIGHT_OPEN canonical metrics mirrored', () => {
    const left = STEP_JACK_REFERENCE.canonicalPoses.find((pose) => pose.id === 'step_jack.LEFT_OPEN')
    const right = STEP_JACK_REFERENCE.canonicalPoses.find((pose) => pose.id === 'step_jack.RIGHT_OPEN')
    expect(left?.side).toBe('left')
    expect(right?.side).toBe('right')
    expect(right?.metrics).toEqual(left?.metrics)
    const mirrored = mirrorReferencePose(stepJackAnchor, 'step_jack.RIGHT_OPEN')
    expect(mirrored.landmarks.leftAnkle.x).toBeCloseTo(1 - stepJackAnchor.landmarks.rightAnkle.x, 8)
    expect(mirrored.landmarks.rightAnkle.x).toBeCloseTo(1 - stepJackAnchor.landmarks.leftAnkle.x, 8)
  })

  it('passes Lateral Raise coach visual acceptance from recorded anchors', () => {
    const normalized = normalizePoseFrame(frameFromAnchor(lateralRaiseAnchor))
    expect(normalized).not.toBeNull()
    const features = new LateralRaiseFeatureExtractor().extract(normalized!)
    expect(features.shoulderAngleL).toBeGreaterThanOrEqual(85)
    expect(features.shoulderAngleL).toBeLessThanOrEqual(95)
    expect(features.shoulderAngleR).toBeGreaterThanOrEqual(85)
    expect(features.shoulderAngleR).toBeLessThanOrEqual(95)
    expect(features.elbowAngleL).toBeGreaterThanOrEqual(160)
    expect(features.elbowAngleR).toBeGreaterThanOrEqual(160)
    expect(features.symmetryDiff).toBeLessThanOrEqual(5)
    expect(features.torsoLean).toBeLessThanOrEqual(5)
  })

  it('passes Step Jack coach visual acceptance from recorded anchors', () => {
    const normalized = normalizePoseFrame(frameFromAnchor(stepJackAnchor))
    expect(normalized).not.toBeNull()
    const features = new StepJackFeatureExtractor().extract(normalized!)
    expect(features.meanShoulderAngle).toBeGreaterThanOrEqual(140)
    expect(features.meanShoulderAngle).toBeLessThanOrEqual(150)
    expect(features.openRatio).toBeGreaterThanOrEqual(1.7)
    expect(features.openRatio).toBeLessThanOrEqual(1.9)
    expect(features.torsoLean).toBeLessThanOrEqual(5)
  })

  it('keeps Squat Canonical, User Acceptance and Coach Asset as three layers', () => {
    const bottom = SQUAT_REFERENCE.canonicalPoses.find((pose) => pose.id === 'squat.BOTTOM')
    const standing = SQUAT_REFERENCE.canonicalPoses.find((pose) => pose.id === 'squat.STANDING')
    const user = SQUAT_REFERENCE.userAcceptance.find((item) => item.canonicalPoseId === bottom?.id)
    const asset = SQUAT_REFERENCE.coachAssetAcceptance.find((item) => item.canonicalPoseId === bottom?.id)
    expect(standing?.phase).toBe('STANDING')
    expect(bottom?.metrics.find((metric) => metric.key === 'hipDrop')?.target).toBe(0.35)
    expect(user?.metrics.find((metric) => metric.key === 'hipDrop')).toMatchObject({ min: 0.3 })
    expect(asset?.detectability).toMatchObject({ minimumPoseConfidence: 0.95, minimumRequiredLandmarkVisibility: 0.95 })
    expect(asset?.metrics.find((metric) => metric.key === 'hipKneeSeparation')).toMatchObject({ min: -0.35, max: 0.2 })
    expect(asset?.metrics.find((metric) => metric.key === 'kneeWidthShoulderRatio')).toMatchObject({ min: 0.9, max: 1.5 })
    expect(asset?.metrics.some((metric) => metric.key === 'kneeSpreadRatio')).toBe(false)
    expect(user?.metrics.find((metric) => metric.key === 'hipDrop')?.min).toBeLessThan(bottom?.metrics.find((metric) => metric.key === 'hipDrop')?.target ?? 0)
  })

  it('passes Squat coach visual acceptance from recorded MediaPipe anchors', () => {
    const squatAnchor = squatAnchorJson as ReferencePose
    const normalized = normalizePoseFrame(frameFromAnchor(squatAnchor))
    expect(normalized).not.toBeNull()
    const features = new SquatFeatureExtractor().extract(normalized!)
    expect(features.confidence).toBeGreaterThanOrEqual(0.95)
    expect(features.hipKneeSeparation).toBeGreaterThanOrEqual(-0.45)
    expect(features.hipKneeSeparation).toBeLessThanOrEqual(0.65)
    const acceptance = SQUAT_REFERENCE.coachAssetAcceptance.find((item) => item.canonicalPoseId === 'squat.BOTTOM')!
    const validation = validateSquatCoachAsset(squatAnchor, acceptance)
    expect(validation.detectable).toBe(true)
    expect(validation.canonicalSimilarityPassed).toBe(true)
    expect(validation.metrics.kneeSpreadRatio).toBeGreaterThan(2)
    expect(validation.metrics.kneeWidthShoulderRatio).toBeLessThanOrEqual(1.5)
  })

  it('keeps Knee Raise canonical sides as deterministic mirrors and separate acceptance layers', () => {
    const left = KNEE_RAISE_REFERENCE.canonicalPoses.find((pose) => pose.id === 'knee_raise.LEFT_TOP')!
    const right = KNEE_RAISE_REFERENCE.canonicalPoses.find((pose) => pose.id === 'knee_raise.RIGHT_TOP')!
    expect(right.landmarks?.rightKnee.x).toBeCloseTo(1 - left.landmarks!.leftKnee.x, 8)
    expect(KNEE_RAISE_REFERENCE.userAcceptance[0].metrics.find((metric) => metric.key === 'leftKneeHeight')).toMatchObject({ min: -0.1 })
    expect(KNEE_RAISE_REFERENCE.coachAssetAcceptance[0].detectability).toBeDefined()
  })

  it('passes Knee Raise coach detectability and canonical similarity using real MediaPipe anchors', () => {
    const anchor = kneeRaiseAnchorJson as ReferencePose
    const acceptance = KNEE_RAISE_REFERENCE.coachAssetAcceptance[0]
    const validation = validateSquatCoachAsset(anchor, acceptance)
    expect(validation.detectable).toBe(true)
    expect(validation.canonicalSimilarityPassed).toBe(true)
    expect(validation.metrics.leftKneeHeight).toBeGreaterThanOrEqual(-0.1)
    expect(validation.metrics.rightKneeHeight).toBeLessThanOrEqual(-0.45)
  })
})
