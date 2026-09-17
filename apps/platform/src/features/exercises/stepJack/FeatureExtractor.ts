import { distance } from '../../motion/geometry'
import { extractArmFeatures, extractPoseQuality, finiteDifference } from '../../motion/sharedFeatures'
import type { ExerciseFeatureExtractor, StepJackFeatures } from '../../motion/types'
import type { NormalizedPoseFrame } from '../../pose/PoseNormalizer'
import { LANDMARK_INDEX, type LandmarkName } from '../../pose/types'

const REQUIRED: ReadonlyArray<LandmarkName> = [
  'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist',
  'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
]

export class StepJackFeatureExtractor implements ExerciseFeatureExtractor<StepJackFeatures> {
  private previous?: { timestamp: number; armAngle: number; openRatio: number }

  constructor(private readonly frameMargin = 0.025) {}

  reset(): void {
    this.previous = undefined
  }

  extract(frame: NormalizedPoseFrame): StepJackFeatures {
    const at = (index: number) => frame.landmarks[index]
    const arms = extractArmFeatures(frame)
    const quality = extractPoseQuality(frame, REQUIRED, this.frameMargin)
    const leftHip = at(LANDMARK_INDEX.leftHip)
    const rightHip = at(LANDMARK_INDEX.rightHip)
    const leftAnkle = at(LANDMARK_INDEX.leftAnkle)
    const rightAnkle = at(LANDMARK_INDEX.rightAnkle)
    const ankleWidth = distance(leftAnkle, rightAnkle)
    const hipWidth = Math.max(frame.body.hipWidth, 1e-6)
    const openRatio = ankleWidth / hipWidth
    const deltaSeconds = this.previous ? (frame.timestamp - this.previous.timestamp) / 1000 : 0
    const armVelocity = finiteDifference(this.previous?.armAngle, arms.meanShoulderAngle, deltaSeconds)
    const legVelocity = finiteDifference(this.previous?.openRatio, openRatio, deltaSeconds)
    this.previous = { timestamp: frame.timestamp, armAngle: arms.meanShoulderAngle, openRatio }

    return {
      timestamp: frame.timestamp,
      source: frame,
      body: frame.body,
      ...quality,
      ankleWidth,
      hipWidth,
      openRatio,
      leftShoulderAngle: arms.leftShoulderAngle,
      rightShoulderAngle: arms.rightShoulderAngle,
      meanShoulderAngle: arms.meanShoulderAngle,
      armAngleDiff: arms.armAngleDiff,
      leftStepOffset: Math.max(0, (leftHip.x - leftAnkle.x) / hipWidth),
      rightStepOffset: Math.max(0, (rightAnkle.x - rightHip.x) / hipWidth),
      armVelocity,
      legVelocity,
    }
  }
}
