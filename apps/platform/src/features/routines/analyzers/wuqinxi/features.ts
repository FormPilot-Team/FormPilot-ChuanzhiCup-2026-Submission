import { bodyFrame, LM, trunkSideLeanDegrees, type BodyFrame, type Point } from '../bodyFrame'
import type { AnalyzerContext, AnalyzerPose } from '../types'

/**
 * Movement features of the five animals. Each is a 2D quantity whose range over a form shows how fully the
 * animal's characteristic movement was made; lengths are aspect-corrected image units (scaled later by a robust
 * torso length), angles are degrees. Several are proxies of 3D movements seen from the front (noted per feature).
 */
export type WuqinxiFeatureId =
  | 'reachUp'
  | 'wristHeight'
  | 'trunkFlexProxy'
  | 'sideBend'
  | 'kneeBend'
  | 'trunkShift'
  | 'hipSway'
  | 'hipHike'
  | 'shrug'
  | 'bodyRise'
  | 'kneeLift'
  | 'ankleLift'

export interface WuqinxiFeatureDefinition {
  label: string
  /** 'length' values are divided by the body scale; angles are used as they are. */
  kind: 'length' | 'angle'
  /** Present when the quantity only approximates a 3D movement. */
  proxy?: string
  compute(body: BodyFrame): number | null
}

function wrists(body: BodyFrame): [Point, Point] | null {
  const left = body.point(LM.leftWrist)
  const right = body.point(LM.rightWrist)
  return left && right ? [left, right] : null
}

function kneeAngle(body: BodyFrame, hip: number, knee: number, ankle: number): number | null {
  const a = body.point(hip)
  const b = body.point(knee)
  const c = body.point(ankle)
  if (!a || !b || !c) return null
  const ax = a.x - b.x
  const ay = a.y - b.y
  const cx = c.x - b.x
  const cy = c.y - b.y
  const denominator = Math.hypot(ax, ay) * Math.hypot(cx, cy)
  return denominator > 0 ? (Math.acos(Math.min(1, Math.max(-1, (ax * cx + ay * cy) / denominator))) * 180) / Math.PI : null
}

export const WUQINXI_FEATURES: Readonly<Record<WuqinxiFeatureId, WuqinxiFeatureDefinition>> = Object.freeze({
  reachUp: {
    label: '两手上举高度',
    kind: 'length',
    compute: (body) => {
      const nose = body.point(LM.nose)
      const pair = wrists(body)
      return nose && pair ? nose.y - (pair[0].y + pair[1].y) / 2 : null
    },
  },
  wristHeight: {
    label: '两臂起落幅度',
    kind: 'length',
    compute: (body) => {
      const pair = wrists(body)
      return pair ? body.hipMid.y - (pair[0].y + pair[1].y) / 2 : null
    },
  },
  trunkFlexProxy: {
    label: '躯干前屈伸展',
    kind: 'length',
    proxy: '正面画面中前屈表现为躯干投影变短，用躯干投影长度的变化近似。',
    compute: (body) => -body.torsoLength,
  },
  sideBend: {
    label: '躯干侧屈',
    kind: 'angle',
    compute: (body) => trunkSideLeanDegrees(body),
  },
  kneeBend: {
    label: '屈膝下沉',
    kind: 'angle',
    compute: (body) => {
      const left = kneeAngle(body, LM.leftHip, LM.leftKnee, LM.leftAnkle)
      const right = kneeAngle(body, LM.rightHip, LM.rightKnee, LM.rightAnkle)
      return left !== null && right !== null ? -Math.min(left, right) : null
    },
  },
  trunkShift: {
    label: '以腰腹为轴摇转（肩中心相对髋中心）',
    kind: 'length',
    compute: (body) => body.shoulderMid.x - body.hipMid.x,
  },
  hipSway: {
    label: '身体左右晃动（髋中心相对两踝）',
    kind: 'length',
    compute: (body) => {
      const left = body.point(LM.leftAnkle)
      const right = body.point(LM.rightAnkle)
      return left && right ? body.hipMid.x - (left.x + right.x) / 2 : null
    },
  },
  hipHike: {
    label: '提髋（髋线倾斜）',
    kind: 'angle',
    compute: (body) => {
      const left = body.point(LM.leftHip)
      const right = body.point(LM.rightHip)
      return left && right ? (Math.atan2(left.y - right.y, Math.abs(left.x - right.x) + 1e-9) * 180) / Math.PI : null
    },
  },
  shrug: {
    label: '耸肩缩颈（耳与肩的距离）',
    kind: 'length',
    compute: (body) => {
      const sides = [[LM.leftEar, LM.leftShoulder], [LM.rightEar, LM.rightShoulder]] as const
      const gaps = sides.map(([ear, shoulder]) => {
        const e = body.point(ear)
        const s = body.point(shoulder)
        return e && s ? s.y - e.y : null
      }).filter((value): value is number => value !== null)
      return gaps.length ? -gaps.reduce((sum, value) => sum + value, 0) / gaps.length : null
    },
  },
  bodyRise: {
    label: '提踵上提（肩部抬升，近似）',
    kind: 'length',
    proxy: '用肩中心的抬升近似提踵，依赖相机固定不动。',
    compute: (body) => -body.shoulderMid.y,
  },
  kneeLift: {
    label: '提膝高度',
    kind: 'length',
    compute: (body) => {
      const sides = [[LM.leftHip, LM.leftKnee], [LM.rightHip, LM.rightKnee]] as const
      const lifts = sides.map(([hip, knee]) => {
        const h = body.point(hip)
        const k = body.point(knee)
        return h && k ? h.y - k.y : null
      }).filter((value): value is number => value !== null)
      return lifts.length ? Math.max(...lifts) : null
    },
  },
  ankleLift: {
    label: '后伸腿抬起（两踝高度差）',
    kind: 'length',
    compute: (body) => {
      const left = body.point(LM.leftAnkle)
      const right = body.point(LM.rightAnkle)
      return left && right ? Math.abs(left.y - right.y) : null
    },
  },
})

export interface WuqinxiFeatures {
  /** The form's profile features, in the order of its step entry (null when not visible). */
  profile: Array<number | null>
  torso: number
  /** Wrists, nose and shoulder centre relative to the hip centre (x, y pairs; NaN when not visible). */
  steady: number[]
  similarity: number | null
}

const STEADY_POINTS = [LM.leftWrist, LM.rightWrist, LM.nose] as const

export function wuqinxiFeatures(pose: AnalyzerPose, context: Pick<AnalyzerContext, 'match'>, features: ReadonlyArray<WuqinxiFeatureId>): WuqinxiFeatures | null {
  const body = bodyFrame(pose.landmarks, pose.aspect)
  if (!body) return null
  const steady: number[] = []
  for (const index of STEADY_POINTS) {
    const point = body.point(index)
    steady.push(point ? point.x - body.hipMid.x : Number.NaN, point ? point.y - body.hipMid.y : Number.NaN)
  }
  steady.push(body.shoulderMid.x - body.hipMid.x, body.shoulderMid.y - body.hipMid.y)
  const match = context.match
  return {
    profile: features.map((id) => WUQINXI_FEATURES[id].compute(body)),
    torso: body.torsoLength,
    steady,
    similarity: match && match.status !== 'insufficient' ? match.similarity : null,
  }
}
