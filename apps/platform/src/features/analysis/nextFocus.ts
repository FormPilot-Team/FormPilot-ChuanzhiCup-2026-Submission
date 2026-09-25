import { REPORT_EXERCISE_PRESENTATION } from '../report/presentation'
import { ANALYSIS_CONFIG_V1 } from './config'
import type { CapabilityModelV2, NextFocus, PriorityIssue } from './types'

const CAPABILITY_CUES: Record<string, string> = {
  AMPLITUDE: '在保持身体稳定的前提下完成目标动作幅度。',
  STABILITY: '放慢动作并保持身体居中。',
  COORDINATION: '降低速度，关注左右和手脚配合。',
  TEMPO: '让每次动作时长进入对应动作的推荐区间。',
  FORM: '按实时提示完成目标位与回位。',
}
export function buildNextFocus(priorities: readonly PriorityIssue[], capabilities: CapabilityModelV2): NextFocus[] {
  if (priorities.length > 0) return priorities.slice(0, ANALYSIS_CONFIG_V1.focus.maxItems).map((item) => ({
    id: `focus:${item.id}`,
    sourcePriorityId: item.id,
    exerciseId: item.exerciseId,
    cue: `${REPORT_EXERCISE_PRESENTATION[item.exerciseId].name}：${item.cue}`,
    measurableTarget: item.incidence.evaluable >= ANALYSIS_CONFIG_V1.minEvaluableReps
      ? `下次将 ${item.label} 的发生次数控制在少于 ${item.incidence.affected} 次（同等可评估样本）。`
      : null,
    evidenceRefs: item.evidenceRefs,
  }))
  const weak = capabilities.dimensions.filter((item) => item.value !== null
    && item.value <= ANALYSIS_CONFIG_V1.focus.weakCapabilityMax
    && item.contributors.length >= ANALYSIS_CONFIG_V1.capability.minExerciseContributors)
    .sort((left, right) => (left.value ?? 0) - (right.value ?? 0) || (left.dimension < right.dimension ? -1 : 1))[0]
  return weak ? [{
    id: `focus:capability:${weak.dimension}`,
    sourcePriorityId: null,
    exerciseId: null,
    cue: CAPABILITY_CUES[weak.dimension],
    measurableTarget: null,
    evidenceRefs: weak.contributors.map((item) => `capability:${weak.dimension}:${item.exerciseId}`),
  }] : []
}
