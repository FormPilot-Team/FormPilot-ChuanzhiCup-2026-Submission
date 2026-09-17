import { deriveBodyPoints } from '../motion/geometry'
import { LANDMARK_INDEX, type DerivedBodyPoints, type PoseFrame } from './types'

export interface NormalizedPoseFrame extends PoseFrame {
  body: DerivedBodyPoints
}

export function normalizePoseFrame(frame: PoseFrame): NormalizedPoseFrame | null {
  const point = (index: number) => frame.landmarks[index]
  const leftShoulder = point(LANDMARK_INDEX.leftShoulder)
  const rightShoulder = point(LANDMARK_INDEX.rightShoulder)
  const leftHip = point(LANDMARK_INDEX.leftHip)
  const rightHip = point(LANDMARK_INDEX.rightHip)
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null
  const body = deriveBodyPoints(leftShoulder, rightShoulder, leftHip, rightHip)
  if (body.shoulderWidth <= 0 || body.torsoLength <= 0) return null
  return { ...frame, body }
}
