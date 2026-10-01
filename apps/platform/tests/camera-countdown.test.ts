import { describe, expect, it } from 'vitest'
import { countdownCue } from '../src/features/course/countdownCue'

describe('camera countdown cue', () => {
  it('shows 3 → 2 → 1 during the course countdown, then 开始 once', () => {
    expect(countdownCue({ state: 'COUNTDOWN', countdown: 3 }, false)).toBe('3')
    expect(countdownCue({ state: 'COUNTDOWN', countdown: 2 }, false)).toBe('2')
    expect(countdownCue({ state: 'COUNTDOWN', countdown: 1 }, false)).toBe('1')
    // The controller reports 0 for an instant before turning ACTIVE, and fractions in fast test mode.
    expect(countdownCue({ state: 'COUNTDOWN', countdown: 0 }, false)).toBe('1')
    expect(countdownCue({ state: 'COUNTDOWN', countdown: 0.1 }, false)).toBe('1')
    expect(countdownCue({ state: 'ACTIVE', countdown: 0 }, true)).toBe('开始')
  })

  it('stays away in every other moment', () => {
    expect(countdownCue(undefined, true)).toBeNull()
    expect(countdownCue({ state: 'ACTIVE', countdown: 0 }, false)).toBeNull()
    for (const state of ['PREPARING', 'PAUSED', 'TRANSITION', 'COURSE_COMPLETE', 'COURSE_INCOMPLETE'] as const) {
      expect(countdownCue({ state, countdown: 3 }, true), state).toBeNull()
    }
  })
})
