import type { OverheadRaiseFeatures } from '../../motion/types'
import type { ExerciseEngine } from '../contract'
import { createExerciseEngine } from '../createEngine'
import { getActiveConfig } from '../thresholdVersioning'
import { OVERHEAD_RAISE_V1 } from './config'
import { evaluateOverheadRaiseRules } from './rules'
import { OverheadRaiseStateMachine, type OverheadRaiseStateSnapshot } from './stateMachine'
export function createOverheadRaiseEngine(config = getActiveConfig('overhead_raise', OVERHEAD_RAISE_V1)): ExerciseEngine<OverheadRaiseFeatures, OverheadRaiseStateSnapshot> { return createExerciseEngine(new OverheadRaiseStateMachine(config), (f,s) => evaluateOverheadRaiseRules(f,s,config)) }
