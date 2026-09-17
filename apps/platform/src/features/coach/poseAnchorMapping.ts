import type { PoseAnchorLandmarks, ReferencePose } from '../referencePose/types'
import type { CoachDirection, CoachHighlightRegion } from './types'

export interface CoachHighlightAnchor {
  x: number
  y: number
  direction?: CoachDirection
}

type Point = Pick<CoachHighlightAnchor, 'x' | 'y'>

function point(landmarks: PoseAnchorLandmarks, name: keyof PoseAnchorLandmarks): Point | undefined {
  const value = landmarks[name]
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return undefined
  return { x: value.x, y: value.y }
}

function midpoint(...points: Array<Point | undefined>): Point | undefined {
  const valid = points.filter((value): value is Point => Boolean(value))
  if (!valid.length) return undefined
  return {
    x: valid.reduce((sum, value) => sum + value.x, 0) / valid.length,
    y: valid.reduce((sum, value) => sum + value.y, 0) / valid.length,
  }
}

export function mapCoachHighlightAnchors(
  pose: ReferencePose | undefined,
  region: CoachHighlightRegion,
  direction?: CoachDirection,
): CoachHighlightAnchor[] {
  if (!pose || region === 'none') return []
  const landmarks = pose.landmarks
  const leftShoulder = point(landmarks, 'leftShoulder')
  const rightShoulder = point(landmarks, 'rightShoulder')
  const leftElbow = point(landmarks, 'leftElbow')
  const rightElbow = point(landmarks, 'rightElbow')
  const leftWrist = point(landmarks, 'leftWrist')
  const rightWrist = point(landmarks, 'rightWrist')
  const leftHip = point(landmarks, 'leftHip')
  const rightHip = point(landmarks, 'rightHip')
  const leftKnee = point(landmarks, 'leftKnee')
  const rightKnee = point(landmarks, 'rightKnee')
  const shoulderMid = midpoint(leftShoulder, rightShoulder)
  const hipMid = midpoint(leftHip, rightHip)
  const withDirection = (values: Array<Point | undefined>) => values
    .filter((value): value is Point => Boolean(value))
    .map((value) => ({ ...value, direction }))

  switch (region) {
    case 'left_arm': return withDirection([midpoint(leftShoulder, leftElbow, leftWrist)])
    case 'right_arm': return withDirection([midpoint(rightShoulder, rightElbow, rightWrist)])
    case 'left_elbow': return withDirection([leftElbow])
    case 'right_elbow': return withDirection([rightElbow])
    case 'both_arms': return withDirection([
      midpoint(leftShoulder, leftElbow, leftWrist),
      midpoint(rightShoulder, rightElbow, rightWrist),
    ])
    case 'left_knee': return withDirection([leftKnee])
    case 'right_knee': return withDirection([rightKnee])
    case 'knees': return withDirection([leftKnee, rightKnee])
    case 'hip_depth': return withDirection([hipMid])
    case 'core': return withDirection([midpoint(shoulderMid, hipMid)])
    case 'full_body': return withDirection([midpoint(point(landmarks, 'nose'), leftKnee, rightKnee)])
    default: return []
  }
}
