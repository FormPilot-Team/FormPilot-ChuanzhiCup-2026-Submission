import { createGestureDemoPoseFrame } from '../../data/demoPose'
import type { PoseFrame, PoseLandmark } from '../pose/types'
import type { CapturedPose } from './types'

/**
 * DEV-only synthetic "user" for the workshop and custom training pages (`?fixture=synthetic`): a person facing a 16:9
 * camera who holds the start pose, holds the finish pose, or moves between the two. Without recorded poses it performs
 * a lateral arm raise. Nothing here runs in a production build path unless the DEV flag is set by the caller.
 */
export type FixtureMode = 'start' | 'finish' | 'cycle' | 'gesture' | 'none'

export const FIXTURE_ASPECT = 16 / 9
export const FIXTURE_SIZE = Object.freeze({ width: 1280, height: 720 })
/** start hold · rise · finish hold · return · start hold */
export const FIXTURE_CYCLE_MS = [600, 700, 600, 700, 400] as const

const point = (x: number, y: number, visibility = 0.98): PoseLandmark => ({ x, y, z: 0, visibility, presence: visibility })

/** Standing person, arms at `armDegrees` from hanging down (90 = shoulder height), in normalised 16:9 image space. */
export function standingPose(armDegrees: number, aspect = FIXTURE_ASPECT): PoseLandmark[] {
  const cx = 0.5 * aspect
  const at = (x: number, y: number) => point(x / aspect, y)
  const landmarks = Array.from({ length: 33 }, () => point(0.5, 0.45))
  const shoulders = { left: { x: cx + 0.105, y: 0.34 }, right: { x: cx - 0.105, y: 0.34 } }
  const radians = (armDegrees * Math.PI) / 180
  const arm = (shoulder: { x: number; y: number }, direction: 1 | -1) => {
    const elbow = { x: shoulder.x + direction * Math.sin(radians) * 0.15, y: shoulder.y + Math.cos(radians) * 0.15 }
    const wrist = { x: elbow.x + direction * Math.sin(radians) * 0.14, y: elbow.y + Math.cos(radians) * 0.14 }
    return { elbow, wrist }
  }
  const left = arm(shoulders.left, 1)
  const right = arm(shoulders.right, -1)
  const set = (index: number, value: PoseLandmark) => { landmarks[index] = value }
  set(0, at(cx, 0.17))
  // Face points around the nose, hand points at the wrists, foot points at the ankles, as MediaPipe reports them.
  for (let index = 1; index <= 10; index += 1) set(index, at(cx + (index % 2 ? 0.012 : -0.012) * Math.ceil(index / 2), 0.16 + (index > 8 ? 0.025 : 0)))
  set(11, at(shoulders.left.x, shoulders.left.y)); set(12, at(shoulders.right.x, shoulders.right.y))
  set(13, at(left.elbow.x, left.elbow.y)); set(14, at(right.elbow.x, right.elbow.y))
  set(15, at(left.wrist.x, left.wrist.y)); set(16, at(right.wrist.x, right.wrist.y))
  for (const index of [17, 19, 21]) set(index, at(left.wrist.x, left.wrist.y))
  for (const index of [18, 20, 22]) set(index, at(right.wrist.x, right.wrist.y))
  set(23, at(cx + 0.075, 0.58)); set(24, at(cx - 0.075, 0.58))
  set(25, at(cx + 0.08, 0.76)); set(26, at(cx - 0.08, 0.76))
  set(27, at(cx + 0.08, 0.94)); set(28, at(cx - 0.08, 0.94))
  set(29, at(cx + 0.08, 0.955)); set(31, at(cx + 0.1, 0.96))
  set(30, at(cx - 0.08, 0.955)); set(32, at(cx - 0.1, 0.96))
  return landmarks
}

function fromCapture(pose: CapturedPose): PoseLandmark[] {
  return pose.landmarks.map((item) => ({ ...item, presence: item.visibility }))
}

function lerp(from: ReadonlyArray<PoseLandmark>, to: ReadonlyArray<PoseLandmark>, t: number): PoseLandmark[] {
  return from.map((a, index) => {
    const b = to[index] ?? a
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, visibility: Math.min(a.visibility, b.visibility), presence: Math.min(a.presence ?? 1, b.presence ?? 1) }
  })
}

/** 0 → 1 → 0 over one fixture cycle, with holds at both ends. */
export function cyclePosition(timestamp: number): number {
  const total = FIXTURE_CYCLE_MS.reduce((sum, value) => sum + value, 0)
  let t = ((timestamp % total) + total) % total
  const [startHold, rise, finishHold, fall] = FIXTURE_CYCLE_MS
  if (t < startHold) return 0
  t -= startHold
  if (t < rise) return t / rise
  t -= rise
  if (t < finishHold) return 1
  t -= finishHold
  if (t < fall) return 1 - t / fall
  return 0
}

export function fixtureFrame(mode: FixtureMode, timestamp: number, poses: { start?: CapturedPose; finish?: CapturedPose } = {}): PoseFrame | null {
  if (mode === 'none') return null
  const start = poses.start ? fromCapture(poses.start) : standingPose(8)
  const finish = poses.finish ? fromCapture(poses.finish) : standingPose(90)
  if (mode === 'gesture') return createGestureDemoPoseFrame(timestamp, 'start', { timestamp, landmarks: start, confidence: 0.98 })
  const landmarks = mode === 'start' ? start : mode === 'finish' ? finish : lerp(start, finish, cyclePosition(timestamp))
  return { timestamp, landmarks, confidence: 0.98 }
}
