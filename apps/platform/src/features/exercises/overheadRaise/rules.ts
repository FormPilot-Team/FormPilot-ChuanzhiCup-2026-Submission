import type { OverheadRaiseFeatures } from '../../motion/types'
import { collectPoseQualityErrors, makeMotionError, sortMotionErrors } from '../errors'
import type { MotionError, RuleResult } from '../types'
import { OVERHEAD_RAISE_V1, type OverheadRaiseConfig } from './config'
import { overheadMetrics, overheadWeightedScore } from './scoring'
import type { OverheadRaiseStateSnapshot } from './stateMachine'

export function evaluateOverheadRaiseRules(f: OverheadRaiseFeatures, s: OverheadRaiseStateSnapshot, c: OverheadRaiseConfig = OVERHEAD_RAISE_V1): RuleResult {
  const errors: MotionError[] = collectPoseQualityErrors(f, c.visibilityThreshold, '暂时看不清双臂，请调整位置')
  const valid = !errors.length; const top = s.phase === 'TOP' || s.phase === 'LOWERING' || s.phase === 'COMPLETE'
  if (valid && top) {
    if (Math.min(s.peakShoulderL, s.peakShoulderR) < c.topMinAngle) errors.push(makeMotionError('ARMS_TOO_LOW', .8, '双臂继续举过头顶'))
    if (f.elbowAngleL < c.elbowCorrectionAngle) errors.push(makeMotionError('ELBOW_TOO_BENT_L', (c.elbowCorrectionAngle - f.elbowAngleL) / 45, '左手肘再伸直一些', 'left'))
    if (f.elbowAngleR < c.elbowCorrectionAngle) errors.push(makeMotionError('ELBOW_TOO_BENT_R', (c.elbowCorrectionAngle - f.elbowAngleR) / 45, '右手肘再伸直一些', 'right'))
    if (s.maxSymmetryDiff > c.symmetryMaxDiff) errors.push(makeMotionError('ASYMMETRY', .7, '双臂保持同一高度'))
    if (s.maxTorsoLean > c.torsoLeanMax) errors.push(makeMotionError('TORSO_LEAN', .7, '保持躯干直立'))
  }
  if (s.completedRep && s.completedRep.durationMs < c.repDurationMinMs) errors.push(makeMotionError('TOO_FAST', .7, '放慢速度，控制抬起与下放'))
  if (s.incomplete) errors.push(makeMotionError('INCOMPLETE_REP', .75, '手臂完整举起并回到起始位'))
  sortMotionErrors(errors, { POSE_LOW_CONFIDENCE: 100, BODY_OUT_OF_FRAME: 99, ARMS_TOO_LOW: 80, ELBOW_TOO_BENT_L: 70, ELBOW_TOO_BENT_R: 70, ASYMMETRY: 60, TORSO_LEAN: 50, TOO_FAST: 40, INCOMPLETE_REP: 35 })
  const metrics = overheadMetrics(f, s, valid, c)
  return { exerciseId: 'overhead_raise', phase: s.phase, confidence: f.confidence, metrics, currentScore: valid ? overheadWeightedScore(metrics) : 0, errors, primaryFeedback: errors[0] }
}
