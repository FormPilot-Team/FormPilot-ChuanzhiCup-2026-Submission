import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getCoachAnimationFrame } from '../src/adapters/coachAnimation/PlaceholderCoachAnimationAdapter'
import { coachMotionMode, resolveCoachMotionMode } from '../src/features/coach/coachMotionPolicy'

describe('Coach Motion asset and state contract', () => {
  it.each(['overhead_raise', 'squat', 'knee_raise'] as const)('animates %s with existing legal frames', (exerciseId) => {
    const frame = getCoachAnimationFrame(exerciseId)
    expect(frame.motionFrames?.length).toBeGreaterThan(2)
    expect(frame.motionFrames!.reduce((total, item) => total + item.durationMs, 0)).toBeGreaterThanOrEqual(2000)
    expect(frame.motionFrames!.reduce((total, item) => total + item.durationMs, 0)).toBeLessThanOrEqual(4000)
    for (const item of frame.motionFrames!) expect(existsSync(path.resolve('public', item.src.slice(1)))).toBe(true)
  })

  it.each(['shoulder_rotation', 'lateral_raise', 'step_jack'] as const)('keeps %s on the static canonical fallback', (exerciseId) => {
    expect(getCoachAnimationFrame(exerciseId).motionFrames).toBeUndefined()
  })

  it('never references the known-invalid Shoulder Rotation placeholder sequence', () => {
    const serialized = JSON.stringify(getCoachAnimationFrame('shoulder_rotation'))
    expect(serialized).not.toContain('shoulder-rotation-demo-')
    expect(serialized).not.toContain('overhead-raise-demo-')
  })

  it('freezes CORRECTING on canonical, resumes for POSITIVE, freezes pause, and plays TRANSITION', () => {
    expect(coachMotionMode('CORRECTING', false)).toBe('static')
    expect(coachMotionMode('POSITIVE', false)).toBe('playing')
    expect(coachMotionMode('ACTIVE', true)).toBe('paused')
    expect(coachMotionMode('TRANSITION', false)).toBe('playing')
  })

  it('uses static output for reduced motion and missing sequences', () => {
    expect(resolveCoachMotionMode('playing', true, true)).toBe('static')
    expect(resolveCoachMotionMode('playing', false, false)).toBe('static')
    expect(resolveCoachMotionMode('paused', true, false)).toBe('paused')
  })
})
