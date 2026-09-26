import { LANDMARK_INDEX, type LandmarkName, type PoseLandmark } from '../../pose/types'

/**
 * Workshop-local landmark helpers. MediaPipe can hand back a landmark with a missing or NaN coordinate while it
 * recovers tracking; the workshop treats such a point as absent instead of letting NaN reach its signals. (The
 * warm-up pipeline keeps its own, unchanged, handling.)
 */
export const MIN_VISIBILITY = 0.5

export interface Vec2 {
  x: number
  y: number
}

export function isFinitePoint(point: PoseLandmark | null | undefined): point is PoseLandmark {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.visibility))
}

export function isUsable(point: PoseLandmark | null | undefined, minVisibility = MIN_VISIBILITY): point is PoseLandmark {
  return isFinitePoint(point) && point.visibility >= minVisibility
}

export function landmark(landmarks: ReadonlyArray<PoseLandmark>, name: LandmarkName): PoseLandmark | undefined {
  return landmarks[LANDMARK_INDEX[name]]
}

/** Image coordinates with x scaled by the picture's aspect, so distances and angles are in true proportions. */
export function toVec(point: PoseLandmark, aspect: number): Vec2 {
  return { x: point.x * aspect, y: point.y }
}

export function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function length(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y)
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

/** Angle at `joint` between the segments to `a` and `c`, in degrees (180 = straight). */
export function angleAt(a: Vec2, joint: Vec2, c: Vec2): number {
  const ab = sub(a, joint)
  const cb = sub(c, joint)
  const denominator = length(ab) * length(cb)
  if (denominator < 1e-9) return 180
  const cosine = Math.min(1, Math.max(-1, (ab.x * cb.x + ab.y * cb.y) / denominator))
  return (Math.acos(cosine) * 180) / Math.PI
}

/** Torso lean from vertical in degrees (0 = upright), from shoulder and hip midpoints. */
export function torsoLeanDegrees(shoulderMid: Vec2, hipMid: Vec2): number {
  const dx = Math.abs(shoulderMid.x - hipMid.x)
  const dy = Math.abs(shoulderMid.y - hipMid.y)
  return (Math.atan2(dx, Math.max(dy, 1e-9)) * 180) / Math.PI
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

export interface NamedPoints {
  [name: string]: Vec2 | undefined
}

/** The body's usable points in aspect-corrected coordinates; hidden or broken points are left out. */
export function usablePoints(landmarks: ReadonlyArray<PoseLandmark>, aspect: number, names: ReadonlyArray<LandmarkName>, minVisibility = MIN_VISIBILITY): Partial<Record<LandmarkName, Vec2>> {
  const result: Partial<Record<LandmarkName, Vec2>> = {}
  for (const name of names) {
    const point = landmark(landmarks, name)
    if (isUsable(point, minVisibility)) result[name] = toVec(point, aspect)
  }
  return result
}

export const BODY_LANDMARKS: ReadonlyArray<LandmarkName> = [
  'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist',
  'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
]
