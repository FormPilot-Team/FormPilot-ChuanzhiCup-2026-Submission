import { bodyFrame, LM, trunkSideLeanDegrees, type BodyFrame, type Point } from '../bodyFrame'
import type { AnalyzerPose } from '../types'
import type { BaduanjinStep, BaduanjinTrajectory } from './steps'

/** 八段锦的单帧特征。长度为宽高比校正后的图像单位，评价时再除以稳健躯干长（攀足时二维躯干变短） */
export interface BaduanjinFeatures {
  /** 主轨迹，越大越接近到位 */
  trajectory: number | null
  /** 第二幅度（摇头摆尾：躯干侧倾，度） */
  secondary: number | null
  torso: number
  /** 腕、鼻、肩中心相对髋中心的 x, y（不可见为 NaN），用于定势稳定 */
  steady: number[]
}

function above(reference: Point, point: Point): number {
  return reference.y - point.y
}

const TRAJECTORIES: Readonly<Record<BaduanjinTrajectory, (body: BodyFrame) => number | null>> = {
  // 取较低的手腕：两手都要上举
  liftBoth: (body) => {
    const nose = body.point(LM.nose)
    const left = body.point(LM.leftWrist)
    const right = body.point(LM.rightWrist)
    return nose && left && right ? Math.min(above(nose, left), above(nose, right)) : null
  },
  pushReach: (body) => {
    const reaches = [LM.leftWrist, LM.rightWrist].map((index) => body.point(index)).filter((point): point is Point => point !== null)
    return reaches.length ? Math.max(...reaches.map((wrist) => Math.abs(wrist.x - body.shoulderMid.x))) : null
  },
  singleLift: (body) => {
    const sides = [[LM.leftShoulder, LM.leftWrist], [LM.rightShoulder, LM.rightWrist]] as const
    const heights = sides.map(([shoulder, wrist]) => {
      const s = body.point(shoulder)
      const w = body.point(wrist)
      return s && w ? above(s, w) : null
    }).filter((value): value is number => value !== null)
    return heights.length ? Math.max(...heights) : null
  },
  headTurn: (body) => {
    const nose = body.point(LM.nose)
    return nose ? Math.abs(nose.x - body.shoulderMid.x) : null
  },
  headSway: (body) => {
    const nose = body.point(LM.nose)
    return nose ? Math.abs(nose.x - body.hipMid.x) : null
  },
  reachDown: (body) => {
    const left = body.point(LM.leftWrist)
    const right = body.point(LM.rightWrist)
    return left && right ? (left.y + right.y) / 2 - body.hipMid.y : null
  },
  // 正面画面中前冲拳被透视缩短，但拳仍从腰间抬到肩高
  punchLift: (body) => {
    const heights = [LM.leftWrist, LM.rightWrist].map((index) => body.point(index)).filter((point): point is Point => point !== null)
    return heights.length ? Math.max(...heights.map((wrist) => above(body.hipMid, wrist))) : null
  },
  // 相机固定时，提踵会带动肩中心上升，以此近似估计提踵
  heelRiseProxy: (body) => -body.shoulderMid.y,
}

const STEADY_POINTS = [LM.leftWrist, LM.rightWrist, LM.nose] as const

export function baduanjinFeatures(pose: AnalyzerPose, step: BaduanjinStep): BaduanjinFeatures | null {
  const body = bodyFrame(pose.landmarks, pose.aspect)
  if (!body) return null
  const steady: number[] = []
  for (const index of STEADY_POINTS) {
    const point = body.point(index)
    steady.push(point ? point.x - body.hipMid.x : Number.NaN, point ? point.y - body.hipMid.y : Number.NaN)
  }
  steady.push(body.shoulderMid.x - body.hipMid.x, body.shoulderMid.y - body.hipMid.y)
  return {
    trajectory: TRAJECTORIES[step.trajectory](body),
    secondary: step.secondary ? Math.abs(trunkSideLeanDegrees(body)) : null,
    torso: body.torsoLength,
    steady,
  }
}
