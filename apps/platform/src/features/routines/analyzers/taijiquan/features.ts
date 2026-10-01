import { bodyFrame, LM, type Point } from '../bodyFrame'
import type { AnalyzerContext, AnalyzerPose } from '../types'

/**
 * One frame of 太极拳 features. Positions are aspect-corrected image units (the analyzer scales them by a robust
 * torso length over time); the support ratio is the 2D hip-centre approximation of where the weight is.
 */
export interface TaijiquanFeatures {
  /** Wrists and hip centre (x, y pairs; NaN when not visible): the moving points whose speed is followed. */
  points: number[]
  torso: number
  /**
   * (hip centre x − left ankle x) / (right ankle x − left ankle x): 0 = over the left ankle, 1 = over the right
   * (the person's own sides). Null when the ankles are hidden or too close together to tell.
   */
  supportRatio: number | null
  /** Follow-along similarity of the same tick (null for the demonstrator's own frames or an unusable comparison). */
  similarity: number | null
  /** The matcher found the left/right-mirrored pose closer: the user follows as in a mirror. */
  mirrored: boolean
}

/** Ankles closer than this (torso lengths) say nothing about which leg carries the weight. */
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
