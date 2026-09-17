import type { MotionFeatures } from '../../motion/types'
import type { ExerciseEngine } from '../contract'
import { createExerciseEngine } from '../createEngine'
import { getActiveConfig } from '../thresholdVersioning'
import { LATERAL_RAISE_V1 } from './config'
import { evaluateLateralRaiseRules } from './rules'
import { LateralRaiseStateMachine, type LateralRaiseStateSnapshot } from './stateMachine'

export type LateralRaiseEngine = ExerciseEngine<MotionFeatures, LateralRaiseStateSnapshot>

export function createLateralRaiseEngine(
  config = getActiveConfig('lateral_raise', LATERAL_RAISE_V1),
): LateralRaiseEngine {
  return createExerciseEngine(
    new LateralRaiseStateMachine(config),
    (features, state) => evaluateLateralRaiseRules(features, state, config),
  )
}
