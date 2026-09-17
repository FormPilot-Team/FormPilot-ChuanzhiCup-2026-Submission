import type { ShoulderRotationFeatures } from '../../motion/types'
import type { ExerciseEngine } from '../contract'
import { createExerciseEngine } from '../createEngine'
import { getActiveConfig } from '../thresholdVersioning'
import { SHOULDER_ROTATION_V1 } from './config'
import { evaluateShoulderRotationRules } from './rules'
import { ShoulderRotationStateMachine, type ShoulderRotationStateSnapshot } from './stateMachine'

export function createShoulderRotationEngine(config = getActiveConfig('shoulder_rotation', SHOULDER_ROTATION_V1)): ExerciseEngine<ShoulderRotationFeatures, ShoulderRotationStateSnapshot> {
  return createExerciseEngine(new ShoulderRotationStateMachine(config), (features, state) => evaluateShoulderRotationRules(features, state, config))
}
