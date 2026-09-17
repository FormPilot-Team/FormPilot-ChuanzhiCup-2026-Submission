import type { StepJackFeatures } from '../../motion/types'
import type { ExerciseEngine } from '../contract'
import { createExerciseEngine } from '../createEngine'
import { getActiveConfig } from '../thresholdVersioning'
import { STEP_JACK_V1 } from './config'
import { evaluateStepJackRules } from './rules'
import { StepJackStateMachine, type StepJackStateSnapshot } from './stateMachine'

export type StepJackEngine = ExerciseEngine<StepJackFeatures, StepJackStateSnapshot>

export function createStepJackEngine(
  config = getActiveConfig('step_jack', STEP_JACK_V1),
): StepJackEngine {
  return createExerciseEngine(
    new StepJackStateMachine(config),
    (features, state) => evaluateStepJackRules(features, state, config),
  )
}
