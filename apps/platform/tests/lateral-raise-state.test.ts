import { describe, expect, it } from 'vitest'
import { LATERAL_RAISE_V1 } from '../src/features/exercises/lateralRaise/config'
import { LateralRaiseStateMachine } from '../src/features/exercises/lateralRaise/stateMachine'
import { features } from './helpers/fixtures'

function repeat(machine: LateralRaiseStateMachine, count: number, factory: (index: number) => ReturnType<typeof features>) {
  let state = machine.getSnapshot()
  for (let index = 0; index < count; index += 1) state = machine.update(factory(index))
  return state
}

describe('LateralRaiseStateMachine', () => {
  it('ignores a one-frame phase spike', () => {
    const machine = new LateralRaiseStateMachine()
    machine.update(features({ meanShoulderAngle: 30, shoulderVelocity: 30 }))
    const state = machine.update(features({ timestamp: 40, meanShoulderAngle: 15, shoulderVelocity: 0 }))
    expect(state.phase).toBe('START')
  })

  it('completes a full persisted cycle and emits one rep summary', () => {
    const machine = new LateralRaiseStateMachine({ ...LATERAL_RAISE_V1, phasePersistenceFrames: 2 })
    expect(repeat(machine, 2, (i) => features({ timestamp: i * 40, meanShoulderAngle: 35, shoulderVelocity: 40 })).phase).toBe('RAISING')
    expect(repeat(machine, 2, (i) => features({ timestamp: 900 + i * 40, meanShoulderAngle: 90, shoulderVelocity: 5 })).phase).toBe('TOP')
    expect(repeat(machine, 2, (i) => features({ timestamp: 1300 + i * 40, meanShoulderAngle: 85, shoulderVelocity: -30 })).phase).toBe('LOWERING')
    const complete = repeat(machine, 2, (i) => features({ timestamp: 2400 + i * 40, meanShoulderAngle: 15, shoulderVelocity: -10 }))
    expect(complete.phase).toBe('COMPLETE')
    expect(complete.repCount).toBe(1)
    expect(complete.completedRep).toMatchObject({ repIndex: 1, topHoldMs: 400 })
    expect(machine.update(features({ timestamp: 2500, meanShoulderAngle: 15 })).phase).toBe('START')
  })

  it('marks a raised but unfinished attempt after the timeout', () => {
    const machine = new LateralRaiseStateMachine({ ...LATERAL_RAISE_V1, phasePersistenceFrames: 1, incompleteTimeoutMs: 500 })
    machine.update(features({ timestamp: 0, meanShoulderAngle: 30, shoulderVelocity: 30 }))
    const state = machine.update(features({ timestamp: 600, meanShoulderAngle: 45, shoulderVelocity: 0 }))
    expect(state.incomplete).toBe(true)
    expect(state.phase).toBe('RAISING')
  })
})
