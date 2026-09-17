import type { BaseMotionFeatures } from '../motion/types'
import type { ExerciseDefinition } from './contract'
import type { ExerciseId, ExerciseState } from './types'
import { EXERCISE_ORDER } from './order'
import { lateralRaiseDefinition } from './lateralRaise/definition'
import { stepJackDefinition } from './stepJack/definition'
import { squatDefinition } from './squat/definition'
import { kneeRaiseDefinition } from './kneeRaise/definition'
import { shoulderRotationDefinition } from './shoulderRotation/definition'
import { overheadRaiseDefinition } from './overheadRaise/definition'
import { createExerciseRuntime, type ExerciseRuntime } from './runtime'

export { EXERCISE_ORDER }

type RegisteredDefinition = ExerciseDefinition<BaseMotionFeatures, ExerciseState>

function register(definition: ExerciseDefinition): RegisteredDefinition {
  return definition as RegisteredDefinition
}

export const exerciseRegistry = new Map<ExerciseId, RegisteredDefinition>([
  ['shoulder_rotation', register(shoulderRotationDefinition)],
  ['overhead_raise', register(overheadRaiseDefinition)],
  ['lateral_raise', register(lateralRaiseDefinition)],
  ['step_jack', register(stepJackDefinition)],
  ['squat', register(squatDefinition)],
  ['knee_raise', register(kneeRaiseDefinition)],
])

export function isRegisteredExerciseId(value: string | null | undefined): value is ExerciseId {
  return Boolean(value) && exerciseRegistry.has(value as ExerciseId)
}

export function getExerciseDefinition(id: ExerciseId): RegisteredDefinition {
  const definition = exerciseRegistry.get(id)
  if (!definition) throw new Error(`Unknown exercise: ${id}`)
  return definition
}

export function createRegisteredRuntime(id: ExerciseId): ExerciseRuntime {
  return createExerciseRuntime(getExerciseDefinition(id))
}
