import { REPORT_EXERCISE_PRESENTATION } from '../report/presentation'
import { ANALYSIS_CONFIG_V1 } from './config'
import type { CapabilityModelV2, ExerciseAnalysis, Strength } from './types'

const CAPABILITY_NAMES: Record<string, string> = {
  AMPLITUDE: '动作幅度', STABILITY: '稳定性', COORDINATION: '协调性', TEMPO: '单次动作时长', FORM: '动作规范',
}
export function selectStrengths(capabilities: CapabilityModelV2, exercises: readonly ExerciseAnalysis[]): Strength[] {
  const capabilityStrengths: Strength[] = capabilities.dimensions.flatMap((item) =>
    item.value !== null && item.value >= ANALYSIS_CONFIG_V1.strengths.minCapabilityScore
      && item.contributors.length >= ANALYSIS_CONFIG_V1.capability.minExerciseContributors
      ? [{
          id: `strength:capability:${item.dimension}`,
          source: 'CAPABILITY' as const,
          exerciseId: null,
          dimension: item.dimension,
          value: item.value,
          text: `${CAPABILITY_NAMES[item.dimension]}达到 ${item.value} 分，证据来自 ${item.contributors.length} 个动作。`,
          evidenceRefs: item.contributors.map((contribution) => `capability:${item.dimension}:${contribution.exerciseId}`),
        }]
      : [])
  const exerciseStrengths: Strength[] = exercises.flatMap((item) =>
    item.score !== null && item.score >= ANALYSIS_CONFIG_V1.strengths.minExerciseScore
      && item.analyzedRepCount >= ANALYSIS_CONFIG_V1.strengths.minExerciseReps
      ? [{
          id: `strength:exercise:${item.exerciseId}`,
          source: 'EXERCISE' as const,
          exerciseId: item.exerciseId,
          dimension: null,
          value: item.score,
          text: `${REPORT_EXERCISE_PRESENTATION[item.exerciseId].name}分析得分 ${item.score} 分（${item.analyzedRepCount} 次有效分析）。`,
          evidenceRefs: [`exercise-score:${item.exerciseId}`],
        }]
      : [])
  return [...capabilityStrengths, ...exerciseStrengths].sort((left, right) =>
    right.value - left.value || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)).slice(0, ANALYSIS_CONFIG_V1.strengths.maxItems)
}
