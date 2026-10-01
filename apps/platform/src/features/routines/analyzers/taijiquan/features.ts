import { bodyFrame, LM, type Point } from '../bodyFrame'
import type { AnalyzerContext, AnalyzerPose } from '../types'

/** 太极拳单帧特征（基于姿态关键点的二维近似）；位置为图像单位，评价时按稳健躯干长缩放 */
export interface TaijiquanFeatures {
  /** 双腕与髋中心的 x, y（不可见为 NaN），用于速度 */
  points: number[]
  torso: number
  /** (髋中心x − 左踝x) / (右踝x − 左踝x)：0 在左踝上方，1 在右踝上方；两踝不可见或过近时为 null */
  supportRatio: number | null
  similarity: number | null
  /** 镜像姿态与示范更接近，即用户按镜像跟练 */
  mirrored: boolean
}

/** 两踝间距小于此值（躯干长）时无法判断支撑腿 */
export const MIN_SUPPORT_SPAN = 0.25

export function taijiquanFeatures(pose: AnalyzerPose, context: Pick<AnalyzerContext, 'match'>): TaijiquanFeatures | null {
  const body = bodyFrame(pose.landmarks, pose.aspect)
  if (!body) return null
  const points: number[] = []
  for (const point of [body.point(LM.leftWrist), body.point(LM.rightWrist), body.hipMid as Point | null]) {
    points.push(point ? point.x : Number.NaN, point ? point.y : Number.NaN)
  }
  const left = body.point(LM.leftAnkle)
  const right = body.point(LM.rightAnkle)
  const span = left && right ? right.x - left.x : 0
  const supportRatio = left && Math.abs(span) / body.torsoLength >= MIN_SUPPORT_SPAN ? (body.hipMid.x - left.x) / span : null
  const match = context.match
  const comparable = match && match.status !== 'insufficient'
  return {
    points,
    torso: body.torsoLength,
    supportRatio,
    similarity: comparable ? match.similarity : null,
    mirrored: Boolean(comparable && match.mirrored),
  }
}
