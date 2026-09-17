import { extractPoseQuality, finiteDifference } from '../../motion/sharedFeatures'
import type { ExerciseFeatureExtractor, KneeRaiseFeatures } from '../../motion/types'
import type { NormalizedPoseFrame } from '../../pose/PoseNormalizer'
import { KNEE_RAISE_REQUIRED, LANDMARK_INDEX } from '../../pose/types'
import { KneeRaiseCenterBaseline } from './baseline'
import { KNEE_RAISE_V1, type KneeRaiseConfig } from './config'

export class KneeRaiseFeatureExtractor implements ExerciseFeatureExtractor<KneeRaiseFeatures> {
  private previous?: { timestamp: number; leftHeight: number; rightHeight: number }
  private readonly baseline: KneeRaiseCenterBaseline
  constructor(private readonly config: KneeRaiseConfig = KNEE_RAISE_V1, private readonly frameMargin = 0.025) {
    this.baseline = new KneeRaiseCenterBaseline(config)
  }
  reset(): void { this.previous = undefined; this.baseline.reset() }

  extract(frame: NormalizedPoseFrame): KneeRaiseFeatures {
    const at = (index: number) => frame.landmarks[index]
    const quality = extractPoseQuality(frame, KNEE_RAISE_REQUIRED, this.frameMargin)
    const { hipMid, shoulderMid } = frame.body
    const torsoLength = Math.max(frame.body.torsoLength, 1e-6)
    const shoulderWidth = Math.max(frame.body.shoulderWidth, 1e-6)
    // Positive means the knee is above its same-side hip; larger is a higher raise.
    const leftKneeHeight = (at(LANDMARK_INDEX.leftHip).y - at(LANDMARK_INDEX.leftKnee).y) / torsoLength
    const rightKneeHeight = (at(LANDMARK_INDEX.rightHip).y - at(LANDMARK_INDEX.rightKnee).y) / torsoLength
    const dt = this.previous ? (frame.timestamp - this.previous.timestamp) / 1000 : 0
    const leftKneeVelocity = finiteDifference(this.previous?.leftHeight, leftKneeHeight, dt)
    const rightKneeVelocity = finiteDifference(this.previous?.rightHeight, rightKneeHeight, dt)
    const baseline = this.baseline.update({
      hipMidX: hipMid.x, hipY: hipMid.y, torsoLength, leftKneeHeight, rightKneeHeight,
      leftKneeVelocity, rightKneeVelocity, confidence: quality.confidence, bodyInFrame: quality.bodyInFrame,
    })
    this.previous = { timestamp: frame.timestamp, leftHeight: leftKneeHeight, rightHeight: rightKneeHeight }
    return {
      timestamp: frame.timestamp, source: frame, body: frame.body, ...quality,
      hipMid, shoulderMid, torsoLength, shoulderWidth,
      baselineReady: baseline.ready, baselineHipMidX: baseline.baselineHipMidX,
      baselineHipY: baseline.baselineHipY, baselineTorsoLength: baseline.baselineTorsoLength,
      leftKneeHeight, rightKneeHeight,
      leftKneeTopProximity: Math.abs(leftKneeHeight - this.config.userTargetHeight),
      rightKneeTopProximity: Math.abs(rightKneeHeight - this.config.userTargetHeight),
      leftKneeVelocity, rightKneeVelocity,
      hipHorizontalShift: baseline.ready ? Math.abs(hipMid.x - baseline.baselineHipMidX) / shoulderWidth : 0,
    }
  }
}
