import { bodyFrame, LM, trunkSideLeanDegrees, type BodyFrame, type Point } from '../bodyFrame'
import type { AnalyzerPose } from '../types'
import type { BaduanjinStep, BaduanjinTrajectory } from './steps'

/**
 * One frame of 八段锦 features. Lengths are in aspect-corrected image units; the analyzer divides them by a robust
 * torso length over time, because the 2D torso shortens when the body bends towards the camera (攀足).
 */
export interface BaduanjinFeatures {
  /** The step's main trajectory; bigger = further towards the movement's position. */
  trajectory: number | null
  /** Second amplitude of the step (摇头摆尾: trunk side lean, degrees). */
  secondary: number | null
  torso: number
  /** Wrists, nose and shoulder centre relative to the hip centre (x, y pairs; NaN when not visible): steadiness. */
  steady: number[]
}

function above(reference: Point, point: Point): number {
  return reference.y - point.y
}

const TRAJECTORIES: Readonly<Record<BaduanjinTrajectory, (body: BodyFrame) => number | null>> = {
  // Lower of the two wrists above the nose: both hands must go up.
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
  // A forward punch is foreshortened in a frontal picture, but the fist still rises from the waist to shoulder height.
  punchLift: (body) => {
    const heights = [LM.leftWrist, LM.rightWrist].map((index) => body.point(index)).filter((point): point is Point => point !== null)
    return heights.length ? Math.max(...heights.map((wrist) => above(body.hipMid, wrist))) : null
  },
  // The shoulder centre rises when the heels lift (camera fixed): an approximation of the heel rise.
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
