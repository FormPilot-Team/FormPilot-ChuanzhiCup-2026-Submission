import { angleDegrees, distance } from '../motion/geometry'
import type { NormalizedPoseFrame } from '../pose/PoseNormalizer'
import { LANDMARK_INDEX, type PoseLandmark } from '../pose/types'

export const GESTURE_VISIBILITY_THRESHOLD = 0.65

const REQUIRED_INDICES = [
  LANDMARK_INDEX.leftShoulder,
  LANDMARK_INDEX.rightShoulder,
  LANDMARK_INDEX.leftElbow,
  LANDMARK_INDEX.rightElbow,
  LANDMARK_INDEX.leftWrist,
  LANDMARK_INDEX.rightWrist,
  LANDMARK_INDEX.leftHip,
  LANDMARK_INDEX.rightHip,
] as const

function requiredLandmarksAreVisible(pose: NormalizedPoseFrame): boolean {
  return pose.confidence >= GESTURE_VISIBILITY_THRESHOLD
    && REQUIRED_INDICES.every((index) => {
      const landmark = pose.landmarks[index]
      return landmark && landmark.visibility >= GESTURE_VISIBILITY_THRESHOLD && (landmark.presence ?? 1) >= GESTURE_VISIBILITY_THRESHOLD
    })
}

function isWithinChestHeight(point: Pick<PoseLandmark, 'y'>, pose: NormalizedPoseFrame): boolean {
  const top = pose.body.shoulderMid.y + pose.body.torsoLength * 0.08
  const bottom = pose.body.hipMid.y - pose.body.torsoLength * 0.12
  return point.y >= Math.min(top, bottom) && point.y <= Math.max(top, bottom)
}

function midpoint2d(a: PoseLandmark, b: PoseLandmark): Pick<PoseLandmark, 'x' | 'y'> {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function detectStartGesture(pose: NormalizedPoseFrame): boolean {
  if (!requiredLandmarksAreVisible(pose)) return false
  const leftShoulder = pose.landmarks[LANDMARK_INDEX.leftShoulder]
  const rightShoulder = pose.landmarks[LANDMARK_INDEX.rightShoulder]
  const leftElbow = pose.landmarks[LANDMARK_INDEX.leftElbow]
  const rightElbow = pose.landmarks[LANDMARK_INDEX.rightElbow]
  const leftWrist = pose.landmarks[LANDMARK_INDEX.leftWrist]
  const rightWrist = pose.landmarks[LANDMARK_INDEX.rightWrist]
  const wristMid = midpoint2d(leftWrist, rightWrist)
  const leftElbowAngle = angleDegrees(leftShoulder, leftElbow, leftWrist)
  const rightElbowAngle = angleDegrees(rightShoulder, rightElbow, rightWrist)
  const wristDistanceRatio = distance(leftWrist, rightWrist) / pose.body.shoulderWidth
  const wristCenterOffset = Math.abs(wristMid.x - pose.body.shoulderMid.x) / pose.body.shoulderWidth

  return wristDistanceRatio <= 0.45
    && wristCenterOffset <= 0.45
    && isWithinChestHeight(wristMid, pose)
    && leftElbowAngle >= 35 && leftElbowAngle <= 135
    && rightElbowAngle >= 35 && rightElbowAngle <= 135
}

export function detectPauseGesture(pose: NormalizedPoseFrame): boolean {
  if (!requiredLandmarksAreVisible(pose)) return false
  const leftShoulder = pose.landmarks[LANDMARK_INDEX.leftShoulder]
  const rightShoulder = pose.landmarks[LANDMARK_INDEX.rightShoulder]
  const leftElbow = pose.landmarks[LANDMARK_INDEX.leftElbow]
  const rightElbow = pose.landmarks[LANDMARK_INDEX.rightElbow]
  const leftWrist = pose.landmarks[LANDMARK_INDEX.leftWrist]
  const rightWrist = pose.landmarks[LANDMARK_INDEX.rightWrist]
  const centerX = pose.body.shoulderMid.x
  const leftSide = Math.sign(leftShoulder.x - centerX)
  const rightSide = Math.sign(rightShoulder.x - centerX)
  if (!leftSide || !rightSide || leftSide === rightSide) return false

  const crossingMargin = pose.body.shoulderWidth * 0.08
  const leftCrossed = (leftWrist.x - centerX) * leftSide < -crossingMargin
  const rightCrossed = (rightWrist.x - centerX) * rightSide < -crossingMargin
  const leftElbowOwnSide = (leftElbow.x - centerX) * leftSide > 0
  const rightElbowOwnSide = (rightElbow.x - centerX) * rightSide > 0
  const wristsNearChest = isWithinChestHeight(leftWrist, pose) && isWithinChestHeight(rightWrist, pose)
  const elbowsNearChest = isWithinChestHeight(leftElbow, pose) && isWithinChestHeight(rightElbow, pose)
  const wristSeparationRatio = distance(leftWrist, rightWrist) / pose.body.shoulderWidth

  return leftCrossed && rightCrossed
    && leftElbowOwnSide && rightElbowOwnSide
    && wristsNearChest && elbowsNearChest
    && wristSeparationRatio <= 0.95
}
