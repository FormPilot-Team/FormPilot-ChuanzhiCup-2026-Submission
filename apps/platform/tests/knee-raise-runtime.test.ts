import { describe, expect, it } from 'vitest'
import { createKneeRaiseDemoPoseFrame } from '../src/data/demoPose'
import { createRegisteredRuntime } from '../src/features/exercises/registry'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'

describe('Knee Raise Exercise Contract runtime', () => {
  it('processes a full alternating cycle through the registered generic runtime', () => {
    const runtime = createRegisteredRuntime('knee_raise')
    let output: ReturnType<typeof runtime.process> | undefined
    const completedSides: string[] = []
    for (let timestamp = 0; timestamp <= 4100; timestamp += 40) {
      const frame = normalizePoseFrame(createKneeRaiseDemoPoseFrame(timestamp))!
      output = runtime.process(frame)
      if (output.state.completedRep && 'side' in output.state.completedRep) completedSides.push(output.state.completedRep.side)
    }
    expect(runtime.definition.id).toBe('knee_raise')
    expect(completedSides).toEqual(['left', 'right'])
    expect(output?.state.repCount).toBe(2)
    expect('cycleCount' in output!.state ? output!.state.cycleCount : 0).toBe(1)
  })
})
