import { describe, expect, it } from 'vitest'
import { KneeRaiseCenterBaseline } from '../src/features/exercises/kneeRaise/baseline'
import { KNEE_RAISE_V1 } from '../src/features/exercises/kneeRaise/config'
import { KneeRaiseFeatureExtractor } from '../src/features/exercises/kneeRaise/FeatureExtractor'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'
import { LANDMARK_INDEX, type PoseLandmark } from '../src/features/pose/types'

const point = (x: number, y: number, visibility = 0.98): PoseLandmark => ({ x, y, z: 0, visibility, presence: visibility })
function frame(timestamp: number, options: { scale?: number; leftKneeY?: number; rightKneeY?: number; hipShift?: number; visibility?: number } = {}) {
  const s = options.scale ?? 1; const v = options.visibility ?? 0.98; const shift = options.hipShift ?? 0
  const landmarks = Array.from({ length: 33 }, () => point(0.5 * s, 0.5 * s, v))
  Object.assign(landmarks, {
    [LANDMARK_INDEX.nose]: point(0.5*s,0.12*s,v), [LANDMARK_INDEX.leftShoulder]: point(0.42*s,0.3*s,v), [LANDMARK_INDEX.rightShoulder]: point(0.58*s,0.3*s,v),
    [LANDMARK_INDEX.leftHip]: point((0.46+shift)*s,0.54*s,v), [LANDMARK_INDEX.rightHip]: point((0.54+shift)*s,0.54*s,v),
    [LANDMARK_INDEX.leftKnee]: point(0.46*s,(options.leftKneeY??0.74)*s,v), [LANDMARK_INDEX.rightKnee]: point(0.54*s,(options.rightKneeY??0.74)*s,v),
    [LANDMARK_INDEX.leftAnkle]: point(0.46*s,0.92*s,v), [LANDMARK_INDEX.rightAnkle]: point(0.54*s,0.92*s,v),
  })
  return normalizePoseFrame({ timestamp, landmarks, confidence: v })!
}

describe('KneeRaiseFeatureExtractor', () => {
  it('uses a signed height where larger means a higher knee', () => {
    const extractor = new KneeRaiseFeatureExtractor()
    const standing = extractor.extract(frame(0)); const raised = extractor.extract(frame(100, { leftKneeY: 0.52 }))
    expect(standing.leftKneeHeight).toBeLessThan(0); expect(raised.leftKneeHeight).toBeGreaterThan(standing.leftKneeHeight)
  })
  it('keeps left/right heights scale invariant', () => {
    const a = new KneeRaiseFeatureExtractor().extract(frame(0, { leftKneeY: 0.53 }))
    const b = new KneeRaiseFeatureExtractor().extract(frame(0, { leftKneeY: 0.53, scale: 0.75 }))
    expect(b.leftKneeHeight).toBeCloseTo(a.leftKneeHeight, 5); expect(b.rightKneeHeight).toBeCloseTo(a.rightKneeHeight, 5)
  })
  it('measures normalized hip shift after baseline', () => {
    const extractor = new KneeRaiseFeatureExtractor({ ...KNEE_RAISE_V1, baselineStableFrames: 3 })
    for (let i=0;i<3;i+=1) extractor.extract(frame(i*100))
    const moved = extractor.extract(frame(400, { hipShift: 0.04 }))
    expect(moved.baselineReady).toBe(true); expect(moved.hipHorizontalShift).toBeCloseTo(0.25, 1)
  })
  it('mirrors left and right heights', () => {
    const extractor = new KneeRaiseFeatureExtractor()
    const left = extractor.extract(frame(0, { leftKneeY: 0.52 })); extractor.reset()
    const right = extractor.extract(frame(0, { rightKneeY: 0.52 }))
    expect(left.leftKneeHeight).toBeCloseTo(right.rightKneeHeight, 5)
  })
})

describe('KneeRaiseCenterBaseline', () => {
  const sample = (changes: Partial<Parameters<KneeRaiseCenterBaseline['update']>[0]> = {}) => ({ hipMidX: 0.5, hipY: 0.54, torsoLength: 0.24,
    leftKneeHeight: -0.8, rightKneeHeight: -0.8, leftKneeVelocity: 0, rightKneeVelocity: 0, confidence: 0.99, bodyInFrame: true, ...changes })
  it('becomes ready after stable standing frames', () => { const b = new KneeRaiseCenterBaseline({ ...KNEE_RAISE_V1, baselineStableFrames: 3 }); for(let i=0;i<3;i+=1)b.update(sample()); expect(b.snapshot().ready).toBe(true) })
  it('rejects movement and low confidence', () => { const b = new KneeRaiseCenterBaseline({ ...KNEE_RAISE_V1, baselineStableFrames: 2 }); b.update(sample({ leftKneeVelocity: 1 })); b.update(sample({ confidence: 0.2 })); expect(b.snapshot().ready).toBe(false) })
  it('survives temporary visibility loss but resets after the configured window', () => { const b = new KneeRaiseCenterBaseline({ ...KNEE_RAISE_V1, baselineStableFrames: 2, baselineLostFramesToReset: 3 }); b.update(sample()); b.update(sample()); b.update(sample({bodyInFrame:false})); expect(b.snapshot().ready).toBe(true); b.update(sample({bodyInFrame:false})); b.update(sample({bodyInFrame:false})); expect(b.snapshot().ready).toBe(false) })
  it('resets explicitly', () => { const b = new KneeRaiseCenterBaseline({ ...KNEE_RAISE_V1, baselineStableFrames: 1 }); b.update(sample()); b.reset(); expect(b.snapshot().ready).toBe(false) })
})
