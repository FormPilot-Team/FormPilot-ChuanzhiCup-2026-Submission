import { describe, expect, it } from 'vitest'
import { createStepJackDemoPoseFrame } from '../src/data/demoPose'
import { StepJackFeatureExtractor } from '../src/features/exercises/stepJack/FeatureExtractor'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'

function frame(timestamp: number) {
  const normalized = normalizePoseFrame(createStepJackDemoPoseFrame(timestamp))
  if (!normalized) throw new Error('Demo pose should normalize')
  return normalized
}

describe('StepJackFeatureExtractor', () => {
  it('derives center and open ratios from shared normalized landmarks', () => {
    const extractor = new StepJackFeatureExtractor()
    const center = extractor.extract(frame(0))
    const open = extractor.extract(frame(900))
    expect(center.openRatio).toBeLessThanOrEqual(1.15)
    expect(open.openRatio).toBeGreaterThanOrEqual(1.6)
    expect(open.leftStepOffset).toBeGreaterThan(open.rightStepOffset)
    expect(open.meanShoulderAngle).toBeGreaterThanOrEqual(130)
  })

  it('reports outward leg and arm velocity during opening', () => {
    const extractor = new StepJackFeatureExtractor()
    extractor.extract(frame(200))
    const moving = extractor.extract(frame(500))
    expect(moving.legVelocity).toBeGreaterThan(0)
    expect(moving.armVelocity).toBeGreaterThan(0)
  })
})
