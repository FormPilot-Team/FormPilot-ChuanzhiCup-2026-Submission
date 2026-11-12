import { describe, expect, it } from 'vitest'
import { createDraftAction } from '../src/features/workshop/definition'
import { FIXTURE_ASPECT, cyclePosition, standingPose } from '../src/features/workshop/fixture'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'
import { CustomActionRecognizer } from '../src/features/workshop/recognition/recognizer'
import { ThreeStagePrototype } from '../src/features/workshop/recognition/temporalPrototype'
import type { CapturedPose, CustomActionDefinition } from '../src/features/workshop/types'
import type { PoseLandmark } from '../src/features/pose/types'

const captured = (landmarks: PoseLandmark[]): CapturedPose => ({ landmarks, aspect: FIXTURE_ASPECT, frames: 1, capturedAt: '2026-11-11T00:00:00Z' })
const action = (): CustomActionDefinition => ({ ...createDraftAction(), name: '侧平举', startPose: { description: '', capture: captured(standingPose(8)) }, finishPose: { description: '', capture: captured(standingPose(90)) } })

function compare(poseAt: (time: number) => PoseLandmark[] | null, end: number): { baseline: number; temporal: number; warnings: string[] } {
  const baseline = new CustomActionRecognizer(action(), false)
  const temporal = new CustomActionRecognizer(action())
  const warnings: string[] = []
  let oldReps = 0; let newReps = 0
  for (let time = 0; time <= end; time += 33) {
    const pose = poseAt(time)
    const frame = pose ? normalizePoseFrame({ timestamp: time, landmarks: pose, confidence: 0.98 }) : null
    oldReps = baseline.process(frame, time, FIXTURE_ASPECT).reps
    const next = temporal.process(frame, time, FIXTURE_ASPECT)
    newReps = next.reps
    if (next.feedback?.code === 'SHORT_OCCLUSION') warnings.push(next.feedback.code)
  }
  return { baseline: oldReps, temporal: newReps, warnings }
}

describe('temporal recognition comparison on identical synthetic keypoint streams', () => {
  it('keeps normal and different-speed full cycles', () => {
    for (const speed of [0.5, 1, 1.5]) {
      const result = compare((time) => standingPose(8 + 82 * cyclePosition(time * speed)), Math.ceil(3000 / speed))
      expect(result).toMatchObject({ baseline: 1, temporal: 1 })
    }
  })

  it('recovers a brief occlusion only when the pose is continuous', () => {
    const result = compare((time) => time >= 1485 && time < 1584 ? null : standingPose(8 + 82 * cyclePosition(time)), 3000)
    expect(result).toMatchObject({ baseline: 0, temporal: 1 })
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('rejects a jump from the peak to the start during occlusion', () => {
    const result = compare((time) => time < 1300 ? standingPose(8 + 82 * Math.min(1, time / 1000)) : time < 1400 ? null : standingPose(8), 2300)
    expect(result).toMatchObject({ baseline: 0, temporal: 0 })
  })

  it('rejects incomplete and reverse-only motion', () => {
    const incomplete = compare((time) => standingPose(8 + 35 * cyclePosition(time)), 3000)
    const reverse = compare((time) => standingPose(time < 500 ? 90 : 8), 1300)
    expect(incomplete.temporal).toBe(0)
    expect(reverse.temporal).toBe(0)
  })

  it('preserves the existing off-path rejection', () => {
    const result = compare((time) => {
      const start = standingPose(8)
      const bent = standingPose(90)
      for (const [elbow, wrist] of [[13, 15], [14, 16]] as const) bent[wrist] = { ...bent[elbow], y: bent[elbow].y - 0.14 }
      const progress = cyclePosition(time)
      return start.map((point, index) => ({ ...point, x: point.x + (bent[index].x - point.x) * progress, y: point.y + (bent[index].y - point.y) * progress }))
    }, 3000)
    expect(result.temporal).toBe(0)
  })
})

describe('isolated three-stage prototype', () => {
  const runStages = (degrees: number[]) => {
    const pilot = new ThreeStagePrototype(captured(standingPose(8)), captured(standingPose(90)), captured(standingPose(170)))
    let count = 0
    for (const degree of degrees) for (let frame = 0; frame < 3; frame += 1) count = pilot.push(standingPose(degree), FIXTURE_ASPECT)
    return count
  }
  it('requires ordered middle and finish stages on the outward and return paths', () => {
    expect(runStages([8, 90, 170, 90, 8])).toBe(1)
    expect(runStages([8, 170, 8])).toBe(0)
    expect(runStages([8, 90, 8])).toBe(0)
  })
})
