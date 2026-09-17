import type { MotionFeatures } from '../../motion/types'
import type { MotionError, MotionErrorCode, RuleResult } from '../types'
import { collectPoseQualityErrors, makeMotionError, sortMotionErrors } from '../errors'
import { LATERAL_RAISE_V1, type LateralRaiseConfig } from './config'
import { calculateMetrics, weightedScore } from './scoring'
import type { LateralRaiseStateSnapshot } from './stateMachine'

const ERROR_PRIORITY: Partial<Record<MotionErrorCode, number>> = {
  POSE_LOW_CONFIDENCE: 100,
  BODY_OUT_OF_FRAME: 99,
  ARM_TOO_LOW_L: 80,
  ARM_TOO_LOW_R: 80,
  ASYMMETRY: 70,
  ELBOW_TOO_BENT_L: 60,
  ELBOW_TOO_BENT_R: 60,
  TORSO_LEAN: 50,
  TOO_FAST: 40,
  INCOMPLETE_REP: 35,
}

export function evaluateLateralRaiseRules(
  features: MotionFeatures,
  snapshot: LateralRaiseStateSnapshot,
  config: LateralRaiseConfig = LATERAL_RAISE_V1,
): RuleResult {
  const errors: MotionError[] = collectPoseQualityErrors(features, config.visibilityThreshold, '暂时看不清手臂，请调整位置')
  const valid = errors.length === 0
  const metrics = calculateMetrics(
    snapshot,
    {
      shoulderL: features.shoulderAngleL,
      shoulderR: features.shoulderAngleR,
      symmetry: features.symmetryDiff,
      torsoLean: features.torsoLean,
      timestamp: features.timestamp,
    },
    valid,
    config,
  )

  if (valid) {
    const shouldJudgeTop = snapshot.phase === 'TOP' || snapshot.phase === 'LOWERING' || snapshot.phase === 'COMPLETE'
    if (shouldJudgeTop) {
      const leftPeak = snapshot.completedRep?.peakShoulderL ?? snapshot.peakShoulderL
      const rightPeak = snapshot.completedRep?.peakShoulderR ?? snapshot.peakShoulderR
      const leftElbow = snapshot.completedRep?.minElbowL ?? snapshot.minElbowL
      const rightElbow = snapshot.completedRep?.minElbowR ?? snapshot.minElbowR
      const symmetry = snapshot.completedRep?.maxSymmetryDiff ?? snapshot.maxSymmetryDiff
      const torsoLean = snapshot.completedRep?.maxTorsoLean ?? snapshot.maxTorsoLean
      if (leftPeak < config.topMinAngle)
        errors.push(makeMotionError('ARM_TOO_LOW_L', (config.topMinAngle - leftPeak) / 30, '左臂再抬高一些', 'left'))
      if (rightPeak < config.topMinAngle)
        errors.push(makeMotionError('ARM_TOO_LOW_R', (config.topMinAngle - rightPeak) / 30, '右臂再抬高一些', 'right'))
      if (symmetry > config.symmetryMaxDiff)
        errors.push(makeMotionError('ASYMMETRY', (symmetry - config.symmetryMaxDiff) / 30, '两侧尽量保持同一高度'))
      if (leftElbow < config.elbowMinAngle)
        errors.push(makeMotionError('ELBOW_TOO_BENT_L', (config.elbowMinAngle - leftElbow) / 45, '左手肘再伸直一些', 'left'))
      if (rightElbow < config.elbowMinAngle)
        errors.push(makeMotionError('ELBOW_TOO_BENT_R', (config.elbowMinAngle - rightElbow) / 45, '右手肘再伸直一些', 'right'))
      if (torsoLean > config.torsoLeanMax)
        errors.push(makeMotionError('TORSO_LEAN', (torsoLean - config.torsoLeanMax) / 20, '保持身体直立，不要侧倾借力'))
    }
    if (snapshot.completedRep && snapshot.completedRep.durationMs < config.repDurationMinMs)
      errors.push(makeMotionError('TOO_FAST', (config.repDurationMinMs - snapshot.completedRep.durationMs) / config.repDurationMinMs, '放慢一点，控制动作节奏'))
    if (snapshot.incomplete) errors.push(makeMotionError('INCOMPLETE_REP', 0.85, '完成完整动作后再开始下一次'))
  }

  sortMotionErrors(errors, ERROR_PRIORITY)
  return {
    exerciseId: 'lateral_raise',
    phase: snapshot.phase,
    confidence: features.confidence,
    metrics,
    currentScore: valid ? weightedScore(metrics) : 0,
    errors,
    primaryFeedback: errors[0],
  }
}
