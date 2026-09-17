import type { RuleResult } from '../../src/features/exercises/types'
import type { LateralRaiseStateSnapshot } from '../../src/features/exercises/lateralRaise/stateMachine'
import type { KneeRaiseFeatures, MotionFeatures, StepJackFeatures, SquatFeatures } from '../../src/features/motion/types'
import type { DerivedBodyPoints, PoseFrame, PoseLandmark } from '../../src/features/pose/types'

export function point(x = 0, y = 0, visibility = 1): PoseLandmark {
  return { x, y, z: 0, visibility, presence: 1 }
}

export function poseFrame(timestamp = 0, x = 0): PoseFrame {
  return {
    timestamp,
    confidence: 1,
    landmarks: Array.from({ length: 33 }, () => point(x, 0)),
  }
}

const body: DerivedBodyPoints = {
  shoulderMid: point(0.5, 0.3),
  hipMid: point(0.5, 0.6),
  shoulderWidth: 0.2,
  hipWidth: 0.18,
  torsoLength: 0.3,
}

export function features(overrides: Partial<MotionFeatures> = {}): MotionFeatures {
  const timestamp = overrides.timestamp ?? 0
  return {
    timestamp,
    source: poseFrame(timestamp),
    body,
    confidence: 0.99,
    bodyInFrame: true,
    shoulderAngleL: 90,
    shoulderAngleR: 90,
    meanShoulderAngle: 90,
    elbowAngleL: 170,
    elbowAngleR: 170,
    symmetryDiff: 0,
    torsoLean: 0,
    shoulderVelocity: 0,
    ...overrides,
  }
}

export function stepFeatures(overrides: Partial<StepJackFeatures> = {}): StepJackFeatures {
  const timestamp = overrides.timestamp ?? 0
  return {
    timestamp,
    source: poseFrame(timestamp),
    body,
    confidence: 0.99,
    bodyInFrame: true,
    torsoLean: 2,
    ankleWidth: 0.2,
    hipWidth: 0.12,
    openRatio: 1.67,
    leftShoulderAngle: 145,
    rightShoulderAngle: 145,
    meanShoulderAngle: 145,
    armAngleDiff: 0,
    leftStepOffset: 0.8,
    rightStepOffset: 0,
    armVelocity: 0,
    legVelocity: 0,
    ...overrides,
  }
}

export function squatFeatures(overrides: Partial<SquatFeatures> = {}): SquatFeatures {
  const timestamp = overrides.timestamp ?? 0
  return {
    timestamp,
    source: poseFrame(timestamp),
    body,
    confidence: 0.99,
    bodyInFrame: true,
    torsoLean: 2,
    hipMid: body.hipMid,
    shoulderMid: body.shoulderMid,
    torsoLength: 0.3,
    currentHipY: 0.6,
    standingHipY: 0.6,
    standingTorsoLength: 0.3,
    standingHipWidth: 0.18,
    standingKneeWidth: 0.17,
    baselineReady: true,
    hipDrop: 0,
    kneeWidth: 0.17,
    hipWidth: 0.18,
    kneeSpreadRatio: 0.94,
    kneeHeightDiff: 0.01,
    hipKneeSeparation: 1,
    hipVerticalVelocity: 0,
    ...overrides,
  }
}

export function kneeFeatures(overrides: Partial<KneeRaiseFeatures> = {}): KneeRaiseFeatures {
  const timestamp = overrides.timestamp ?? 0
  return {
    timestamp, source: poseFrame(timestamp), body, confidence: 0.99, bodyInFrame: true, torsoLean: 2,
    hipMid: body.hipMid, shoulderMid: body.shoulderMid, torsoLength: 0.3, shoulderWidth: 0.2,
    baselineReady: true, baselineHipMidX: 0.5, baselineHipY: 0.6, baselineTorsoLength: 0.3,
    leftKneeHeight: -0.7, rightKneeHeight: -0.7, leftKneeTopProximity: 0.6, rightKneeTopProximity: 0.6,
    leftKneeVelocity: 0, rightKneeVelocity: 0, hipHorizontalShift: 0.02,
    ...overrides,
  }
}

export function snapshot(overrides: Partial<LateralRaiseStateSnapshot> = {}): LateralRaiseStateSnapshot {
  return {
    phase: 'TOP',
    repCount: 0,
    repStartedAt: 0,
    topEnteredAt: 1000,
    topHoldMs: 300,
    peakShoulderL: 90,
    peakShoulderR: 90,
    minElbowL: 170,
    minElbowR: 170,
    maxSymmetryDiff: 4,
    maxTorsoLean: 2,
    incomplete: false,
    ...overrides,
  }
}

export function ruleResult(errors: RuleResult['errors'] = []): RuleResult {
  const metric = { value: 0, score: 100, valid: true }
  return {
    exerciseId: 'lateral_raise',
    phase: 'TOP',
    confidence: 1,
    metrics: {
      amplitude: metric,
      symmetry: metric,
      stability: metric,
      tempo: metric,
      completion: metric,
    },
    currentScore: 100,
    errors,
    primaryFeedback: errors[0],
  }
}
