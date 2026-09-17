import type { SquatFeatures } from '../../motion/types'
import type { MotionError, MotionErrorCode, RuleResult } from '../types'
import { collectPoseQualityErrors, makeMotionError, sortMotionErrors } from '../errors'
import { SQUAT_V1, type SquatConfig } from './config'
import { calculateSquatMetrics, weightedSquatScore } from './scoring'
import type { SquatStateSnapshot } from './stateMachine'

const PRIORITY: Partial<Record<MotionErrorCode, number>> = {
  POSE_LOW_CONFIDENCE: 100,
  BODY_OUT_OF_FRAME: 99,
  INCOMPLETE_REP: 90,
  KNEE_VALGUS: 80,
  DEPTH_INSUFFICIENT: 70,
  LEFT_RIGHT_ASYMMETRY: 60,
  TORSO_LATERAL_LEAN: 50,
  TOO_FAST: 40,
}

const JUDGED_PHASES = new Set(['BOTTOM', 'ASCENDING', 'COMPLETE'])

export function evaluateSquatRules(
  features: SquatFeatures,
  snapshot: SquatStateSnapshot,
  config: SquatConfig = SQUAT_V1,
): RuleResult {
  const errors: MotionError[] = collectPoseQualityErrors(features, config.visibilityThreshold, '暂时看不清下半身，请调整位置')
  const valid = errors.length === 0
  const rep = snapshot.completedRep
  const shouldJudge = JUDGED_PHASES.has(snapshot.phase) || Boolean(rep)
  const maxHipDrop = rep?.maxHipDrop ?? snapshot.maxHipDrop
  const minSpread = rep?.minKneeSpreadRatio ?? snapshot.minKneeSpreadRatio
  const heightDiff = rep?.maxKneeHeightDiff ?? snapshot.maxKneeHeightDiff
  const lean = rep?.maxTorsoLean ?? snapshot.maxTorsoLean

  if (valid) {
    if (snapshot.incomplete) errors.push(makeMotionError('INCOMPLETE_REP', 0.85, '请回到完整站立位再开始下一次'))
    if (shouldJudge && minSpread < config.kneeValgusMaxRatio) {
      errors.push(makeMotionError('KNEE_VALGUS', (config.kneeValgusMaxRatio - minSpread) / 0.25, '注意膝盖方向，不要向内夹'))
    }
    if (shouldJudge && maxHipDrop < config.validDepthHipDrop) {
      errors.push(makeMotionError('DEPTH_INSUFFICIENT', (config.validDepthHipDrop - maxHipDrop) / config.validDepthHipDrop, '可以再蹲低一些'))
    }
    if (shouldJudge && heightDiff > config.kneeHeightDiffMax) {
      errors.push(makeMotionError('LEFT_RIGHT_ASYMMETRY', (heightDiff - config.kneeHeightDiffMax) / 0.12, '左右保持稳定，避免重心偏向一侧'))
    }
    if (shouldJudge && lean > config.torsoLeanMax) {
      errors.push(makeMotionError('TORSO_LATERAL_LEAN', (lean - config.torsoLeanMax) / 20, '保持身体居中，不要向一侧倾斜'))
    }
    if (rep && rep.durationMs < config.repDurationMinMs) {
      errors.push(makeMotionError('TOO_FAST', (config.repDurationMinMs - rep.durationMs) / config.repDurationMinMs, '放慢下蹲和起身速度'))
    }
  }

  sortMotionErrors(errors, PRIORITY)
  const metrics = calculateSquatMetrics(snapshot, features, valid, config)
  const codes = errors.map((item) => item.code)
  if (rep) {
    rep.errors = codes
    rep.depthScore = metrics.amplitude.score
    rep.stabilityScore = metrics.stability.score
    rep.symmetryScore = metrics.symmetry.score
    rep.completionScore = metrics.completion.score
    rep.tempoScore = metrics.tempo.score
    rep.overallScore = valid ? weightedSquatScore(metrics) : 0
  }

  return {
    exerciseId: 'squat',
    phase: snapshot.phase,
    confidence: features.confidence,
    metrics,
    currentScore: valid ? weightedSquatScore(metrics) : 0,
    errors,
    primaryFeedback: errors[0],
  }
}
