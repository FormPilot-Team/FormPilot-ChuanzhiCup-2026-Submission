import { describe, expect, it } from 'vitest'
import type { CourseSnapshot, CourseState } from '../src/features/course/CourseController'
import {
  DEMONSTRATION_SOURCES,
  getDemonstrationSource,
  resolveDemonstrationDirective,
} from '../src/features/demo/demonstrationSources'
import type { ExerciseId } from '../src/features/exercises/types'

function snapshot(state: CourseState, previousState?: CourseState): CourseSnapshot {
  return { state, previousState, stepIndex: 0, countdown: 0, elapsedMs: 0, transitionRemainingMs: 0 }
}

describe('demonstration video source registry', () => {
  const mappings: Array<[ExerciseId, string]> = [
    ['shoulder_rotation', '/assets/demos/shoulder-rotation.mp4'],
    ['overhead_raise', '/assets/demos/overhead-raise.mp4'],
    ['lateral_raise', '/assets/demos/lateral-raise.mp4'],
    ['step_jack', '/assets/demos/step-jack.mp4'],
    ['squat', '/assets/demos/squat.mp4'],
    ['knee_raise', '/assets/demos/alternating-knee-raise.mp4'],
  ]

  it.each(mappings)('maps %s to its expected MP4 source', (exerciseId, src) => {
    expect(DEMONSTRATION_SOURCES[exerciseId]).toMatchObject({ exerciseId, src, type: 'video/mp4' })
  })

  it('returns unavailable for an unregistered exercise at the boundary', () => {
    expect(getDemonstrationSource('not_registered' as ExerciseId)).toBeUndefined()
  })
})

describe('demonstration video playback policy', () => {
  it.each(['PREPARING', 'COUNTDOWN'] as const)('keeps the current exercise visible during %s', (state) => {
    expect(resolveDemonstrationDirective(snapshot(state), 'shoulder_rotation', 'overhead_raise'))
      .toEqual({ exerciseId: 'shoulder_rotation', playback: 'preview' })
  })

  it('plays and loops the current exercise during ACTIVE', () => {
    expect(resolveDemonstrationDirective(snapshot('ACTIVE'), 'overhead_raise'))
      .toEqual({ exerciseId: 'overhead_raise', playback: 'playing' })
  })

  it('pauses the current video during PAUSED', () => {
    expect(resolveDemonstrationDirective(snapshot('PAUSED', 'ACTIVE'), 'lateral_raise'))
      .toEqual({ exerciseId: 'lateral_raise', playback: 'paused' })
  })

  it('preloads the next exercise source during TRANSITION', () => {
    expect(resolveDemonstrationDirective(snapshot('TRANSITION'), 'shoulder_rotation', 'overhead_raise'))
      .toEqual({ exerciseId: 'overhead_raise', playback: 'preview' })
  })

  it('keeps the next source selected when a transition is paused', () => {
    expect(resolveDemonstrationDirective(snapshot('PAUSED', 'TRANSITION'), 'shoulder_rotation', 'overhead_raise'))
      .toEqual({ exerciseId: 'overhead_raise', playback: 'paused' })
  })

  it.each(['COURSE_COMPLETE', 'COURSE_INCOMPLETE'] as const)('stops and resets on %s', (state) => {
    expect(resolveDemonstrationDirective(snapshot(state), 'knee_raise'))
      .toEqual({ exerciseId: 'knee_raise', playback: 'stopped' })
  })
})
