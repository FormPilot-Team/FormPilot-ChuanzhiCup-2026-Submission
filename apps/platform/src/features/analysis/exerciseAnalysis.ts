import { ANALYSIS_CONFIG_V1 } from './config'
import { exerciseName, SIDE_PAIR_COPY } from './copy'
import { buildIssues, withinSessionFinding } from './issueAnalysis'
import { finite, ratioText, scoreTrend } from './ratio'
import type { ExerciseFacts } from './sessionFacts'
import type { ExerciseAnalysis, IssueAnalysis, SideBalance } from './types'

function activeDuration(facts: ExerciseFacts): number | null {
  const repetitions = facts.record?.repetitions ?? []
  const starts = repetitions.map((item) => item?.rep?.startedAt).filter(finite)
  const ends = repetitions.map((item) => item?.rep?.completedAt).filter(finite)
  if (!starts.length || !ends.length) return null
  // Rep timestamps share the performance clock with pauses removed; never mix with Date.now() fields.
  const duration = ends[ends.length - 1] - starts[0]
  return duration > 0 ? duration : null
}

function sideBalance(issues: readonly IssueAnalysis[]): SideBalance[] {
  const groups = [...new Set(issues.filter((issue) => issue.side).map((issue) => issue.groupId))]
  return groups.map((groupId) => ({
    groupId,
    left: issues.find((issue) => issue.groupId === groupId && issue.side === 'left')?.stats ?? null,
    right: issues.find((issue) => issue.groupId === groupId && issue.side === 'right')?.stats ?? null,
  }))
}

function takeaway(facts: ExerciseFacts, issues: readonly IssueAnalysis[], rulesSupported: boolean, within: ExerciseAnalysis['withinExerciseImprovement']): string | null {
  if (facts.completion.status === 'not_started' || !rulesSupported) return null
  const name = exerciseName(facts.exerciseId)
  if (facts.counts.analyzed < ANALYSIS_CONFIG_V1.issue.minEvaluableReps) {
    return `有效识别次数不足（${facts.counts.analyzed} 次），本动作暂不分析问题。`
  }
  const significant = issues
    .map((issue, order) => ({ issue, order }))
    .filter(({ issue }) => issue.significance === 'SIGNIFICANT' && issue.stats)
    .sort((left, right) => (right.issue.technicalPriority ?? 0) - (left.issue.technicalPriority ?? 0)
      || right.issue.technicalPriorityWeight - left.issue.technicalPriorityWeight
      || left.order - right.order)
    .map(({ issue }) => issue)
  const top = significant[0]
  if (top?.stats) {
    const partner = top.side ? significant.find((issue) => issue !== top && issue.groupId === top.groupId) : undefined
    if (partner?.stats) {
      const [left, right] = top.side === 'left' ? [top, partner] : [partner, top]
      const label = SIDE_PAIR_COPY[top.groupId]?.reportLabel ?? top.reportLabel
      return `${name}：${label}，左侧 ${ratioText(left.stats as NonNullable<IssueAnalysis['stats']>, left.unit)}，右侧 ${ratioText(right.stats as NonNullable<IssueAnalysis['stats']>, right.unit)}。`
    }
    return `${name}：${top.reportLabel}，${ratioText(top.stats, top.unit)}。`
  }
  if (within) return within.text
  // v1's only optional evidence is the overhead TOP-phase elbow; never let "no issue" hide reps that could not be judged.
  const unjudged = Math.max(0, ...issues.filter((issue) => issue.significance === 'INSUFFICIENT_EVIDENCE').map((issue) => issue.missingEvidenceReps))
  if (unjudged > 0) return `本动作没有需要优先纠正的问题；另有 ${unjudged} 次无法判断举到顶部时手肘是否伸直。`
  return '本动作没有需要优先纠正的问题。'
}

export function analyzeExercise(facts: ExerciseFacts, previous: ExerciseFacts | null, rulesSupported: boolean): ExerciseAnalysis {
  const issues = rulesSupported ? buildIssues(facts, previous) : []
  const scores = facts.analyzed.map((item) => item.result.score)
  const consistency = scores.length >= ANALYSIS_CONFIG_V1.exerciseScore.minAnalyzedReps
    ? { minRepScore: Math.min(...scores), maxRepScore: Math.max(...scores), spread: Math.max(...scores) - Math.min(...scores) }
    : null
  const comparable = previous !== null && facts.score !== null && previous.score !== null
  const withinExerciseImprovement = rulesSupported ? withinSessionFinding(issues) : null
  return {
    exerciseId: facts.exerciseId,
    displayName: exerciseName(facts.exerciseId),
    evaluationMode: 'scored',
    completion: facts.completion,
    score: facts.score,
    previousScore: comparable ? previous.score : null,
    scoreDelta: comparable ? (facts.score as number) - (previous.score as number) : null,
    scoreTrend: comparable ? scoreTrend(facts.score as number, previous.score as number, ANALYSIS_CONFIG_V1.deadband.exercise) : null,
    reps: facts.counts,
    activeDurationMs: activeDuration(facts),
    consistency,
    tempo: facts.tempo,
    issues,
    sideBalance: sideBalance(issues),
    capabilityContribution: facts.contribution,
    withinExerciseImprovement,
    takeaway: takeaway(facts, issues, rulesSupported, withinExerciseImprovement),
  }
}
