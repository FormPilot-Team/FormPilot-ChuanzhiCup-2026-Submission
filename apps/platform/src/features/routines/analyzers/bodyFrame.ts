import type { PosePointLike } from '../followAlong/matcher'

/** MediaPipe Pose landmark indices used by the analyzers. */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const

export interface Point {
  x: number
  y: number
}

export interface BodyFrame {
  /** A landmark in aspect-corrected image units (x × width/height, y as is), or null when not visible enough. */
  point(index: number): Point | null
  shoulderMid: Point
  hipMid: Point
  /** Shoulder centre to hip centre. Shrinks when bending towards the camera, so analyzers scale by a robust value over time. */
  torsoLength: number
  shoulderWidth: number
  hipWidth: number
}

/** Same visibility rule as the follow-along matcher and the Scoring v2 metrics. */
export const MIN_LANDMARK_VISIBILITY = 0.5

/**
 * The 2D body seen by the camera, in true proportions. Returns null without both shoulders and both hips, like
 * `describePose` and `computePoseMetric`. Image y grows downwards: “higher” means a smaller y.
 */
export function bodyFrame(landmarks: ReadonlyArray<PosePointLike>, aspect: number, minVisibility = MIN_LANDMARK_VISIBILITY): BodyFrame | null {
  if (!(aspect > 0)) return null
  const point = (index: number): Point | null => {
    const item = landmarks[index]
    if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.y) || (item.visibility ?? 0) < minVisibility) return null
    return { x: item.x * aspect, y: item.y }
  }
  const ls = point(LM.leftShoulder)
  const rs = point(LM.rightShoulder)
  const lh = point(LM.leftHip)
  const rh = point(LM.rightHip)
  if (!ls || !rs || !lh || !rh) return null
  const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
  const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
  const torsoLength = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y)
  if (!(torsoLength > 0)) return null
  return {
    point,
    shoulderMid,
    hipMid,
    torsoLength,
    shoulderWidth: Math.hypot(ls.x - rs.x, ls.y - rs.y),
    hipWidth: Math.hypot(lh.x - rh.x, lh.y - rh.y),
  }
}

/** Trunk lean from vertical in degrees, signed: positive when the shoulders are to the image right of the hips. */
export function trunkSideLeanDegrees(body: BodyFrame): number {
  const dx = body.shoulderMid.x - body.hipMid.x
  const dy = body.hipMid.y - body.shoulderMid.y
  return (Math.atan2(dx, Math.max(dy, 1e-9)) * 180) / Math.PI
}
