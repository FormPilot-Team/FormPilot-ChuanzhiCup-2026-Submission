import type { PriorityIssue, Strength, SummarySentence, WithinSessionInsight } from './types'

export function buildSummary(input: {
  overallScore: number | null
  overallTrend: 'IMPROVED' | 'STABLE' | 'REGRESSED' | null
  priorityIssues: readonly PriorityIssue[]
  strengths: readonly Strength[]
  withinSession: readonly WithinSessionInsight[]
}): SummarySentence[] {
  const sentences: SummarySentence[] = []
  sentences.push(input.overallScore === null
    ? { id: 'summary:overall-unavailable', text: '本次没有满足完整课程总分所需的五个动作分析分数。', evidenceRefs: ['overall:unavailable'] }
    : { id: 'summary:overall', text: `本次五个计分动作的重算总分为 ${input.overallScore} 分。`, evidenceRefs: ['overall:score'] })
  if (input.overallTrend === 'IMPROVED') sentences.push({ id: 'summary:improvement', text: '与最近一次完整可比训练相比，总分达到提升阈值。', evidenceRefs: ['overall:trend'] })
  else if (input.priorityIssues[0]) sentences.push({
    id: 'summary:priority', text: `当前首要技术重点是${input.priorityIssues[0].label}（${input.priorityIssues[0].incidence.affected}/${input.priorityIssues[0].incidence.evaluable}）。`,
    evidenceRefs: input.priorityIssues[0].evidenceRefs,
  })
  else sentences.push({ id: 'summary:no-priority', text: '当前没有达到显著性门槛的重复技术问题。', evidenceRefs: ['issues:significance-threshold'] })
  if (input.strengths[0]) sentences.push({ id: 'summary:strength', text: input.strengths[0].text, evidenceRefs: input.strengths[0].evidenceRefs })
  else if (input.withinSession[0]) sentences.push({ id: 'summary:within', text: input.withinSession[0].text, evidenceRefs: input.withinSession[0].evidenceRefs })
  return sentences.slice(0, 4)
}
