import { describe, expect, it } from 'vitest'
import { mapNormalizedLandmarkToCanvas } from '../src/features/pose/fitMapping'

describe('object-fit landmark mapping', () => {
  it('mirrors and covers the destination the same way overlay drawing does', () => {
    const mapped = mapNormalizedLandmarkToCanvas(0.25, 0.5, {
      destWidth: 200,
      destHeight: 100,
      sourceWidth: 100,
      sourceHeight: 100,
      fit: 'cover',
      mirrored: true,
    })
    expect(mapped.x).toBe(150)
    expect(mapped.y).toBe(50)
  })
})
