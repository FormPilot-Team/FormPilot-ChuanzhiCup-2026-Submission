/**
 * Side-agnostic 2D pose metrics shared by the standard video's pose track (to find phase windows) and the user's
 * live pose (to check a criterion inside those windows). Every metric is defined so that following the video as
 * in a mirror gives the same value, and returns null when a landmark it needs is not visible enough.
 *
 * Coordinates are image-normalised (0..1); x is multiplied by the image aspect (width / height) first so angles
 * and distances are in true proportions. Lengths are in torso lengths (shoulder centre to hip centre).
 */
export interface MetricPoint {
  x: number
  y: number
  visibility?: number
}

export interface MetricPose {
  landmarks: ReadonlyArray<MetricPoint>
  /** Source image width / height. */
  aspect: number
}

export type PoseMetricId =
  | 'elbowAngleMin'
  | 'elbowAngleMax'
  | 'wristsAboveHead'
  | 'raisedWristAboveShoulder'
  | 'loweredWristBelowShoulder'
  | 'wristHeightGap'
  | 'armsLevelDeviation'
  | 'upperArmFromVertical'
  | 'raisedWristLateralOffset'
  | 'armAbduction'
  | 'shoulderAngleGap'
  | 'torsoLean'
  | 'shoulderTilt'
  | 'kneeAngleMean'
  | 'kneeAngleMin'
  | 'kneeAngleGap'
  | 'kneeOverAnkleRatio'
  | 'raisedKneeHeight'
  | 'hipHeight'
  | 'hipCenterX'
  | 'stanceWidth'
  | 'estimatedWeightShift'
  | 'headAboveHips'
  | 'eyeLineTilt'
  | 'headTurn'

export interface PoseMetricDefinition {
  label: string
  unit: '°' | '躯干长' | '肩宽' | '髋宽' | ''
  /** Landmarks the metric reads (MediaPipe names), for documentation and the report. */
  landmarks: ReadonlyArray<string>
  compute(pose: MetricPose): number | null
}

const INDEX = {
  nose: 0, leftEye: 2, rightEye: 5,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
} as const

type PointName = keyof typeof INDEX

/** A landmark counts only at this visibility; the matcher uses the same bar. */
export const METRIC_MIN_VISIBILITY = 0.5

interface Point {
  x: number
  y: number
}

function point(pose: MetricPose, name: PointName): Point | null {
  const raw = pose.landmarks[INDEX[name]]
  if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null
  if ((raw.visibility ?? 1) < METRIC_MIN_VISIBILITY) return null
  return { x: raw.x * pose.aspect, y: raw.y }
}

function points<T extends PointName>(pose: MetricPose, names: readonly T[]): Record<T, Point> | null {
  const result = {} as Record<T, Point>
  for (const name of names) {
    const value = point(pose, name)
    if (!value) return null
    result[name] = value
  }
  return result
}

function angle(a: Point, joint: Point, c: Point): number | null {
  const ax = a.x - joint.x
  const ay = a.y - joint.y
  const cx = c.x - joint.x
  const cy = c.y - joint.y
  const denominator = Math.hypot(ax, ay) * Math.hypot(cx, cy)
  if (!(denominator > 1e-9)) return null
  return (Math.acos(Math.min(1, Math.max(-1, (ax * cx + ay * cy) / denominator))) * 180) / Math.PI
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

const TORSO = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'] as const

interface Torso {
  shoulderMid: Point
  hipMid: Point
  length: number
  shoulderWidth: number
  hipWidth: number
}

function torso(pose: MetricPose): Torso | null {
  const p = points(pose, TORSO)
  if (!p) return null
  const shoulderMid = mid(p.leftShoulder, p.rightShoulder)
  const hipMid = mid(p.leftHip, p.rightHip)
  const length = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y)
  if (!(length > 1e-6)) return null
  return {
    shoulderMid,
    hipMid,
    length,
    shoulderWidth: Math.hypot(p.leftShoulder.x - p.rightShoulder.x, p.leftShoulder.y - p.rightShoulder.y),
    hipWidth: Math.hypot(p.leftHip.x - p.rightHip.x, p.leftHip.y - p.rightHip.y),
  }
}

