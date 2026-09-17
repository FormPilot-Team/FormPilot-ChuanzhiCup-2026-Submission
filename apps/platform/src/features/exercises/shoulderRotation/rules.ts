import type { ShoulderRotationFeatures } from '../../motion/types'
import { collectPoseQualityErrors, makeMotionError } from '../errors'
import type { MotionError, RuleResult } from '../types'
import { metricScore } from '../scoring'
import { SHOULDER_ROTATION_V1, type ShoulderRotationConfig } from './config'
import type { ShoulderRotationStateSnapshot } from './stateMachine'

export function evaluateShoulderRotationRules(features: ShoulderRotationFeatures, state: ShoulderRotationStateSnapshot, config: ShoulderRotationConfig = SHOULDER_ROTATION_V1): RuleResult {
  const errors: MotionError[] = collectPoseQualityErrors(features, config.visibilityThreshold, '暂时看不清双臂，请调整位置')
  if (!errors.length && state.phase !== 'READY') {
    if (Math.min(features.leftExcursion, features.rightExcursion) < config.minimumExcursion) errors.push(makeMotionError('MOTION_TOO_SMALL', .7, '肩部环绕幅度再大一些'))
    if (features.motionSync < config.minimumSync) errors.push(makeMotionError('ARMS_UNSYNCED', .65, '双臂保持同步环绕'))
    if (state.paused || features.motionContinuity < config.minimumContinuity) errors.push(makeMotionError('MOTION_PAUSED', .6, '保持连续、平稳地环绕'))
    if (features.torsoLean > config.torsoLeanMax) errors.push(makeMotionError('TORSO_LEAN', .7, '保持躯干直立稳定'))
  }
  const valid = !errors.some((error) => error.code === 'POSE_LOW_CONFIDENCE' || error.code === 'BODY_OUT_OF_FRAME')
  const metrics = {
    amplitude: metricScore(Math.min(features.leftExcursion, features.rightExcursion), Math.min(100, Math.min(features.leftExcursion, features.rightExcursion) / config.minimumExcursion * 100), '°', valid),
    coordination: metricScore(features.motionSync, features.motionSync * 100, '', valid),
    continuity: metricScore(features.motionContinuity, features.motionContinuity * 100, '', valid),
    stability: metricScore(features.torsoLean, Math.max(0, 100 - features.torsoLean / config.torsoLeanMax * 100), '°', valid),
  }
  return { exerciseId: 'shoulder_rotation', phase: state.phase, confidence: features.confidence, metrics, currentScore: 0, errors, primaryFeedback: errors[0] }
}
