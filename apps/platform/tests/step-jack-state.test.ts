import { describe, expect, it } from 'vitest'
import { STEP_JACK_V1 } from '../src/features/exercises/stepJack/config'
import { StepJackStateMachine } from '../src/features/exercises/stepJack/stateMachine'
import { stepFeatures } from './helpers/fixtures'

const config = { ...STEP_JACK_V1, phasePersistenceFrames: 1 }

function completeSide(machine: StepJackStateMachine, side: 'left' | 'right', start: number) {
  const offsets = side === 'left' ? { leftStepOffset: 0.9, rightStepOffset: 0 } : { leftStepOffset: 0, rightStepOffset: 0.9 }
  const opening = machine.update(stepFeatures({ timestamp: start, openRatio: 1.3, legVelocity: 1, meanShoulderAngle: 90, ...offsets }))
  const open = machine.update(stepFeatures({ timestamp: start + 400, openRatio: 1.7, legVelocity: 1, meanShoulderAngle: 145, ...offsets }))
  const returning = machine.update(stepFeatures({ timestamp: start + 800, openRatio: 1.45, legVelocity: -1, meanShoulderAngle: 100, ...offsets }))
  const center = machine.update(stepFeatures({ timestamp: start + 1200, openRatio: 1.05, legVelocity: -1, meanShoulderAngle: 15, leftStepOffset: 0, rightStepOffset: 0 }))
  return { opening, open, returning, center }
}

describe('StepJackStateMachine', () => {
  it('completes CENTER → LEFT_OPEN → CENTER → RIGHT_OPEN → CENTER', () => {
    const machine = new StepJackStateMachine(config)
    const left = completeSide(machine, 'left', 0)
    expect(left.opening.phase).toBe('LEFT_OPENING')
    expect(left.open.phase).toBe('LEFT_OPEN')
    expect(left.returning.phase).toBe('RETURNING_FROM_LEFT')
    expect(left.center).toMatchObject({ phase: 'CENTER', repCount: 1, lastCompletedSide: 'left' })
    expect(left.center.completedRep).toMatchObject({ exerciseId: 'step_jack', side: 'left', durationMs: 1200, syncGapMs: 0 })

    const right = completeSide(machine, 'right', 1500)
    expect(right.open.phase).toBe('RIGHT_OPEN')
    expect(right.center).toMatchObject({ phase: 'CENTER', repCount: 2, lastCompletedSide: 'right' })
    expect(right.center.completedRep?.wrongSideSequence).toBe(false)
  })

  it('flags two consecutive attempts on the same side', () => {
    const machine = new StepJackStateMachine(config)
    completeSide(machine, 'left', 0)
    const repeated = completeSide(machine, 'left', 1500)
    expect(repeated.center.completedRep?.wrongSideSequence).toBe(true)
  })

  it('completes a partial opening so rules can report step too small', () => {
    const machine = new StepJackStateMachine(config)
    machine.update(stepFeatures({ timestamp: 0, openRatio: 1.3, legVelocity: 1, meanShoulderAngle: 80 }))
    expect(machine.update(stepFeatures({ timestamp: 500, openRatio: 1.4, legVelocity: -1, meanShoulderAngle: 100 })).phase).toBe('RETURNING_FROM_LEFT')
    const result = machine.update(stepFeatures({ timestamp: 1200, openRatio: 1.05, legVelocity: -1, meanShoulderAngle: 15 }))
    expect(result.completedRep?.peakOpenRatio).toBeLessThan(1.6)
  })

  it('marks an attempt that does not return to center', () => {
    const machine = new StepJackStateMachine({ ...config, incompleteReturnTimeoutMs: 1000 })
    machine.update(stepFeatures({ timestamp: 0, openRatio: 1.3, legVelocity: 1 }))
    const stale = machine.update(stepFeatures({ timestamp: 1200, openRatio: 1.7, legVelocity: 0 }))
    expect(stale.incompleteReturn).toBe(true)
  })
})
