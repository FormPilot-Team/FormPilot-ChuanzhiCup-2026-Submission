import { comparePoses, describePose, mirrorDescriptor } from '../../followAlong/matcher'
import { bodyFrame, LM } from '../bodyFrame'
import type { AnalyzerContext, AnalyzerPose } from '../types'

/** describePose 的返回值：以躯干归一化的姿态 */
export type PoseDescriptor = NonNullable<ReturnType<typeof describePose>>

/** 易筋经单帧特征（基于姿态关键点的二维近似）：判断静止的六个点、与目标姿态的相似度、同一时刻的跟练相似度 */
export interface YijinjingFeatures {
  /** 双腕、双肩、双髋的 x, y（图像单位，不可见为 NaN） */
  points: number[]
  torso: number
  /** 与目标姿态的相似度 0..1；该势无目标或姿态无法描述时为 null */
  targetSimilarity: number | null
  similarity: number | null
}

export const STILLNESS_POINTS = [LM.leftWrist, LM.rightWrist, LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip] as const

/** 用跟练比对的方法计算目标相似度；对称的势原样和镜像取高，有左右之分的势只比原样 */
export function targetSimilarity(pose: AnalyzerPose, target: PoseDescriptor, sided: boolean): number | null {
  const user = describePose(pose.landmarks, pose.aspect)
  if (!user) return null
  const direct = comparePoses(user, target)?.similarity ?? null
  if (sided) return direct
  const mirrored = comparePoses(mirrorDescriptor(user), target)?.similarity ?? null
  if (direct === null) return mirrored
  return mirrored === null ? direct : Math.max(direct, mirrored)
}

export function yijinjingFeatures(pose: AnalyzerPose, context: Pick<AnalyzerContext, 'match'>, target?: { descriptor: PoseDescriptor; sided: boolean }): YijinjingFeatures | null {
  const body = bodyFrame(pose.landmarks, pose.aspect)
  if (!body) return null
  const points: number[] = []
  for (const index of STILLNESS_POINTS) {
    const point = body.point(index)
    points.push(point ? point.x : Number.NaN, point ? point.y : Number.NaN)
  }
  const match = context.match
  return {
    points,
    torso: body.torsoLength,
    targetSimilarity: target ? targetSimilarity(pose, target.descriptor, target.sided) : null,
    similarity: match && match.status !== 'insufficient' ? match.similarity : null,
  }
}
