import { distance } from '../../motion/geometry'
import { extractPoseQuality, finiteDifference } from '../../motion/sharedFeatures'
import type { ExerciseFeatureExtractor, SquatFeatures } from '../../motion/types'
import type { NormalizedPoseFrame } from '../../pose/PoseNormalizer'
import { LANDMARK_INDEX, SQUAT_REQUIRED } from '../../pose/types'
import { StandingBaseline } from './baseline'
import { SQUAT_V1, type SquatConfig } from './config'

export class SquatFeatureExtractor implements ExerciseFeatureExtractor<SquatFeatures> {
  private previous?: { timestamp: number; hipY: number }
  private readonly baseline: StandingBaseline

  constructor(
    private readonly config: SquatConfig = SQUAT_V1,
    private readonly frameMargin = 0.025,
  ) {
    this.baseline = new StandingBaseline(config)
  }

  reset(): void {
    this.previous = undefined
    this.baseline.reset()
  }

  extract(frame: NormalizedPoseFrame): SquatFeatures {
    const at = (index: number) => frame.landmarks[index]
    const quality = extractPoseQuality(frame, SQUAT_REQUIRED, this.frameMargin)
    const leftKnee = at(LANDMARK_INDEX.leftKnee)
    const rightKnee = at(LANDMARK_INDEX.rightKnee)
    const hipMid = frame.body.hipMid
    const shoulderMid = frame.body.shoulderMid
    const torsoLength = Math.max(frame.body.torsoLength, 1e-6)
    const hipWidth = Math.max(frame.body.hipWidth, 1e-6)
    const kneeWidth = distance(leftKnee, rightKnee)
    const hipKneeSeparation = ((leftKnee.y + rightKnee.y) / 2 - hipMid.y) / torsoLength
    const deltaSeconds = this.previous ? (frame.timestamp - this.previous.timestamp) / 1000 : 0
    const hipVerticalVelocity = finiteDifference(this.previous?.hipY, hipMid.y, deltaSeconds)
    const standing = this.baseline.update({
      hipY: hipMid.y,
      torsoLength,
      hipWidth,
      kneeWidth,
      hipKneeSeparation,
      hipVerticalVelocity,
      confidence: quality.confidence,
      bodyInFrame: quality.bodyInFrame,
    })
    const scale = standing.ready ? Math.max(standing.standingTorsoLength, 1e-6) : torsoLength
    const hipDrop = standing.ready ? (hipMid.y - standing.standingHipY) / scale : 0
    this.previous = { timestamp: frame.timestamp, hipY: hipMid.y }

    return {
      timestamp: frame.timestamp,
      source: frame,
      body: frame.body,
      ...quality,
      hipMid,
      shoulderMid,
      torsoLength,
      currentHipY: hipMid.y,
      standingHipY: standing.standingHipY,
      standingTorsoLength: standing.standingTorsoLength,
      standingHipWidth: standing.standingHipWidth,
      standingKneeWidth: standing.standingKneeWidth,
      baselineReady: standing.ready,
      hipDrop,
      kneeWidth,
      hipWidth,
      kneeSpreadRatio: kneeWidth / hipWidth,
      kneeHeightDiff: Math.abs(leftKnee.y - rightKnee.y) / torsoLength,
      hipKneeSeparation,
      hipVerticalVelocity,
    }
  }
}
