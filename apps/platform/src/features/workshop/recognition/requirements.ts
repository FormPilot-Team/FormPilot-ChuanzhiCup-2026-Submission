import type { LandmarkName, PoseLandmark } from '../../pose/types'
import { REQUIREMENTS } from '../catalog'
import type { CapturedPose, CustomActionBodyArea, CustomActionDefinition, RequirementId } from '../types'
import { angleAt, isUsable, landmark, length, mid, sub, toVec, torsoLeanDegrees, type Vec2 } from './geometry'

/** What the 识别重点 need from one frame, in true proportions (degrees, torso lengths). Null = not visible. */
export interface RequirementMeasures {
  minElbowAngle: number | null
  /** Lowest wrist height above its shoulder, in torso lengths (positive = above). Null unless both are visible. */
  wristsAboveShoulders: number | null
  minKneeAngle: number | null
  torsoLean: number | null
  armDifference: number | null
  kneeDifference: number | null
}

function point(landmarks: ReadonlyArray<PoseLandmark>, name: LandmarkName, aspect: number): Vec2 | undefined {
  const value = landmark(landmarks, name)
  return isUsable(value) ? toVec(value, aspect) : undefined
}

export function measureRequirements(landmarks: ReadonlyArray<PoseLandmark>, aspect: number): RequirementMeasures {
  const p = (name: LandmarkName) => point(landmarks, name, aspect)
  const ls = p('leftShoulder'); const rs = p('rightShoulder')
  const le = p('leftElbow'); const re = p('rightElbow')
  const lw = p('leftWrist'); const rw = p('rightWrist')
  const lh = p('leftHip'); const rh = p('rightHip')
  const lk = p('leftKnee'); const rk = p('rightKnee')
  const la = p('leftAnkle'); const ra = p('rightAnkle')

  const elbows = [ls && le && lw ? angleAt(ls, le, lw) : null, rs && re && rw ? angleAt(rs, re, rw) : null].filter((value): value is number => value !== null)
  const knees = [lh && lk && la ? angleAt(lh, lk, la) : null, rh && rk && ra ? angleAt(rh, rk, ra) : null]
  const torso = ls && rs && lh && rh ? length(sub(mid(ls, rs), mid(lh, rh))) : null
  const shoulderAngles = [ls && le && lh ? angleAt(lh, ls, le) : null, rs && re && rh ? angleAt(rh, rs, re) : null]
  const visibleKnees = knees.filter((value): value is number => value !== null)
  return {
    minElbowAngle: elbows.length ? Math.min(...elbows) : null,
    wristsAboveShoulders: torso && ls && rs && lw && rw ? Math.min(ls.y - lw.y, rs.y - rw.y) / torso : null,
    minKneeAngle: visibleKnees.length ? Math.min(...visibleKnees) : null,
    torsoLean: ls && rs && lh && rh ? torsoLeanDegrees(mid(ls, rs), mid(lh, rh)) : null,
    armDifference: shoulderAngles[0] !== null && shoulderAngles[1] !== null ? Math.abs(shoulderAngles[0] - shoulderAngles[1]) : null,
    kneeDifference: knees[0] !== null && knees[1] !== null ? Math.abs(knees[0] - knees[1]) : null,
  }
}

export function measureCapturedPose(pose: CapturedPose | undefined): RequirementMeasures | undefined {
  return pose ? measureRequirements(pose.landmarks, pose.aspect) : undefined
}

function symmetryKind(area: CustomActionBodyArea): 'arms' | 'legs' {
  return area === 'lower' ? 'legs' : 'arms'
}

/** One requirement against one frame (or, for torso stability, the worst frame of a repetition). */
export function evaluateRequirement(id: RequirementId, measures: RequirementMeasures, threshold: number, area: CustomActionBodyArea): boolean | null {
  switch (id) {
    case 'arms-straight': return measures.minElbowAngle === null ? null : measures.minElbowAngle >= threshold
    case 'hands-above-shoulders': return measures.wristsAboveShoulders === null ? null : measures.wristsAboveShoulders >= threshold
    case 'knees-bent': return measures.minKneeAngle === null ? null : measures.minKneeAngle <= threshold
    case 'torso-stable': return measures.torsoLean === null ? null : measures.torsoLean <= threshold
    case 'symmetric': {
      const difference = symmetryKind(area) === 'arms' ? measures.armDifference : measures.kneeDifference
      return difference === null ? null : difference <= threshold
    }
    case 'full-return': return true
  }
}

