import { describe, expect, it } from 'vitest'
import { angleDegrees, deriveBodyPoints, normalizeDistance, torsoLeanDegrees } from '../src/features/motion/geometry'
import { point } from './helpers/fixtures'

describe('geometry', () => {
  it('calculates a right angle and a straight elbow', () => {
    expect(angleDegrees(point(1, 0), point(0, 0), point(0, 1))).toBeCloseTo(90)
    expect(angleDegrees(point(-1, 0), point(0, 0), point(1, 0))).toBeCloseTo(180)
  })

  it('normalizes distances against the selected body scale', () => {
    expect(normalizeDistance(0.3, 0.2)).toBeCloseTo(1.5)
    expect(normalizeDistance(1, 0)).toBe(0)
  })

  it('measures torso lean from vertical and derives stable body anchors', () => {
    expect(torsoLeanDegrees(point(0.6, 0.2), point(0.5, 0.6))).toBeCloseTo(14.04, 1)
    const body = deriveBodyPoints(point(0.4, 0.2), point(0.6, 0.2), point(0.42, 0.6), point(0.58, 0.6))
    expect(body.shoulderMid).toMatchObject({ x: 0.5, y: 0.2 })
    expect(body.shoulderWidth).toBeCloseTo(0.2)
    expect(body.torsoLength).toBeCloseTo(0.4)
  })
})
