import type { KneeRaiseFeatures } from '../../motion/types'
import type { ExerciseEngine } from '../contract'
import { createExerciseEngine } from '../createEngine'
import { getActiveConfig } from '../thresholdVersioning'
import { KNEE_RAISE_V1 } from './config'
import { evaluateKneeRaiseRules } from './rules'
import { KneeRaiseStateMachine, type KneeRaiseStateSnapshot } from './stateMachine'

export type KneeRaiseEngine = ExerciseEngine<KneeRaiseFeatures, KneeRaiseStateSnapshot>
export function createKneeRaiseEngine(config = getActiveConfig('knee_raise', KNEE_RAISE_V1)): KneeRaiseEngine {
  return createExerciseEngine(new KneeRaiseStateMachine(config), (features, state) => evaluateKneeRaiseRules(features, state, config))
}