export interface RequirementSuggestion {
  threshold: number
  /** The recorded poses themselves contradict the requirement. */
  conflict?: string
}

const round5 = (value: number) => Math.round(value / 5) * 5

/**
 * 示范校准 for the 识别重点: thresholds follow the recorded finish pose (with a margin), so a requirement never rejects
 * the very pose the user demonstrated. A manual threshold in 高级设置 still wins.
 */
export function suggestRequirement(id: RequirementId, definition: Pick<CustomActionDefinition, 'startPose' | 'finishPose' | 'bodyArea'>): RequirementSuggestion {
  const option = REQUIREMENTS[id]
  const base = option.threshold?.defaultValue ?? 0
  const start = measureCapturedPose(definition.startPose.capture)
  const finish = measureCapturedPose(definition.finishPose.capture)
  const limits = option.threshold
  const bounded = (value: number) => limits ? Math.min(limits.max, Math.max(limits.min, value)) : value
  if (!finish) return { threshold: base }
  switch (id) {
    case 'arms-straight': {
      if (finish.minElbowAngle === null) return { threshold: base }
      if (finish.minElbowAngle < 110) return { threshold: base, conflict: `你的完成姿势手肘弯曲约 ${Math.round(finish.minElbowAngle)}°，与“手臂保持伸直”不一致。` }
      return { threshold: bounded(Math.min(base, round5(finish.minElbowAngle - 10))) }
    }
    case 'hands-above-shoulders': {
      if (finish.wristsAboveShoulders === null) return { threshold: 0 }
      if (finish.wristsAboveShoulders < 0.05) return { threshold: 0, conflict: '你的完成姿势双手没有高过肩膀，与“双手抬到肩部以上”不一致。' }
      return { threshold: 0 }
    }
    case 'knees-bent': {
      if (finish.minKneeAngle === null) return { threshold: base }
      if (finish.minKneeAngle > 160) return { threshold: base, conflict: '你的完成姿势膝盖几乎伸直，与“膝盖弯曲到合适位置”不一致。' }
      return { threshold: bounded(round5(finish.minKneeAngle + 15)) }
    }
    case 'torso-stable': {
      const lean = Math.max(start?.torsoLean ?? 0, finish.torsoLean ?? 0)
      if (lean > 45) return { threshold: base, conflict: `你的动作本身上身倾斜约 ${Math.round(lean)}°，“保持躯干稳定”可能一直提示。` }
      return { threshold: bounded(Math.max(base, Math.ceil(lean + 10))) }
    }
    case 'symmetric': {
      const difference = definition.bodyArea === 'lower' ? finish.kneeDifference : finish.armDifference
      if (difference === null) return { threshold: base }
      if (difference > 45) return { threshold: base, conflict: '你的完成姿势左右两侧本身差别很大（例如单侧动作），不建议开启。' }
      return { threshold: bounded(Math.max(base, round5(difference + 10))) }
    }
    case 'full-return': return { threshold: 0 }
  }
}

export interface EffectiveRequirement {
  id: RequirementId
  threshold: number
  conflict?: string
}

/** The enabled requirements with the threshold actually used: manual, else the demonstration's, else the default. */
export function effectiveRequirements(definition: Pick<CustomActionDefinition, 'requirements' | 'startPose' | 'finishPose' | 'bodyArea' | 'goal'>): EffectiveRequirement[] {
  return definition.requirements
    .filter((item) => item.enabled && !(item.id === 'full-return' && definition.goal.type === 'duration'))
    .map((item) => {
      const suggestion = suggestRequirement(item.id, definition)
      return { id: item.id, threshold: item.threshold ?? suggestion.threshold, conflict: suggestion.conflict }
    })
}
