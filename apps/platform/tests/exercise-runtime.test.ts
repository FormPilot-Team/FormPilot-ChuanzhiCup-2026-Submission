import { describe, expect, it } from 'vitest'
import { PhasePersistenceGate } from '../src/features/exercises/phasePersistence'
import { createRegisteredRuntime, getExerciseDefinition } from '../src/features/exercises/registry'
import { LATERAL_RAISE_V1 } from '../src/features/exercises/lateralRaise/config'
import { STEP_JACK_V1 } from '../src/features/exercises/stepJack/config'
import { SQUAT_V1 } from '../src/features/exercises/squat/config'
import { squatDefinition } from '../src/features/exercises/squat/definition'

describe('exercise runtime pairing', () => {
  it('creates a paired extractor and engine for each registered exercise', () => {
    const lateral = createRegisteredRuntime('lateral_raise')
    const step = createRegisteredRuntime('step_jack')
    const squat = createRegisteredRuntime('squat')
    expect(lateral.definition.id).toBe('lateral_raise')
    expect(step.definition.id).toBe('step_jack')
    expect(squat.definition.id).toBe('squat')
    lateral.reset()
    step.reset()
    squat.reset()
  })

  it('keeps presentation notes synchronized with config thresholds', () => {
    const lateral = getExerciseDefinition('lateral_raise').presentation.metrics.find((item) => item.key === 'amplitude')
    const step = getExerciseDefinition('step_jack').presentation.metrics.find((item) => item.key === 'amplitude')
    const squat = getExerciseDefinition('squat').presentation.metrics.find((item) => item.key === 'amplitude')
    expect(lateral?.note).toContain(String(LATERAL_RAISE_V1.topMinAngle))
    expect(lateral?.note).toContain(String(LATERAL_RAISE_V1.topMaxAngle))
    expect(step?.note).toContain(STEP_JACK_V1.openMinRatio.toFixed(2))
    expect(step?.note).toContain(String(STEP_JACK_V1.armTopMinAngle))
    expect(squat?.note).toContain(SQUAT_V1.validDepthHipDrop.toFixed(2))
    expect(squatDefinition.thresholdVersion).toBe('engineering-v1')
  })
})

describe('phase persistence gate', () => {
  it('requires the configured consecutive frames before confirming', () => {
    const gate = new PhasePersistenceGate<'TOP'>()
    expect(gate.confirm('TOP', 3)).toBe(false)
    expect(gate.confirm('TOP', 3)).toBe(false)
    expect(gate.confirm('TOP', 3)).toBe(true)
  })
})
