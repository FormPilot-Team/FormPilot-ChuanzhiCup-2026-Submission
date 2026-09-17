import { describe, expect, it } from 'vitest'
import { createDemoPoseFrame } from '../src/data/demoPose'
import { LateralRaiseFeatureExtractor } from '../src/features/exercises/lateralRaise/FeatureExtractor'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'

function normalized(timestamp: number, mutate?: (landmarks: Array<{ x: number; y: number; z: number; visibility: number; presence?: number }>) => void) {
  const source = createDemoPoseFrame(timestamp)
  const landmarks = source.landmarks.map((point) => ({ ...point }))
  mutate?.(landmarks)
  const frame = normalizePoseFrame({ ...source, landmarks })
  if (!frame) throw new Error('Fixture should normalize')
  return frame
}

describe('LateralRaiseFeatureExtractor', () => {
  it('extracts finite lateral-raise angles and velocity', () => {
    const extractor = new LateralRaiseFeatureExtractor()
    const first = extractor.extract(normalized(0))
    const second = extractor.extract(normalized(400))
    expect(first.shoulderAngleL).toBeGreaterThanOrEqual(0)
    expect(first.elbowAngleL).toBeCloseTo(180)
    expect(Number.isFinite(second.shoulderVelocity)).toBe(true)
    expect(second.shoulderVelocity).toBeGreaterThan(0)
  })

  it('uses minimum required-joint visibility as pose confidence', () => {
    const extractor = new LateralRaiseFeatureExtractor()
    const result = extractor.extract(normalized(0, (landmarks) => { landmarks[15].visibility = 0.42 }))
    expect(result.confidence).toBeCloseTo(0.42)
  })

  it('allows a pose when only a foot is outside the upper-body frame', () => {
    const extractor = new LateralRaiseFeatureExtractor()
    const result = extractor.extract(normalized(0, (landmarks) => { landmarks[27].x = -0.1 }))
    expect(result.bodyInFrame).toBe(true)
  })
})
