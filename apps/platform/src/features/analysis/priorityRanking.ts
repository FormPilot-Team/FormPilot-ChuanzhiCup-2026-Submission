import { ANALYSIS_CONFIG_V1 } from './config'
import { issueDefinition } from './issueTaxonomy'
import type { AnalysisIssue, PriorityIssue, WithinSessionInsight } from './types'

interface RankedGroup {
  issues: AnalysisIssue[]
  key: string
}
function groupIssues(issues: readonly AnalysisIssue[]): RankedGroup[] {
  const groups = new Map<string, AnalysisIssue[]>()
  for (const issue of issues.filter((item) => item.significant)) {
    const definition = issueDefinition(issue.exerciseId, issue.code)
    const key = definition?.pairKey ?? `${issue.exerciseId}:theme:${issue.theme}`
    const existing = groups.get(key) ?? []
    existing.push(issue)
    groups.set(key, existing)
  }
  return [...groups.entries()].map(([key, items]) => ({ key, issues: items.slice().sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0) }))
}

function historyFactor(issues: readonly AnalysisIssue[]): number {
  const factors = issues.map((item) => item.trend ? ANALYSIS_CONFIG_V1.priority.historyFactors[item.trend] : 1)
  return Math.max(...factors, 1)
}

function makePriority(group: RankedGroup, within: readonly WithinSessionInsight[]): PriorityIssue {
  const primary = group.issues[0]
  const affected = group.issues.reduce((sum, item) => sum + item.incidence.affected, 0)
  const evaluable = group.issues.reduce((sum, item) => sum + item.incidence.evaluable, 0)
  const incidence = evaluable > 0 ? affected / evaluable : 0
  const weight = Math.max(...group.issues.map((item) => issueDefinition(item.exerciseId, item.code)?.technicalPriorityWeight ?? 1))
  const hasWithinImprovement = group.issues.some((item) => within.some((insight) => insight.exerciseId === item.exerciseId && insight.issueCode === item.code))
  const technicalPriority = Number((weight * incidence * historyFactor(group.issues)
    * (hasWithinImprovement ? ANALYSIS_CONFIG_V1.priority.withinSessionFactor : 1)).toFixed(6))
  const sides = new Set(group.issues.map((item) => item.side).filter((side) => side === 'left' || side === 'right'))
  return {
    ...primary,
    id: `priority:${group.key}`,
    side: sides.size > 1 ? 'bilateral' : primary.side,
    label: group.issues.length > 1 ? `${primary.theme === 'elbow_extension' ? '双侧肘部伸展' : primary.label}` : primary.label,
    incidence: { affected, evaluable },
    rate: evaluable > 0 ? affected / evaluable : null,
    reminderCount: group.issues.reduce((sum, item) => sum + item.reminderCount, 0),
    evidenceRefs: [...new Set(group.issues.flatMap((item) => item.evidenceRefs))],
    technicalPriority,
    mergedFrom: group.issues.map((item) => item.id),
  }
}

export function rankPriorityIssues(issues: readonly AnalysisIssue[], within: readonly WithinSessionInsight[]): PriorityIssue[] {
  const ranked = groupIssues(issues).map((group) => makePriority(group, within)).sort((left, right) =>
    right.technicalPriority - left.technicalPriority
    || right.incidence.affected - left.incidence.affected
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  const counts = new Map<string, number>()
  const selected: PriorityIssue[] = []
  for (const item of ranked) {
    const count = counts.get(item.exerciseId) ?? 0
    if (count >= ANALYSIS_CONFIG_V1.priority.maxPerExercise) continue
    selected.push(item)
    counts.set(item.exerciseId, count + 1)
    if (selected.length === ANALYSIS_CONFIG_V1.priority.maxItems) break
  }
  return selected
}
