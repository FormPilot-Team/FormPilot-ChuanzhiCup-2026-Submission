import { LATERAL_RAISE_V1 } from './lateralRaise/config'
import { STEP_JACK_V1 } from './stepJack/config'
import { SQUAT_V1 } from './squat/config'
import { KNEE_RAISE_V1 } from './kneeRaise/config'
import type { ExerciseId } from './types'
import { SHOULDER_ROTATION_V1 } from './shoulderRotation/config'
import { OVERHEAD_RAISE_V1 } from './overheadRaise/config'

export const EXERCISE_SPEC_VERSION = 'exercise-rules-v1.0' as const
export const ENGINEERING_THRESHOLD_VERSION = 'engineering-v1' as const
export const CALIBRATION_THRESHOLD_VERSION = 'calibration-v1' as const

export type ThresholdVersion =
  | typeof ENGINEERING_THRESHOLD_VERSION
  | typeof CALIBRATION_THRESHOLD_VERSION

export interface VersionedThresholdSet {
  exerciseId: ExerciseId
  specVersion: string
  thresholdVersion: ThresholdVersion
  status: 'active' | 'proposal'
  basedOn?: ThresholdVersion
  values: Readonly<Record<string, number>>
}

function freezeValues(values: object): Readonly<Record<string, number>> {
  return Object.freeze(Object.fromEntries(Object.entries(values)))
}

function engineeringSet(exerciseId: ExerciseId, values: object): VersionedThresholdSet {
  return Object.freeze({
    exerciseId,
    specVersion: EXERCISE_SPEC_VERSION,
    thresholdVersion: ENGINEERING_THRESHOLD_VERSION,
    status: 'active' as const,
    values: freezeValues(values),
  })
}

const history: Readonly<Record<ExerciseId, ReadonlyArray<VersionedThresholdSet>>> = Object.freeze({
  shoulder_rotation: Object.freeze([engineeringSet('shoulder_rotation', SHOULDER_ROTATION_V1)]),
  overhead_raise: Object.freeze([engineeringSet('overhead_raise', OVERHEAD_RAISE_V1)]),
  lateral_raise: Object.freeze([engineeringSet('lateral_raise', LATERAL_RAISE_V1)]),
  step_jack: Object.freeze([engineeringSet('step_jack', STEP_JACK_V1)]),
  squat: Object.freeze([engineeringSet('squat', SQUAT_V1)]),
  knee_raise: Object.freeze([engineeringSet('knee_raise', KNEE_RAISE_V1)]),
})

export function getThresholdHistory(exerciseId: ExerciseId): ReadonlyArray<VersionedThresholdSet> {
  return history[exerciseId]
}

export function getActiveThresholdSet(exerciseId: ExerciseId): VersionedThresholdSet {
  const active = history[exerciseId].find((entry) => entry.status === 'active')
  if (!active) throw new Error(`No active threshold set for ${exerciseId}`)
  return active
}

export function getActiveConfig<T extends Record<string, number>>(exerciseId: ExerciseId, fallback: T): T {
  return { ...fallback, ...getActiveThresholdSet(exerciseId).values }
}

export function createCalibrationThresholdProposal(
  current: VersionedThresholdSet,
  changes: Readonly<Record<string, number>>,
): VersionedThresholdSet {
  if (current.thresholdVersion !== ENGINEERING_THRESHOLD_VERSION || current.status !== 'active') {
    throw new Error('A calibration-v1 proposal must be based on the active engineering-v1 threshold set')
  }
  const unknownKeys = Object.keys(changes).filter((key) => !(key in current.values))
  if (unknownKeys.length) throw new Error(`Unknown threshold keys: ${unknownKeys.join(', ')}`)
  const invalidValues = Object.entries(changes).filter(([, value]) => !Number.isFinite(value))
  if (invalidValues.length) throw new Error(`Threshold values must be finite: ${invalidValues.map(([key]) => key).join(', ')}`)
  return Object.freeze({
    exerciseId: current.exerciseId,
    specVersion: current.specVersion,
    thresholdVersion: CALIBRATION_THRESHOLD_VERSION,
    status: 'proposal' as const,
    basedOn: ENGINEERING_THRESHOLD_VERSION,
    values: freezeValues({ ...current.values, ...changes }),
  })
}