function elbowAngles(pose: MetricPose): [number, number] | null {
  const p = points(pose, ['leftShoulder', 'leftElbow', 'leftWrist', 'rightShoulder', 'rightElbow', 'rightWrist'])
  if (!p) return null
  const left = angle(p.leftShoulder, p.leftElbow, p.leftWrist)
  const right = angle(p.rightShoulder, p.rightElbow, p.rightWrist)
  return left === null || right === null ? null : [left, right]
}

function shoulderAngles(pose: MetricPose): [number, number] | null {
  const p = points(pose, ['leftHip', 'leftShoulder', 'leftElbow', 'rightHip', 'rightShoulder', 'rightElbow'])
  if (!p) return null
  const left = angle(p.leftHip, p.leftShoulder, p.leftElbow)
  const right = angle(p.rightHip, p.rightShoulder, p.rightElbow)
  return left === null || right === null ? null : [left, right]
}

function kneeAngles(pose: MetricPose): [number, number] | null {
  const p = points(pose, ['leftHip', 'leftKnee', 'leftAnkle', 'rightHip', 'rightKnee', 'rightAnkle'])
  if (!p) return null
  const left = angle(p.leftHip, p.leftKnee, p.leftAnkle)
  const right = angle(p.rightHip, p.rightKnee, p.rightAnkle)
  return left === null || right === null ? null : [left, right]
}

/** Wrist height above its own shoulder, in torso lengths (positive = above). */
function wristHeights(pose: MetricPose): [number, number] | null {
  const body = torso(pose)
  const p = points(pose, ['leftShoulder', 'leftWrist', 'rightShoulder', 'rightWrist'])
  if (!body || !p) return null
  return [(p.leftShoulder.y - p.leftWrist.y) / body.length, (p.rightShoulder.y - p.rightWrist.y) / body.length]
}

function lineTilt(a: Point, b: Point): number {
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  return (Math.atan2(dy, Math.max(dx, 1e-9)) * 180) / Math.PI
}

