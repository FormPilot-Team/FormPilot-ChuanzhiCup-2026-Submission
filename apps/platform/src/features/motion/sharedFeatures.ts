import { angleDegrees, torsoLeanDegrees } from './geometry'
import { FULL_BODY_BOUNDS, LANDMARK_INDEX, type LandmarkName } from '../pose/types'
import type { NormalizedPoseFrame } from '../pose/PoseNormalizer'

export interface PoseQuality {
  confidence: number
  bodyInFrame: boolean
  torsoLean: number
}

export interface ArmFeatures {
  leftShoulderAngle: number
  rightShoulderAngle: number
  meanShoulderAngle: number
  leftElbowAngle: number
  rightElbowAngle: number
  armAngleDiff: number
}

export function extractPoseQuality(
  frame: NormalizedPoseFrame,
  required: ReadonlyArray<LandmarkName>,
  frameMargin: number,
  framingBounds: ReadonlyArray<LandmarkName> = FULL_BODY_BOUNDS,
): PoseQuality {
  const at = (name: LandmarkName) => frame.landmarks[LANDMARK_INDEX[name]]
  const requiredPoints = required.map(at)
  const bodyBounds = framingBounds.map(at)
  return {
    confidence: Math.min(...requiredPoints.map((point) => point?.visibility ?? 0)),
    bodyInFrame: bodyBounds.every(
      (point) => point && point.x >= frameMargin && point.x <= 1 - frameMargin && point.y >= frameMargin && point.y <= 1 - frameMargin,
    ),
    torsoLean: torsoLeanDegrees(frame.body.shoulderMid, frame.body.hipMid),
  }
}

export function finiteDifference(previous: number | undefined, current: number, dtSeconds: number): number {
  return previous !== undefined && dtSeconds > 0 ? (current - previous) / dtSeconds : 0
}

export function extractArmFeatures(frame: NormalizedPoseFrame): ArmFeatures {
  const at = (index: number) => frame.landmarks[index]
  const leftShoulderAngle = angleDegrees(at(LANDMARK_INDEX.leftHip), at(LANDMARK_INDEX.leftShoulder), at(LANDMARK_INDEX.leftElbow))
  const rightShoulderAngle = angleDegrees(at(LANDMARK_INDEX.rightHip), at(LANDMARK_INDEX.rightShoulder), at(LANDMARK_INDEX.rightElbow))
  const leftElbowAngle = angleDegrees(at(LANDMARK_INDEX.leftShoulder), at(LANDMARK_INDEX.leftElbow), at(LANDMARK_INDEX.leftWrist))
  const rightElbowAngle = angleDegrees(at(LANDMARK_INDEX.rightShoulder), at(LANDMARK_INDEX.rightElbow), at(LANDMARK_INDEX.rightWrist))
  return {
    leftShoulderAngle,
    rightShoulderAngle,
    meanShoulderAngle: (leftShoulderAngle + rightShoulderAngle) / 2,
    leftElbowAngle,
    rightElbowAngle,
    armAngleDiff: Math.abs(leftShoulderAngle - rightShoulderAngle),
  }
}
