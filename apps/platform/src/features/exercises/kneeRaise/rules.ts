import type { KneeRaiseFeatures } from '../../motion/types'
import { collectPoseQualityErrors, makeMotionError, sortMotionErrors } from '../errors'
import type { MotionError, MotionErrorCode, RuleResult } from '../types'
import { KNEE_RAISE_V1, type KneeRaiseConfig } from './config'
import { calculateKneeRaiseMetrics, weightedKneeRaiseScore } from './scoring'
import type { KneeRaiseStateSnapshot } from './stateMachine'

const PRIORITY: Partial<Record<MotionErrorCode, number>> = {
  POSE_LOW_CONFIDENCE: 100, BODY_OUT_OF_FRAME: 99, INCOMPLETE_RETURN: 90,
  WRONG_SIDE_SEQUENCE: 80, KNEE_TOO_LOW_L: 70, KNEE_TOO_LOW_R: 70,
  BODY_SWAY: 60, LEFT_RIGHT_HEIGHT_GAP: 50, TOO_FAST: 40,
}

export function evaluateKneeRaiseRules(features: KneeRaiseFeatures, state: KneeRaiseStateSnapshot, config: KneeRaiseConfig = KNEE_RAISE_V1): RuleResult {
  const errors: MotionError[] = collectPoseQualityErrors(features, config.visibilityThreshold, '暂时看不清全身，请调整位置')
  const valid = errors.length === 0
  const rep = state.completedRep
  const judged = Boolean(rep) || state.phase.endsWith('_TOP') || state.phase.includes('RETURNING')
  const side = rep?.side ?? state.currentSide
  const peak = rep?.peakKneeHeight ?? state.peakKneeHeight
  if (valid) {
    if (state.incompleteReturn || rep?.incompleteReturn) errors.push(makeMotionError('INCOMPLETE_RETURN', 0.9, '先回到站立位再抬另一侧'))
    if (rep?.wrongSideSequence) errors.push(makeMotionError('WRONG_SIDE_SEQUENCE', 0.85, '注意左右交替'))
    if (judged && side === 'left' && peak < config.userTargetHeight) {
      errors.push(makeMotionError('KNEE_TOO_LOW_L', (config.userTargetHeight - peak) / 0.45, '左膝再抬高一些', 'left'))
    }
    if (judged && side === 'right' && peak < config.userTargetHeight) {
      errors.push(makeMotionError('KNEE_TOO_LOW_R', (config.userTargetHeight - peak) / 0.45, '右膝再抬高一些', 'right'))
    }
    if ((rep?.hipShiftMax ?? state.hipShiftMax) > config.hipShiftMax || (rep?.maxTorsoLean ?? state.maxTorsoLean) > config.torsoLeanMax) {
      errors.push(makeMotionError('BODY_SWAY', 0.7, '保持身体稳定，不要左右晃动'))
    }
    if (state.lastLeftPeak !== undefined && state.lastRightPeak !== undefined
      && Math.abs(state.lastLeftPeak - state.lastRightPeak) > config.peakHeightGapMax) {
      errors.push(makeMotionError('LEFT_RIGHT_HEIGHT_GAP', Math.abs(state.lastLeftPeak - state.lastRightPeak) / 0.3, '两侧尽量抬到相近高度'))
    }
    if (rep && rep.durationMs < config.repDurationMinMs) errors.push(makeMotionError('TOO_FAST', (config.repDurationMinMs - rep.durationMs) / config.repDurationMinMs, '节奏慢一点，保持动作稳定'))
  }
  sortMotionErrors(errors, PRIORITY)
  const metrics = calculateKneeRaiseMetrics(state, features, valid, config)
  if (rep) {
    rep.errors = errors.map((item) => item.code)
    rep.amplitudeScore = metrics.amplitude.score; rep.stabilityScore = metrics.stability.score
    rep.alternationScore = metrics.alternation.score; rep.symmetryScore = metrics.symmetry.score
    rep.tempoScore = metrics.tempo.score; rep.overallScore = valid ? weightedKneeRaiseScore(metrics) : 0
  }
  return { exerciseId: 'knee_raise', phase: state.phase, confidence: features.confidence, metrics,
    currentScore: valid ? weightedKneeRaiseScore(metrics) : 0, errors, primaryFeedback: errors[0] }
}
