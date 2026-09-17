import type { SquatFeatures } from '../../motion/types'
import type { ExerciseEngine } from '../contract'
import { createExerciseEngine } from '../createEngine'
import { getActiveConfig } from '../thresholdVersioning'
import { SQUAT_V1 } from './config'
import { evaluateSquatRules } from './rules'
import { SquatStateMachine, type SquatStateSnapshot } from './stateMachine'

export type SquatEngine = ExerciseEngine<SquatFeatures, SquatStateSnapshot>

export function createSquatEngine(
  config = getActiveConfig('squat', SQUAT_V1),
): SquatEngine {
  return createExerciseEngine(
    new SquatStateMachine(config),
    (features, state) => evaluateSquatRules(features, state, config),
  )
}
