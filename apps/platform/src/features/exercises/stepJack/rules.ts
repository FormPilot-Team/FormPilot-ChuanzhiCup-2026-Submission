import type { StepJackFeatures } from '../../motion/types'
import type { MotionError, MotionErrorCode, RuleResult } from '../types'
import { collectPoseQualityErrors, makeMotionError, sortMotionErrors } from '../errors'
import { STEP_JACK_V1, type StepJackConfig } from './config'
import { calculateStepJackMetrics, weightedStepJackScore } from './scoring'
import type { StepJackStateSnapshot } from './stateMachine'

const PRIORITY: Partial<Record<MotionErrorCode, number>> = {
  POSE_LOW_CONFIDENCE: 100,
  BODY_OUT_OF_FRAME: 99,
  WRONG_SIDE_SEQUENCE: 90,
  INCOMPLETE_RETURN: 80,
  STEP_TOO_SMALL: 70,
  ARM_LEG_UNSYNCED: 60,
  ARM_TOO_LOW: 50,
  BODY_SWAY: 40,
  TOO_FAST: 30,
}

const OPEN_PHASES = new Set(['LEFT_OPENING', 'LEFT_OPEN', 'RIGHT_OPENING', 'RIGHT_OPEN'])
const RETURN_PHASES = new Set(['RETURNING_FROM_LEFT', 'RETURNING_FROM_RIGHT'])

export function evaluateStepJackRules(
  features: StepJackFeatures,
  snapshot: StepJackStateSnapshot,
  config: StepJackConfig = STEP_JACK_V1,
): RuleResult {
  const errors: MotionError[] = collectPoseQualityErrors(features, config.visibilityThreshold, '暂时看不清动作，请调整位置')
  const valid = errors.length === 0
  const rep = snapshot.completedRep
  const shouldJudge = OPEN_PHASES.has(snapshot.phase) || RETURN_PHASES.has(snapshot.phase) || Boolean(rep)
  const peakRatio = rep?.peakOpenRatio ?? snapshot.peakOpenRatio
  const peakArm = rep?.peakMeanShoulderAngle ?? snapshot.peakMeanShoulderAngle
  const armDiff = rep?.maxArmAngleDiff ?? snapshot.maxArmAngleDiff
  const lean = rep?.maxTorsoLean ?? snapshot.maxTorsoLean
  const syncGap = rep?.syncGapMs ?? (snapshot.armOpenAt !== undefined && snapshot.legOpenAt !== undefined ? Math.abs(snapshot.armOpenAt - snapshot.legOpenAt) : undefined)

  if (valid) {
    if (rep?.wrongSideSequence || snapshot.wrongSideSequence) errors.push(makeMotionError('WRONG_SIDE_SEQUENCE', 0.9, '注意左右交替'))
    if (rep?.incompleteReturn || snapshot.incompleteReturn) errors.push(makeMotionError('INCOMPLETE_RETURN', 0.85, '先回到中间位置再进行下一次'))
    if (shouldJudge && peakRatio < config.openMinRatio) errors.push(makeMotionError('STEP_TOO_SMALL', (config.openMinRatio - peakRatio) / 0.6, '侧步再打开一些'))
    const timingUnsynced = syncGap === undefined || syncGap > config.syncAcceptableMs
    const armsUnsynced = armDiff > config.armSymmetryMaxDiff
    if (shouldJudge && (timingUnsynced || armsUnsynced)) {
      const timingSeverity = syncGap === undefined ? 0.7 : (syncGap - config.syncAcceptableMs) / 600
      const armSeverity = (armDiff - config.armSymmetryMaxDiff) / 40
      errors.push(makeMotionError('ARM_LEG_UNSYNCED', Math.max(timingSeverity, armSeverity), timingUnsynced ? '手脚尽量同时打开' : '双臂尽量同步打开'))
    }
    if (shouldJudge && peakArm < config.armTopMinAngle) errors.push(makeMotionError('ARM_TOO_LOW', (config.armTopMinAngle - peakArm) / 60, '手臂再抬高一些'))
    if (shouldJudge && lean > config.torsoLeanMax) errors.push(makeMotionError('BODY_SWAY', (lean - config.torsoLeanMax) / 20, '保持核心稳定，不要左右晃动'))
    if (rep && rep.durationMs < config.repDurationMinMs) errors.push(makeMotionError('TOO_FAST', (config.repDurationMinMs - rep.durationMs) / config.repDurationMinMs, '节奏慢一些，保持动作完整'))
  }

  sortMotionErrors(errors, PRIORITY)
  const metrics = calculateStepJackMetrics(snapshot, features, valid, config)
  return {
    exerciseId: 'step_jack',
    phase: snapshot.phase,
    confidence: features.confidence,
    metrics,
    currentScore: valid ? weightedStepJackScore(metrics) : 0,
    errors,
    primaryFeedback: errors[0],
  }
}
