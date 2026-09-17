import type { ExerciseFeatureExtractor, ShoulderRotationFeatures } from '../../motion/types'
import { extractArmFeatures, extractPoseQuality, finiteDifference } from '../../motion/sharedFeatures'
import type { NormalizedPoseFrame } from '../../pose/PoseNormalizer'
import { LATERAL_RAISE_REQUIRED, UPPER_BODY_WITH_HIPS_BOUNDS } from '../../pose/types'
import { SHOULDER_ROTATION_V1, type ShoulderRotationConfig } from './config'

interface Sample { timestamp: number; left: number; right: number; moving: boolean }

export class ShoulderRotationFeatureExtractor implements ExerciseFeatureExtractor<ShoulderRotationFeatures> {
  private previous?: { timestamp: number; left: number; right: number }
  private samples: Sample[] = []

  constructor(private readonly config: ShoulderRotationConfig = SHOULDER_ROTATION_V1) {}

  reset(): void { this.previous = undefined; this.samples = [] }

  extract(frame: NormalizedPoseFrame): ShoulderRotationFeatures {
    const arms = extractArmFeatures(frame)
    const quality = extractPoseQuality(frame, LATERAL_RAISE_REQUIRED, this.config.frameMargin, UPPER_BODY_WITH_HIPS_BOUNDS)
    const dt = this.previous ? (frame.timestamp - this.previous.timestamp) / 1000 : 0
    const shoulderVelocityL = finiteDifference(this.previous?.left, arms.leftShoulderAngle, dt)
    const shoulderVelocityR = finiteDifference(this.previous?.right, arms.rightShoulderAngle, dt)
    const meanVelocity = (shoulderVelocityL + shoulderVelocityR) / 2
    const moving = (Math.abs(shoulderVelocityL) + Math.abs(shoulderVelocityR)) / 2 >= this.config.minimumVelocity
    this.samples.push({ timestamp: frame.timestamp, left: arms.leftShoulderAngle, right: arms.rightShoulderAngle, moving })
    this.samples = this.samples.filter((sample) => frame.timestamp - sample.timestamp <= 1200)
    const leftValues = this.samples.map((sample) => sample.left)
    const rightValues = this.samples.map((sample) => sample.right)
    const leftExcursion = leftValues.length ? Math.max(...leftValues) - Math.min(...leftValues) : 0
    const rightExcursion = rightValues.length ? Math.max(...rightValues) - Math.min(...rightValues) : 0
    const speedMax = Math.max(Math.abs(shoulderVelocityL), Math.abs(shoulderVelocityR), 1)
    const motionSync = Math.max(0, 1 - Math.abs(Math.abs(shoulderVelocityL) - Math.abs(shoulderVelocityR)) / speedMax)
    const motionContinuity = this.samples.length ? this.samples.filter((sample) => sample.moving).length / this.samples.length : 0
    this.previous = { timestamp: frame.timestamp, left: arms.leftShoulderAngle, right: arms.rightShoulderAngle }
    return {
      timestamp: frame.timestamp, source: frame, body: frame.body, ...quality,
      shoulderAngleL: arms.leftShoulderAngle, shoulderAngleR: arms.rightShoulderAngle,
      meanShoulderAngle: arms.meanShoulderAngle, elbowAngleL: arms.leftElbowAngle,
      elbowAngleR: arms.rightElbowAngle, symmetryDiff: arms.armAngleDiff, shoulderVelocity: meanVelocity,
      shoulderVelocityL, shoulderVelocityR, leftExcursion, rightExcursion, motionSync, motionContinuity, moving,
    }
  }
}
