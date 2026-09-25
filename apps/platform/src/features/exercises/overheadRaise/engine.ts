import type { OverheadRaiseFeatures } from '../../motion/types'
import { DEFAULT_FEEDBACK_POLICY, FeedbackPolicy } from '../../feedback/FeedbackPolicy'
import type { ExerciseEngine } from '../contract'
import { createExerciseEngine } from '../createEngine'
import { getActiveConfig } from '../thresholdVersioning'
import { OVERHEAD_RAISE_V1 } from './config'
import { evaluateOverheadRaiseRules } from './rules'
import { OverheadRaiseStateMachine, type OverheadRaiseStateSnapshot } from './stateMachine'
export function createOverheadRaiseEngine(config = getActiveConfig('overhead_raise', OVERHEAD_RAISE_V1)): ExerciseEngine<OverheadRaiseFeatures, OverheadRaiseStateSnapshot> {
  const feedback = new FeedbackPolicy({
    ...DEFAULT_FEEDBACK_POLICY,
    confirmMsByCode: {
      ELBOW_TOO_BENT_L: config.elbowCorrectionConfirmMs,
      ELBOW_TOO_BENT_R: config.elbowCorrectionConfirmMs,
    },
    recoveryMsByCode: {
      ELBOW_TOO_BENT_L: config.elbowRecoveryMs,
      ELBOW_TOO_BENT_R: config.elbowRecoveryMs,
    },
  })
  return createExerciseEngine(new OverheadRaiseStateMachine(config), (f, s) => evaluateOverheadRaiseRules(f, s, config), feedback)
}
