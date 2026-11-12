import { expect, it } from 'vitest'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'
import { createDraftAction } from '../src/features/workshop/definition'
import { FIXTURE_ASPECT, fixtureFrame, standingPose } from '../src/features/workshop/fixture'
import { CustomActionRecognizer } from '../src/features/workshop/recognition/recognizer'
import type { CapturedPose } from '../src/features/workshop/types'

const capture = (degrees: number): CapturedPose => ({
  landmarks: standingPose(degrees),
  aspect: FIXTURE_ASPECT,
  frames: 10,
  capturedAt: '2026-11-11T00:00:00.000Z',
})

it('measures the per-frame pose normalization and recognition cost for E5', () => {
  const start = capture(8)
  const finish = capture(90)
  const action = {
    ...createDraftAction(new Date('2026-11-11T00:00:00Z'), 'custom-e5-performance'),
    name: '侧平举性能样本',
    startPose: { description: '手臂垂下', capture: start },
    finishPose: { description: '手臂抬平', capture: finish },
  }
  const recognizer = new CustomActionRecognizer(action)
  const samples: number[] = []
  let counted = 0
  for (let index = 0; index < 1_000; index += 1) {
    const timestamp = index * 33
    const raw = fixtureFrame('cycle', timestamp, { start, finish })
    const before = performance.now()
    const pose = normalizePoseFrame(raw!)
    const snapshot = recognizer.process(pose, timestamp, FIXTURE_ASPECT)
    if (index >= 100) samples.push(performance.now() - before)
    counted = snapshot.reps
  }
  samples.sort((left, right) => left - right)
  const p50 = samples[Math.floor(samples.length * 0.5)]
  const p95 = samples[Math.floor(samples.length * 0.95)]
  console.info(`E5 recognizer local 900 frames: p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms; counted=${counted}`)
  expect(counted).toBeGreaterThanOrEqual(9)
  expect(Number.isFinite(p95)).toBe(true)
})
