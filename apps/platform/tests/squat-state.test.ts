import { describe, expect, it } from 'vitest'
import { SQUAT_V1 } from '../src/features/exercises/squat/config'
import { SquatStateMachine } from '../src/features/exercises/squat/stateMachine'
import { squatFeatures } from './helpers/fixtures'

const config = { ...SQUAT_V1, phasePersistenceFrames: 1 }

function drive(machine: SquatStateMachine, frames: Array<Parameters<typeof squatFeatures>[0]>) {
  let state = machine.getSnapshot()
  for (const frame of frames) state = machine.update(squatFeatures(frame))
  return state
}

function standing(timestamp: number) {
  return { timestamp, hipDrop: 0.02, hipVerticalVelocity: 0, baselineReady: true }
}

describe('SquatStateMachine', () => {
  it('walks STANDING → DESCENDING → BOTTOM → ASCENDING → COMPLETE → STANDING', () => {
    const machine = new SquatStateMachine(config)
    expect(drive(machine, [standing(0)]).phase).toBe('STANDING')
    expect(drive(machine, [{ timestamp: 200, hipDrop: 0.1, hipVerticalVelocity: 0.08 }]).phase).toBe('DESCENDING')
    expect(drive(machine, [{ timestamp: 900, hipDrop: 0.22, hipVerticalVelocity: 0.01 }]).phase).toBe('BOTTOM')
    expect(drive(machine, [{ timestamp: 1400, hipDrop: 0.2, hipVerticalVelocity: -0.08 }]).phase).toBe('ASCENDING')
    const complete = drive(machine, [{ timestamp: 3600, hipDrop: 0.04, hipVerticalVelocity: -0.02 }])
    expect(complete.phase).toBe('COMPLETE')
    expect(complete.repCount).toBe(1)
    expect(complete.completedRep).toMatchObject({ exerciseId: 'squat', repIndex: 1, durationMs: 3400 })
    expect(machine.update(squatFeatures(standing(3700))).phase).toBe('STANDING')
  })

  it('lets a shallow squat enter BOTTOM', () => {
    const machine = new SquatStateMachine(config)
    drive(machine, [{ timestamp: 0, hipDrop: 0.1, hipVerticalVelocity: 0.08 }])
    const bottom = drive(machine, [{ timestamp: 500, hipDrop: 0.18, hipVerticalVelocity: 0 }])
    expect(bottom.phase).toBe('BOTTOM')
    expect(bottom.maxHipDrop).toBeLessThan(SQUAT_V1.validDepthHipDrop)
  })

  it('does not count standing jitter as a repetition', () => {
    const machine = new SquatStateMachine(config)
    drive(machine, [
      standing(0),
      { timestamp: 40, hipDrop: 0.03, hipVerticalVelocity: 0.02 },
      { timestamp: 80, hipDrop: 0.01, hipVerticalVelocity: -0.02 },
      standing(120),
    ])
    expect(machine.getSnapshot()).toMatchObject({ phase: 'STANDING', repCount: 0 })
  })

  it('does not count an incomplete return', () => {
    const machine = new SquatStateMachine(config)
    drive(machine, [
      { timestamp: 0, hipDrop: 0.1, hipVerticalVelocity: 0.08 },
      { timestamp: 400, hipDrop: 0.32, hipVerticalVelocity: 0 },
      { timestamp: 800, hipDrop: 0.28, hipVerticalVelocity: -0.08 },
      { timestamp: 1200, hipDrop: 0.2, hipVerticalVelocity: -0.04 },
    ])
    expect(machine.getSnapshot().repCount).toBe(0)
    expect(machine.getSnapshot().phase).toBe('ASCENDING')
  })

  it('freezes phase during temporary confidence loss', () => {
    const machine = new SquatStateMachine(config)
    drive(machine, [{ timestamp: 0, hipDrop: 0.1, hipVerticalVelocity: 0.08 }])
    const lost = drive(machine, [{ timestamp: 200, hipDrop: 0.2, hipVerticalVelocity: 0.01, confidence: 0.2 }])
    expect(lost.phase).toBe('DESCENDING')
    const recovered = drive(machine, [{ timestamp: 400, hipDrop: 0.22, hipVerticalVelocity: 0.01 }])
    expect(recovered.phase).toBe('BOTTOM')
  })

  it('keeps the current phase across a paused timestamp gap', () => {
    const machine = new SquatStateMachine(config)
    drive(machine, [{ timestamp: 0, hipDrop: 0.12, hipVerticalVelocity: 0.08 }])
    const resumed = drive(machine, [{ timestamp: 4000, hipDrop: 0.12, hipVerticalVelocity: 0 }])
    expect(resumed.phase).toBe('DESCENDING')
    expect(resumed.repCount).toBe(0)
  })

  it('stays in STANDING until the standing baseline is ready', () => {
    const machine = new SquatStateMachine(config)
    const state = drive(machine, [{ timestamp: 0, hipDrop: 0.2, hipVerticalVelocity: 0.1, baselineReady: false }])
    expect(state.phase).toBe('STANDING')
    expect(state.repCount).toBe(0)
  })

  it('resets phase and count', () => {
    const machine = new SquatStateMachine(config)
    drive(machine, [
      { timestamp: 0, hipDrop: 0.1, hipVerticalVelocity: 0.08 },
      { timestamp: 500, hipDrop: 0.32, hipVerticalVelocity: 0 },
      { timestamp: 900, hipDrop: 0.2, hipVerticalVelocity: -0.08 },
      { timestamp: 3600, hipDrop: 0.03, hipVerticalVelocity: 0 },
    ])
    expect(machine.getSnapshot().repCount).toBe(1)
    machine.reset()
    expect(machine.getSnapshot()).toMatchObject({ phase: 'STANDING', repCount: 0, baselineReady: false })
  })
})
