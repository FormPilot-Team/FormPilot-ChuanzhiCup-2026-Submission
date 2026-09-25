import { describe, expect, it } from 'vitest'
import type { CourseState } from '../src/features/course/CourseController'
import { shouldShowPoseOverlay } from '../src/features/pose/poseOverlayVisibility'

describe('shouldShowPoseOverlay', () => {
  it.each([
    ['PREPARING', true],
    ['COUNTDOWN', true],
    ['ACTIVE', false],
    ['PAUSED', false],
    ['TRANSITION', false],
    ['COURSE_COMPLETE', false],
    ['COURSE_INCOMPLETE', false],
  ] satisfies Array<[CourseState, boolean]>)('maps %s visibility to %s', (courseState, expected) => {
    expect(shouldShowPoseOverlay(courseState)).toBe(expected)
  })

  it('preserves the existing overlay behavior outside a resolved course state', () => {
    expect(shouldShowPoseOverlay(undefined)).toBe(true)
  })
})
