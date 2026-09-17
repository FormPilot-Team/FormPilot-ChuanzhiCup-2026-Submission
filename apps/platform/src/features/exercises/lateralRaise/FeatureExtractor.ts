import type { ExerciseFeatureExtractor, MotionFeatures } from '../../motion/types'
import { LATERAL_RAISE_REQUIRED, UPPER_BODY_WITH_HIPS_BOUNDS } from '../../pose/types'
import type { NormalizedPoseFrame } from '../../pose/PoseNormalizer'
import { extractArmFeatures, extractPoseQuality, finiteDifference } from '../../motion/sharedFeatures'

export interface LateralRaiseFeatureExtractorConfig {
  frameMargin: number
}

export class LateralRaiseFeatureExtractor implements ExerciseFeatureExtractor<MotionFeatures> {
  private previous?: { timestamp: number; angle: number }

  constructor(private readonly config: LateralRaiseFeatureExtractorConfig = { frameMargin: 0.025 }) {}

  reset(): void {
    this.previous = undefined
  }

  extract(frame: NormalizedPoseFrame): MotionFeatures {
    const arms = extractArmFeatures(frame)
    const quality = extractPoseQuality(frame, LATERAL_RAISE_REQUIRED, this.config.frameMargin, UPPER_BODY_WITH_HIPS_BOUNDS)
    const meanShoulderAngle = arms.meanShoulderAngle
    const deltaSeconds = this.previous ? (frame.timestamp - this.previous.timestamp) / 1000 : 0
    const shoulderVelocity = finiteDifference(this.previous?.angle, meanShoulderAngle, deltaSeconds)
    this.previous = { timestamp: frame.timestamp, angle: meanShoulderAngle }

    return {
      timestamp: frame.timestamp,
      source: frame,
      body: frame.body,
      ...quality,
      shoulderAngleL: arms.leftShoulderAngle,
      shoulderAngleR: arms.rightShoulderAngle,
      meanShoulderAngle,
      elbowAngleL: arms.leftElbowAngle,
      elbowAngleR: arms.rightElbowAngle,
      symmetryDiff: arms.armAngleDiff,
      shoulderVelocity,
    }
  }
}
