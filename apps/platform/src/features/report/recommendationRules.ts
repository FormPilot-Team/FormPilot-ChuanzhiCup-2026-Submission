import type { ExerciseReportSummary, CapabilitySummaryItem, ReportIssue, ReportRecommendation } from './types'

const ISSUE_RECOMMENDATIONS: Partial<Record<ReportIssue['errorCode'], string>> = {
  DEPTH_INSUFFICIENT: '下次深蹲时，可以重点关注下蹲深度，保持稳定节奏后再逐步加深动作。',
  ARM_TOO_LOW_R: '侧平举时重点关注右臂高度，尽量让双臂在顶部保持接近同一水平。',
  ARM_TOO_LOW_L: '侧平举时重点关注左臂高度，尽量让双臂在顶部保持接近同一水平。',
  ARM_LEG_UNSYNCED: '侧步开合时先放慢节奏，注意手臂和侧步尽量同步完成。',
  KNEE_TOO_LOW_L: '交替提膝时可以重点关注左侧提膝幅度，并保持身体居中。',
  KNEE_TOO_LOW_R: '交替提膝时可以重点关注右侧提膝幅度，并保持身体居中。',
  BODY_SWAY: '训练时可以先适当放慢动作，优先保持身体稳定。',
}

const CAPABILITY_RECOMMENDATIONS: Record<CapabilitySummaryItem['dimension'], string> = {
  AMPLITUDE: '下次训练可以优先关注动作幅度，并在保持稳定的前提下完成目标范围。',
  STABILITY: '下次训练可以适当放慢节奏，优先保持身体稳定。',
  COORDINATION: '下次训练可以先降低速度，关注左右动作与手脚配合的一致性。',
  TEMPO: '下次训练可以使用更均匀的速度完成抬起、停留和回落。',
  CONTROL: '下次训练可以重点完成完整起始位、目标位和回位过程。',
}

export function buildRecommendations(
  issues: ReadonlyArray<ReportIssue>,
  capabilities: ReadonlyArray<CapabilitySummaryItem>,
  exercises: ReadonlyArray<ExerciseReportSummary>,
  limit = 3,
): ReportRecommendation[] {
  const recommendations: ReportRecommendation[] = []
  const add = (item: ReportRecommendation) => {
    if (recommendations.length < limit && !recommendations.some((existing) => existing.text === item.text)) recommendations.push(item)
  }

  for (const issue of issues) {
    const text = ISSUE_RECOMMENDATIONS[issue.errorCode]
      ?? `下次进行${issue.exerciseName}时，可以重点关注“${issue.reportLabel}”，并保持稳定节奏。`
    add({ id: `issue:${issue.id}`, priority: recommendations.length + 1, sourceType: 'issue', sourceExercise: issue.exerciseId, sourceError: issue.errorCode, text })
  }

  const lowestCapability = capabilities
    .filter((item): item is CapabilitySummaryItem & { value: number } => item.value !== null)
    .sort((left, right) => left.value - right.value || left.dimension.localeCompare(right.dimension))[0]
  if (lowestCapability && lowestCapability.value < 75) {
    add({ id: `capability:${lowestCapability.dimension}`, priority: recommendations.length + 1, sourceType: 'capability', text: CAPABILITY_RECOMMENDATIONS[lowestCapability.dimension] })
  }

  const lowestMetric = exercises.flatMap((exercise) => exercise.metrics
    .filter((metric): metric is typeof metric & { value: number } => metric.value !== null)
    .map((metric) => ({ exercise, metric })))
    .sort((left, right) => left.metric.value - right.metric.value
      || left.exercise.exerciseId.localeCompare(right.exercise.exerciseId)
      || left.metric.key.localeCompare(right.metric.key))[0]
  if (lowestMetric && lowestMetric.metric.value < 75) {
    add({
      id: `metric:${lowestMetric.exercise.exerciseId}:${lowestMetric.metric.key}`,
      priority: recommendations.length + 1,
      sourceType: 'exercise_metric',
      sourceExercise: lowestMetric.exercise.exerciseId,
      text: `下次进行${lowestMetric.exercise.name}时，可以重点关注${lowestMetric.metric.label}，并结合实时纠错逐步调整。`,
    })
  }

  if (!recommendations.length) {
    add({ id: 'neutral:maintain', priority: 1, sourceType: 'neutral', text: '继续保持当前训练节奏，并完成更多动作以积累更完整的表现记录。' })
  }
  return recommendations
}
