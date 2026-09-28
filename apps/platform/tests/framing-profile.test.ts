import { describe, expect, it } from 'vitest'
import { createDemoPoseFrame } from '../src/data/demoPose'
import { KneeRaiseFeatureExtractor } from '../src/features/exercises/kneeRaise/FeatureExtractor'
import { LateralRaiseFeatureExtractor } from '../src/features/exercises/lateralRaise/FeatureExtractor'
import { OverheadRaiseFeatureExtractor } from '../src/features/exercises/overheadRaise/FeatureExtractor'
import { ShoulderRotationFeatureExtractor } from '../src/features/exercises/shoulderRotation/FeatureExtractor'
import { SquatFeatureExtractor } from '../src/features/exercises/squat/FeatureExtractor'
import { StepJackFeatureExtractor } from '../src/features/exercises/stepJack/FeatureExtractor'
import { EXERCISE_FRAMING, FRAMING_PROFILES } from '../src/features/framing/framingProfiles'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'

function frame(mutate?: (landmarks: Array<{ x: number; y: number; z: number; visibility: number; presence?: number }>) => void) {
  const source = createDemoPoseFrame(0)
  const landmarks = source.landmarks.map((point) => ({ ...point }))
  mutate?.(landmarks)
  const normalized = normalizePoseFrame({ ...source, landmarks })
  if (!normalized) throw new Error('Fixture should normalize')
  return normalized
}

const upperBodyExtractors = [
  new ShoulderRotationFeatureExtractor(),
  new OverheadRaiseFeatureExtractor(),
  new LateralRaiseFeatureExtractor(),
]

describe('exercise-specific framing profiles', () => {
  it('passes all three upper-body exercises without knees or ankles in frame', () => {
    const cropped = frame((landmarks) => {
      for (const index of [25, 26, 27, 28]) landmarks[index].y = 1.1
    })
    for (const extractor of upperBodyExtractors) expect(extractor.extract(cropped).bodyInFrame).toBe(true)
  })

  it('fails all three upper-body exercises when either hip is outside the frame', () => {
    const missingHip = frame((landmarks) => { landmarks[23].y = 1 })
    for (const extractor of upperBodyExtractors) expect(extractor.extract(missingHip).bodyInFrame).toBe(false)
  })

  it('retains wrist visibility as required quality for all three upper-body exercises', () => {
    const missingWrist = frame((landmarks) => { landmarks[15].visibility = 0 })
    for (const extractor of upperBodyExtractors) expect(extractor.extract(missingWrist).confidence).toBe(0)
  })

  it('fails overhead raise when a raised wrist leaves the upper boundary', () => {
    const wristOutside = frame((landmarks) => { landmarks[15].y = 0.01 })
    expect(new OverheadRaiseFeatureExtractor().extract(wristOutside).bodyInFrame).toBe(false)
  })

  it('keeps Step Jack, Squat, and Knee Raise on full-body bounds', () => {
    const cropped = frame((landmarks) => {
      for (const index of [25, 26, 27, 28]) landmarks[index].y = 1.1
    })
    expect(new StepJackFeatureExtractor().extract(cropped).bodyInFrame).toBe(false)
    expect(new SquatFeatureExtractor().extract(cropped).bodyInFrame).toBe(false)
    expect(new KneeRaiseFeatureExtractor().extract(cropped).bodyInFrame).toBe(false)
  })

  it('maps exactly six exercises to exactly two threshold-free profiles', () => {
    expect(Object.keys(EXERCISE_FRAMING)).toHaveLength(6)
    expect(new Set(Object.values(EXERCISE_FRAMING))).toEqual(new Set(['UPPER_BODY_WITH_HIPS', 'FULL_BODY']))
    expect(Object.keys(FRAMING_PROFILES)).toEqual(['UPPER_BODY', 'UPPER_BODY_WITH_HIPS', 'FULL_BODY'])
    for (const profile of Object.values(FRAMING_PROFILES)) {
      expect(Object.keys(profile)).not.toContain('frameMargin')
      expect(Object.keys(profile)).not.toContain('visibilityThreshold')
    }
  })
})
