import type { ExerciseFeatureExtractor, OverheadRaiseFeatures } from '../../motion/types'
import { extractArmFeatures, extractPoseQuality, finiteDifference } from '../../motion/sharedFeatures'
import type { NormalizedPoseFrame } from '../../pose/PoseNormalizer'
import { LATERAL_RAISE_REQUIRED, UPPER_BODY_WITH_HIPS_BOUNDS } from '../../pose/types'

export class OverheadRaiseFeatureExtractor implements ExerciseFeatureExtractor<OverheadRaiseFeatures> {
  private previous?: { timestamp: number; angle: number }
  reset(): void { this.previous = undefined }
  extract(frame: NormalizedPoseFrame): OverheadRaiseFeatures {
    const arms = extractArmFeatures(frame)
    const quality = extractPoseQuality(frame, LATERAL_RAISE_REQUIRED, .025, UPPER_BODY_WITH_HIPS_BOUNDS)
    const dt = this.previous ? (frame.timestamp - this.previous.timestamp) / 1000 : 0
    const shoulderVelocity = finiteDifference(this.previous?.angle, arms.meanShoulderAngle, dt)
    this.previous = { timestamp: frame.timestamp, angle: arms.meanShoulderAngle }
    return { timestamp: frame.timestamp, source: frame, body: frame.body, ...quality,
      shoulderAngleL: arms.leftShoulderAngle, shoulderAngleR: arms.rightShoulderAngle,
      meanShoulderAngle: arms.meanShoulderAngle, elbowAngleL: arms.leftElbowAngle,
      elbowAngleR: arms.rightElbowAngle, symmetryDiff: arms.armAngleDiff, shoulderVelocity }
  }
}
