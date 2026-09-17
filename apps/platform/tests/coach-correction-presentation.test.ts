import { describe, expect, it } from 'vitest'
import { COACH_CORRECTIONS } from '../src/features/coach/correctionPresentation'

describe('Coach correction presentation', () => {
  it.each([
    ['lateral_raise', 'ARM_TOO_LOW_R', 'right_arm'],
    ['lateral_raise', 'ELBOW_TOO_BENT_L', 'left_elbow'],
    ['squat', 'DEPTH_INSUFFICIENT', 'hip_depth'],
    ['knee_raise', 'KNEE_TOO_LOW_L', 'left_knee'],
    ['step_jack', 'BODY_SWAY', 'core'],
    ['step_jack', 'POSE_LOW_CONFIDENCE', 'none'],
  ] as const)('maps %s %s to %s', (exerciseId, errorCode, region) => {
    expect(COACH_CORRECTIONS[exerciseId][errorCode]?.highlightRegion).toBe(region)
  })

  it('defines representative correction regions for all six exercises', () => {
    expect(Object.values(COACH_CORRECTIONS).every((mapping) => Object.keys(mapping).length >= 4)).toBe(true)
  })
})
