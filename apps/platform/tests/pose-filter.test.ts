import { describe, expect, it } from 'vitest'
import { ema, median, PoseFilter } from '../src/features/pose/PoseFilter'
import { poseFrame } from './helpers/fixtures'

describe('PoseFilter', () => {
  it('computes median and EMA primitives', () => {
    expect(median([100, 2, 3, 4, 5])).toBe(4)
    expect(median([1, 3, 5, 7])).toBe(4)
    expect(ema(0, 10, 0.35)).toBeCloseTo(3.5)
  })

  it('rejects a one-frame coordinate spike with a five-frame median', () => {
    const filter = new PoseFilter({ medianWindow: 5, emaAlpha: 1 })
    ;[0.5, 0.5, 9, 0.5, 0.5].forEach((x, index) => filter.push(poseFrame(index, x)))
    expect(filter.push(poseFrame(6, 0.5)).landmarks[0].x).toBe(0.5)
  })

  it('smooths a sustained change instead of jumping to it', () => {
    const filter = new PoseFilter({ medianWindow: 1, emaAlpha: 0.35 })
    filter.push(poseFrame(0, 0))
    const next = filter.push(poseFrame(1, 1))
    expect(next.landmarks[0].x).toBeCloseTo(0.35)
  })
})
