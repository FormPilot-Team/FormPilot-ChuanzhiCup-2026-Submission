import { describe, expect, it } from 'vitest'
import { lateralRaiseDefinition } from '../src/features/exercises/lateralRaise/definition'
import { stepJackDefinition } from '../src/features/exercises/stepJack/definition'
import { squatDefinition } from '../src/features/exercises/squat/definition'
import { kneeRaiseDefinition } from '../src/features/exercises/kneeRaise/definition'
import {
  createCalibrationThresholdProposal,
  getActiveThresholdSet,
  getThresholdHistory,
} from '../src/features/exercises/thresholdVersioning'

describe('threshold versioning and migration', () => {
  it('links every current ExerciseDefinition to the frozen engineering version', () => {
    expect(lateralRaiseDefinition).toMatchObject({
      specVersion: 'exercise-rules-v1.0',
      thresholdVersion: 'engineering-v1',
    })
    expect(stepJackDefinition).toMatchObject({
      specVersion: 'exercise-rules-v1.0',
      thresholdVersion: 'engineering-v1',
    })
    expect(squatDefinition).toMatchObject({
      specVersion: 'exercise-rules-v1.0',
      thresholdVersion: 'engineering-v1',
    })
    expect(kneeRaiseDefinition).toMatchObject({ specVersion: 'exercise-rules-v1.0', thresholdVersion: 'engineering-v1' })
    expect(getThresholdHistory('lateral_raise')).toHaveLength(1)
    expect(getThresholdHistory('step_jack')).toHaveLength(1)
    expect(getThresholdHistory('squat')).toHaveLength(1)
    expect(getThresholdHistory('knee_raise')).toHaveLength(1)
    expect(Object.isFrozen(getActiveThresholdSet('lateral_raise').values)).toBe(true)
  })

  it('creates calibration-v1 as an inactive proposal without overwriting engineering-v1', () => {
    const current = getActiveThresholdSet('lateral_raise')
    const originalTopMin = current.values.topMinAngle
    const proposal = createCalibrationThresholdProposal(current, { topMinAngle: 82 })

    expect(proposal).toMatchObject({
      thresholdVersion: 'calibration-v1',
      basedOn: 'engineering-v1',
      status: 'proposal',
    })
    expect(proposal.values.topMinAngle).toBe(82)
    expect(current.values.topMinAngle).toBe(originalTopMin)
    expect(getThresholdHistory('lateral_raise')).toEqual([current])
  })

  it('rejects unknown threshold keys during proposal migration', () => {
    const current = getActiveThresholdSet('step_jack')
    expect(() => createCalibrationThresholdProposal(current, { inventedThreshold: 1 })).toThrow('Unknown threshold keys')
  })
})
