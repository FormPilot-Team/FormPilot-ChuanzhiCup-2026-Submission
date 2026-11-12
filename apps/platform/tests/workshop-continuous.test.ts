import { describe, expect, it } from 'vitest'
import { FIXTURE_ASPECT, cyclePosition, standingPose } from '../src/features/workshop/fixture'
import { inferContinuousSuggestion, type VideoPoseSample } from '../src/features/workshop/recognition/continuous'
import { buildPoseMatch } from '../src/features/workshop/recognition/poseMatch'

const samples = (position: (time: number) => number): VideoPoseSample[] => Array.from({ length: 31 }, (_, index) => ({
  seconds: index / 10,
  landmarks: standingPose(8 + 82 * position(index * 100)),
}))

describe('continuous demonstration proposal', () => {
  it('extracts a start, peak, return and usable MediaPipe landmark template from one complete cycle', () => {
    const result = inferContinuousSuggestion(samples(cyclePosition), FIXTURE_ASPECT)
    expect(result.phases.start).toBe(0)
    expect(result.phases.moving).toBeGreaterThan(0.4)
    expect(result.phases.peak).toBeGreaterThan(result.phases.moving)
    expect(result.phases.returned).toBeGreaterThan(result.phases.peak)
    expect(result.suggestedMinRepMs).toBeGreaterThanOrEqual(400)
    expect(buildPoseMatch(result.start, result.finish).model).toBeDefined()
  })

  it('does not propose a template for a still clip or an incomplete return', () => {
    expect(() => inferContinuousSuggestion(samples(() => 0), FIXTURE_ASPECT)).toThrow('未找到明显')
    expect(() => inferContinuousSuggestion(samples((time) => Math.min(1, time / 1400)), FIXTURE_ASPECT)).toThrow('回到开始姿势')
  })
  it('does not stitch a demonstration across missing tracking', () => {
    const broken = samples(cyclePosition).filter((item) => item.seconds < 1.2 || item.seconds > 1.7)
    expect(() => inferContinuousSuggestion(broken, FIXTURE_ASPECT)).toThrow('示范中途')
  })
})