export const POSE_METRICS: Readonly<Record<PoseMetricId, PoseMetricDefinition>> = Object.freeze({
  elbowAngleMin: {
    label: '双肘伸展角（较弯一侧）', unit: '°', landmarks: ['肩', '肘', '腕'],
    compute: (pose) => { const value = elbowAngles(pose); return value ? Math.min(...value) : null },
  },
  elbowAngleMax: {
    label: '肘伸展角（较直一侧）', unit: '°', landmarks: ['肩', '肘', '腕'],
    compute: (pose) => { const value = elbowAngles(pose); return value ? Math.max(...value) : null },
  },
  wristsAboveHead: {
    label: '双腕高于头部', unit: '躯干长', landmarks: ['鼻', '腕', '肩', '髋'],
    compute: (pose) => {
      const body = torso(pose)
      const p = points(pose, ['nose', 'leftWrist', 'rightWrist'])
      if (!body || !p) return null
      return (p.nose.y - Math.max(p.leftWrist.y, p.rightWrist.y)) / body.length
    },
  },
  raisedWristAboveShoulder: {
    label: '上举手高于肩', unit: '躯干长', landmarks: ['肩', '腕', '髋'],
    compute: (pose) => { const value = wristHeights(pose); return value ? Math.max(...value) : null },
  },
  loweredWristBelowShoulder: {
    label: '下按手低于肩', unit: '躯干长', landmarks: ['肩', '腕', '髋'],
    compute: (pose) => { const value = wristHeights(pose); return value ? -Math.min(...value) : null },
  },
  wristHeightGap: {
    label: '两腕高度差', unit: '躯干长', landmarks: ['肩', '腕', '髋'],
    compute: (pose) => { const value = wristHeights(pose); return value ? Math.abs(value[0] - value[1]) : null },
  },
  armsLevelDeviation: {
    label: '两臂偏离肩高', unit: '躯干长', landmarks: ['肩', '腕', '髋'],
    compute: (pose) => { const value = wristHeights(pose); return value ? Math.max(Math.abs(value[0]), Math.abs(value[1])) : null },
  },
  upperArmFromVertical: {
    label: '上臂偏离竖直', unit: '°', landmarks: ['肩', '肘'],
    compute: (pose) => {
      const p = points(pose, ['leftShoulder', 'leftElbow', 'rightShoulder', 'rightElbow'])
      if (!p) return null
      // 0° = upper arm pointing straight up beside the head; the more open side counts.
      const fromUp = (shoulder: Point, elbow: Point) => (Math.atan2(Math.abs(elbow.x - shoulder.x), Math.max(shoulder.y - elbow.y, 1e-9)) * 180) / Math.PI
      if (p.leftElbow.y >= p.leftShoulder.y || p.rightElbow.y >= p.rightShoulder.y) return 90
      return Math.max(fromUp(p.leftShoulder, p.leftElbow), fromUp(p.rightShoulder, p.rightElbow))
    },
  },
  raisedWristLateralOffset: {
    label: '上举手偏离肩的侧向距离', unit: '肩宽', landmarks: ['肩', '腕'],
    compute: (pose) => {
      const body = torso(pose)
      const p = points(pose, ['leftShoulder', 'leftWrist', 'rightShoulder', 'rightWrist'])
      if (!body || !p || !(body.shoulderWidth > 1e-6)) return null
      const raised = p.leftWrist.y <= p.rightWrist.y ? { wrist: p.leftWrist, shoulder: p.leftShoulder } : { wrist: p.rightWrist, shoulder: p.rightShoulder }
      // Positive = outside the shoulder (away from the body midline).
      const outward = Math.sign(raised.shoulder.x - body.shoulderMid.x) * (raised.wrist.x - raised.shoulder.x)
      return outward / body.shoulderWidth
    },
  },
  armAbduction: {
    label: '两臂张开角（平均）', unit: '°', landmarks: ['髋', '肩', '肘'],
    compute: (pose) => { const value = shoulderAngles(pose); return value ? (value[0] + value[1]) / 2 : null },
  },
  shoulderAngleGap: {
    label: '两臂抬起角度差', unit: '°', landmarks: ['髋', '肩', '肘'],
    compute: (pose) => { const value = shoulderAngles(pose); return value ? Math.abs(value[0] - value[1]) : null },
  },
  torsoLean: {
    label: '躯干侧倾角', unit: '°', landmarks: ['肩', '髋'],
    compute: (pose) => {
      const body = torso(pose)
      if (!body) return null
      return (Math.atan2(Math.abs(body.shoulderMid.x - body.hipMid.x), Math.max(Math.abs(body.hipMid.y - body.shoulderMid.y), 1e-9)) * 180) / Math.PI
    },
  },
  shoulderTilt: {
    label: '肩线倾斜', unit: '°', landmarks: ['肩'],
    compute: (pose) => { const p = points(pose, ['leftShoulder', 'rightShoulder']); return p ? lineTilt(p.leftShoulder, p.rightShoulder) : null },
  },
  kneeAngleMean: {
    label: '膝关节角（平均）', unit: '°', landmarks: ['髋', '膝', '踝'],
    compute: (pose) => { const value = kneeAngles(pose); return value ? (value[0] + value[1]) / 2 : null },
  },
  kneeAngleMin: {
    label: '膝关节角（较弯一侧）', unit: '°', landmarks: ['髋', '膝', '踝'],
    compute: (pose) => { const value = kneeAngles(pose); return value ? Math.min(...value) : null },
  },
  kneeAngleGap: {
    label: '两膝屈曲差', unit: '°', landmarks: ['髋', '膝', '踝'],
    compute: (pose) => { const value = kneeAngles(pose); return value ? Math.abs(value[0] - value[1]) : null },
  },
  kneeOverAnkleRatio: {
    label: '两膝间距 / 两踝间距', unit: '', landmarks: ['膝', '踝'],
    compute: (pose) => {
      const p = points(pose, ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'])
      if (!p) return null
      const ankles = Math.abs(p.leftAnkle.x - p.rightAnkle.x)
      // Feet close together say nothing about knee direction.
      const body = torso(pose)
      if (!body || !(ankles > body.hipWidth * 1.2)) return null
      return Math.abs(p.leftKnee.x - p.rightKnee.x) / ankles
    },
  },
  raisedKneeHeight: {
    label: '提膝高度（膝相对同侧髋）', unit: '躯干长', landmarks: ['髋', '膝'],
    compute: (pose) => {
      const body = torso(pose)
      const p = points(pose, ['leftHip', 'leftKnee', 'rightHip', 'rightKnee'])
      if (!body || !p) return null
      // 0 = thigh level with the hip; standing is about -0.9.
      return Math.max(p.leftHip.y - p.leftKnee.y, p.rightHip.y - p.rightKnee.y) / body.length
    },
  },
  hipHeight: {
    label: '髋部离地高度', unit: '躯干长', landmarks: ['髋', '踝'],
    compute: (pose) => {
      const body = torso(pose)
      const p = points(pose, ['leftAnkle', 'rightAnkle'])
      if (!body || !p) return null
      return ((p.leftAnkle.y + p.rightAnkle.y) / 2 - body.hipMid.y) / body.length
    },
  },
  hipCenterX: {
    label: '髋中心水平位置（相对两踝中点）', unit: '髋宽', landmarks: ['髋', '踝'],
    compute: (pose) => {
      const body = torso(pose)
      const p = points(pose, ['leftAnkle', 'rightAnkle'])
      if (!body || !p || !(body.hipWidth > 1e-6)) return null
      return (body.hipMid.x - (p.leftAnkle.x + p.rightAnkle.x) / 2) / body.hipWidth
    },
  },
  stanceWidth: {
    label: '两脚间距', unit: '髋宽', landmarks: ['踝', '髋'],
    compute: (pose) => {
      const body = torso(pose)
      const p = points(pose, ['leftAnkle', 'rightAnkle'])
      if (!body || !p || !(body.hipWidth > 1e-6)) return null
      return Math.abs(p.leftAnkle.x - p.rightAnkle.x) / body.hipWidth
    },
  },
  estimatedWeightShift: {
    label: '重心偏移估计', unit: '', landmarks: ['髋', '踝'],
    compute: (pose) => {
      const body = torso(pose)
      const p = points(pose, ['leftAnkle', 'rightAnkle'])
      if (!body || !p) return null
      const half = Math.abs(p.leftAnkle.x - p.rightAnkle.x) / 2
      // Hip centre over the ankle midpoint = 0; over either ankle = 1. Only a visual estimate of weight shift.
      if (!(half > body.hipWidth * 0.25)) return null
      return Math.abs(body.hipMid.x - (p.leftAnkle.x + p.rightAnkle.x) / 2) / half
    },
  },
  headAboveHips: {
    label: '头部高于髋部', unit: '躯干长', landmarks: ['鼻', '髋', '肩'],
    compute: (pose) => {
      const body = torso(pose)
      const nose = point(pose, 'nose')
      return body && nose ? (body.hipMid.y - nose.y) / body.length : null
    },
  },
  eyeLineTilt: {
    label: '两眼连线倾斜', unit: '°', landmarks: ['眼'],
    compute: (pose) => { const p = points(pose, ['leftEye', 'rightEye']); return p ? lineTilt(p.leftEye, p.rightEye) : null },
  },
  headTurn: {
    label: '转头幅度（鼻尖偏离肩中点）', unit: '肩宽', landmarks: ['鼻', '肩'],
    compute: (pose) => {
      const body = torso(pose)
      const nose = point(pose, 'nose')
      if (!body || !nose || !(body.shoulderWidth > 1e-6)) return null
      return Math.abs(nose.x - body.shoulderMid.x) / body.shoulderWidth
    },
  },
})

export function computePoseMetric(id: PoseMetricId, pose: MetricPose): number | null {
  const value = POSE_METRICS[id].compute(pose)
  return value === null || !Number.isFinite(value) ? null : value
}
