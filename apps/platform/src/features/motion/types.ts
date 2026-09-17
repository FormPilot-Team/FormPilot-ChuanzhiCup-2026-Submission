import type { DerivedBodyPoints, PoseFrame } from '../pose/types'

export interface BaseMotionFeatures {
  timestamp: number
  source: PoseFrame
  body: DerivedBodyPoints
  confidence: number
  bodyInFrame: boolean
  torsoLean: number
}

/** Shoulder/elbow features for Lateral Raise. Kept as MotionFeatures for existing tests. */
export interface MotionFeatures extends BaseMotionFeatures {
  shoulderAngleL: number
  shoulderAngleR: number
  meanShoulderAngle: number
  elbowAngleL: number
  elbowAngleR: number
  symmetryDiff: number
  shoulderVelocity: number
}

export type LateralRaiseFeatures = MotionFeatures

export type OverheadRaiseFeatures = MotionFeatures

export interface ShoulderRotationFeatures extends MotionFeatures {
  shoulderVelocityL: number
  shoulderVelocityR: number
  leftExcursion: number
  rightExcursion: number
  motionSync: number
  motionContinuity: number
  moving: boolean
}

export interface StepJackFeatures extends BaseMotionFeatures {
  ankleWidth: number
  hipWidth: number
  openRatio: number
  leftShoulderAngle: number
  rightShoulderAngle: number
  meanShoulderAngle: number
  armAngleDiff: number
  leftStepOffset: number
  rightStepOffset: number
  armVelocity: number
  legVelocity: number
}

export interface SquatFeatures extends BaseMotionFeatures {
  hipMid: DerivedBodyPoints['hipMid']
  shoulderMid: DerivedBodyPoints['shoulderMid']
  torsoLength: number
  currentHipY: number
  standingHipY: number
  standingTorsoLength: number
  standingHipWidth: number
  standingKneeWidth: number
  baselineReady: boolean
  hipDrop: number
  kneeWidth: number
  hipWidth: number
  kneeSpreadRatio: number
  kneeHeightDiff: number
  hipKneeSeparation: number
  hipVerticalVelocity: number
}

export interface KneeRaiseFeatures extends BaseMotionFeatures {
  hipMid: DerivedBodyPoints['hipMid']
  shoulderMid: DerivedBodyPoints['shoulderMid']
  torsoLength: number
  shoulderWidth: number
  baselineReady: boolean
  baselineHipMidX: number
  baselineHipY: number
  baselineTorsoLength: number
  leftKneeHeight: number
  rightKneeHeight: number
  leftKneeTopProximity: number
  rightKneeTopProximity: number
  leftKneeVelocity: number
  rightKneeVelocity: number
  hipHorizontalShift: number
}

export interface ExerciseFeatureExtractor<TFeatures extends BaseMotionFeatures = BaseMotionFeatures> {
  extract(frame: import('../pose/PoseNormalizer').NormalizedPoseFrame): TFeatures
  reset(): void
}
