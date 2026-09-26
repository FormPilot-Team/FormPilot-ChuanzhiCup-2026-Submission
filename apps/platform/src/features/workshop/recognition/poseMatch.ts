import type { LandmarkName, PoseLandmark } from '../../pose/types'
import type { CapturedPose } from '../types'
import { BODY_LANDMARKS, MIN_VISIBILITY, isUsable, landmark, length, mid, sub, toVec, type Vec2 } from './geometry'

/**
 * "按我的示范姿势": every frame is compared with the user's own recorded start and finish poses. Joints are expressed
 * relative to the hips and scaled by torso length, so standing a little further away or to the side does not count as
 * movement. Progress is the least-squares position of the current pose on the start → finish path, over the joints
 * that actually move between the two poses: 0 at the start pose, 1 at the finish pose.
 */

/** A joint counts as moving when start and finish differ by at least this share of the torso length. */
export const ACTIVE_JOINT_MIN = 0.12
/** Start and finish must differ at least this much in total (largest joint displacement, torso lengths). */
export const MIN_POSE_DIFFERENCE = 0.25
/** Share of the moving joints (by weight) that must be visible to judge a frame. */
export const MIN_VISIBLE_SHARE = 0.6

export type BodyCoords = Partial<Record<LandmarkName, Vec2>>

/** Hip-centred, torso-scaled coordinates of the usable body joints; undefined without shoulders and hips. */
export function bodyCoords(landmarks: ReadonlyArray<PoseLandmark>, aspect: number, minVisibility = MIN_VISIBILITY): BodyCoords | undefined {
  const leftShoulder = landmark(landmarks, 'leftShoulder')
  const rightShoulder = landmark(landmarks, 'rightShoulder')
  const leftHip = landmark(landmarks, 'leftHip')
  const rightHip = landmark(landmarks, 'rightHip')
  if (!isUsable(leftShoulder, minVisibility) || !isUsable(rightShoulder, minVisibility) || !isUsable(leftHip, minVisibility) || !isUsable(rightHip, minVisibility)) return undefined
  const shoulderMid = mid(toVec(leftShoulder, aspect), toVec(rightShoulder, aspect))
  const hipMid = mid(toVec(leftHip, aspect), toVec(rightHip, aspect))
  const scale = length(sub(shoulderMid, hipMid))
  if (!(scale > 1e-4)) return undefined
  const coords: BodyCoords = {}
  for (const name of BODY_LANDMARKS) {
    const point = landmark(landmarks, name)
    if (!isUsable(point, minVisibility)) continue
    const vector = sub(toVec(point, aspect), hipMid)
    coords[name] = { x: vector.x / scale, y: vector.y / scale }
  }
  return coords
}

export interface PoseMatchJoint {
  name: LandmarkName
  start: Vec2
  delta: Vec2
  weight: number
}

export interface PoseMatchModel {
  joints: PoseMatchJoint[]
  totalWeight: number
}

export type PoseMatchIssue = 'not-captured' | 'missing-body' | 'too-similar'

export function buildPoseMatch(start?: CapturedPose, finish?: CapturedPose): { model?: PoseMatchModel; issue?: PoseMatchIssue } {
  if (!start || !finish) return { issue: 'not-captured' }
  const from = bodyCoords(start.landmarks, start.aspect)
  const to = bodyCoords(finish.landmarks, finish.aspect)
  if (!from || !to) return { issue: 'missing-body' }
  const joints: PoseMatchJoint[] = []
  let largest = 0
  for (const name of BODY_LANDMARKS) {
    const a = from[name]
    const b = to[name]
    if (!a || !b) continue
    const delta = sub(b, a)
    const size = length(delta)
    largest = Math.max(largest, size)
    if (size >= ACTIVE_JOINT_MIN) joints.push({ name, start: a, delta, weight: size * size })
  }
  if (largest < MIN_POSE_DIFFERENCE || !joints.length) return { issue: 'too-similar' }
  return { model: { joints, totalWeight: joints.reduce((sum, joint) => sum + joint.weight, 0) } }
}

export interface PoseMatchReading {
  /** 0 = start pose, 1 = finish pose; null when too few moving joints are visible. */
  progress: number | null
  visibleShare: number
  /** How far the pose is off the start → finish path, relative to the path length (0 = on it). */
  deviation: number | null
}

export function readPoseMatch(model: PoseMatchModel, coords: BodyCoords | undefined): PoseMatchReading {
  if (!coords) return { progress: null, visibleShare: 0, deviation: null }
  let numerator = 0
  let visibleWeight = 0
  const visible: PoseMatchJoint[] = []
  for (const joint of model.joints) {
    const current = coords[joint.name]
    if (!current) continue
    const offset = sub(current, joint.start)
    numerator += offset.x * joint.delta.x + offset.y * joint.delta.y
    visibleWeight += joint.weight
    visible.push(joint)
  }
  const visibleShare = model.totalWeight > 0 ? visibleWeight / model.totalWeight : 0
  if (visibleShare < MIN_VISIBLE_SHARE || visibleWeight <= 0) return { progress: null, visibleShare, deviation: null }
  const progress = numerator / visibleWeight
  let residual = 0
  for (const joint of visible) {
    const current = coords[joint.name] as Vec2
    const rx = current.x - joint.start.x - progress * joint.delta.x
    const ry = current.y - joint.start.y - progress * joint.delta.y
    residual += rx * rx + ry * ry
  }
  return { progress, visibleShare, deviation: Math.sqrt(residual / visibleWeight) }
}

/** The moving joints, for "FormPilot 会重点看…". */
export function activeJointNames(model: PoseMatchModel): LandmarkName[] {
  return [...model.joints].sort((left, right) => right.weight - left.weight).map((joint) => joint.name)
}
