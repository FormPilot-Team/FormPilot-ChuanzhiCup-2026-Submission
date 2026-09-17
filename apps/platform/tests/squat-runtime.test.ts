import { describe, expect, it } from 'vitest'
import { createSquatDemoPoseFrame } from '../src/data/demoPose'
import { createRegisteredRuntime } from '../src/features/exercises/registry'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'

describe('squat registered runtime', () => {
  it('completes one synthetic squat through extractor and engine', () => {
    const runtime = createRegisteredRuntime('squat')
    const phases = new Set<string>()
    let last = runtime.process(normalizePoseFrame(createSquatDemoPoseFrame(0))!)
    for (let timestamp = 40; timestamp <= 5200; timestamp += 40) {
      const frame = normalizePoseFrame(createSquatDemoPoseFrame(timestamp))
      if (!frame) throw new Error('synthetic squat frame should normalize')
      last = runtime.process(frame)
      phases.add(last.state.phase)
    }
    expect(phases.has('STANDING')).toBe(true)
    expect(phases.has('DESCENDING')).toBe(true)
    expect(phases.has('BOTTOM')).toBe(true)
    expect(phases.has('ASCENDING')).toBe(true)
    expect(phases.has('COMPLETE')).toBe(true)
    expect(last.state.repCount).toBeGreaterThanOrEqual(1)
  })

  it('keeps a shallow synthetic squat valid for correction presentation', () => {
    const runtime = createRegisteredRuntime('squat')
    const errors = new Set<string>()
    const phases = new Set<string>()
    for (let timestamp = 0; timestamp <= 6200; timestamp += 40) {
      const frame = normalizePoseFrame(createSquatDemoPoseFrame(timestamp, .28))
      if (!frame) throw new Error('synthetic squat frame should normalize')
      const output = runtime.process(frame)
      phases.add(output.state.phase)
      output.result.errors.forEach((error) => errors.add(error.code))
    }
    expect([...phases]).toContain('BOTTOM')
    expect([...errors]).toContain('DEPTH_INSUFFICIENT')
  })
})
