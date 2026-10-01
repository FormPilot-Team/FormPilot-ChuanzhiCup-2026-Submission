import { comparePoses, describePose, mirrorDescriptor } from '../../followAlong/matcher'
import { bodyFrame, LM } from '../bodyFrame'
import type { AnalyzerContext, AnalyzerPose } from '../types'

/** What the follow-along matcher's `describePose` returns: the torso-normalised pose used for target comparison. */
export type PoseDescriptor = NonNullable<ReturnType<typeof describePose>>

/**
 * One frame of 易筋经 features: the six points whose movement decides stillness (wrists, shoulders, hips), the
 * similarity to the 势's target pose, and the follow-along similarity of the same tick.
 */
export interface YijinjingFeatures {
  /** Wrists, shoulders and hips (x, y pairs, aspect-corrected image units; NaN when not visible). */
  points: number[]
  torso: number
  /** Similarity (0..1) to the 势's target pose; null when the 势 has no target or the pose cannot be described. */
  targetSimilarity: number | null
  similarity: number | null
}

export const STILLNESS_POINTS = [LM.leftWrist, LM.rightWrist, LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip] as const

/**
 * Similarity to a target pose with the follow-along matcher's own comparison. Symmetric 势 follow the matcher's
 * mirror convention (as seen or as in a mirror, the better counts); 势 with a left / right side compare as seen only.
 */
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
