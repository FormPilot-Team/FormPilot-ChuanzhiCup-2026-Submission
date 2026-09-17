import type { DerivedBodyPoints, PoseLandmark } from '../pose/types'

const EPSILON = 1e-8

export function distance(a: Pick<PoseLandmark, 'x' | 'y'>, b: Pick<PoseLandmark, 'x' | 'y'>): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function midpoint(a: PoseLandmark, b: PoseLandmark): PoseLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
    presence: Math.min(a.presence ?? 1, b.presence ?? 1),
  }
}

export function angleDegrees(a: PoseLandmark, joint: PoseLandmark, c: PoseLandmark): number {
  const bax = a.x - joint.x
  const bay = a.y - joint.y
  const bcx = c.x - joint.x
  const bcy = c.y - joint.y
  const denominator = Math.hypot(bax, bay) * Math.hypot(bcx, bcy)
  if (denominator < EPSILON) return 0
  const cosine = Math.min(1, Math.max(-1, (bax * bcx + bay * bcy) / denominator))
  return (Math.acos(cosine) * 180) / Math.PI
}

export function torsoLeanDegrees(shoulderMid: PoseLandmark, hipMid: PoseLandmark): number {
  const dx = Math.abs(shoulderMid.x - hipMid.x)
  const dy = Math.abs(shoulderMid.y - hipMid.y)
  return (Math.atan2(dx, Math.max(dy, EPSILON)) * 180) / Math.PI
}

export function deriveBodyPoints(
  leftShoulder: PoseLandmark,
  rightShoulder: PoseLandmark,
  leftHip: PoseLandmark,
  rightHip: PoseLandmark,
): DerivedBodyPoints {
  const shoulderMid = midpoint(leftShoulder, rightShoulder)
  const hipMid = midpoint(leftHip, rightHip)
  return {
    shoulderMid,
    hipMid,
    shoulderWidth: distance(leftShoulder, rightShoulder),
    hipWidth: distance(leftHip, rightHip),
    torsoLength: distance(shoulderMid, hipMid),
  }
}

export function normalizeDistance(value: number, reference: number): number {
  return reference > EPSILON ? value / reference : 0
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}
