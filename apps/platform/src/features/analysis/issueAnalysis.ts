import { ANALYSIS_CONFIG_V1 } from './config'
import { exerciseName } from './copy'
import type { EvidenceUnit } from './issueEvidence'
import { definitionsFor } from './issueTaxonomy'
import { compareCodeUnits, isSignificant, issueTrend, ratioOrNull, ratioText, significanceOf } from './ratio'
import type { ExerciseFacts } from './sessionFacts'
import type { Finding, IssueAnalysis, IssueComparison, IssueTrend, IssueUnit, Ratio, ReportIssueDefinition } from './types'

const WITHIN = ANALYSIS_CONFIG_V1.withinSession
const PRIORITY = ANALYSIS_CONFIG_V1.priority

export function issueUnit(definition: Pick<ReportIssueDefinition, 'canonicalId'>): IssueUnit {
  return definition.canonicalId === 'knee_raise.height_gap' ? '组' : '次'
}

function affectedCount(units: readonly EvidenceUnit[]): number {
  return units.filter((unit) => unit.affected).length
}

/** 8F-1A §17: first h vs last h evaluable units (odd n drops the middle one). */
function halves(units: readonly EvidenceUnit[]): { firstHalf: Ratio; secondHalf: Ratio } | null {
  const h = Math.floor(units.length / 2)
  if (h < WITHIN.minHalfReps) return null
  return {
    firstHalf: { affected: affectedCount(units.slice(0, h)), evaluable: h },
    secondHalf: { affected: affectedCount(units.slice(units.length - h)), evaluable: h },
  }
}

export function withinSessionImproved(split: { firstHalf: Ratio; secondHalf: Ratio } | null): boolean {
  return Boolean(split
    && split.firstHalf.affected >= WITHIN.minFirstHalfAffected
    && split.firstHalf.affected - split.secondHalf.affected >= WITHIN.minAffectedDrop)
}

function historyFactor(trend: IssueTrend | null): number {
  if (trend === 'NEW') return PRIORITY.historyFactor.NEW
  if (trend === 'PERSISTENT') return PRIORITY.historyFactor.PERSISTENT
  if (trend === 'WORSENED') return PRIORITY.historyFactor.WORSENED
  if (trend === 'IMPROVED') return PRIORITY.historyFactor.IMPROVED
  return PRIORITY.historyFactor.NONE
}

/** technicalPriorityWeight × incidence × historyFactor × withinSessionFactor. No clamping that could cancel IMPROVED. */
export function technicalPriority(definition: ReportIssueDefinition, stats: Ratio, trend: IssueTrend | null, improvedWithin: boolean): number {
  const value = definition.technicalPriorityWeight
    * (stats.affected / stats.evaluable)
    * historyFactor(trend)
    * (improvedWithin ? PRIORITY.withinSessionImprovedFactor : 1)
  return Math.round(value * 1e6) / 1e6
}

function comparisonOf(previousStats: Ratio | null, stats: Ratio | null): IssueComparison {
  const both = previousStats && stats
  return {
    trend: issueTrend(previousStats, stats),
    previous: previousStats,
    countDelta: both ? stats.affected - previousStats.affected : null,
    rateDeltaPct: both ? Math.round((stats.affected / stats.evaluable - previousStats.affected / previousStats.evaluable) * 100) : null,
  }
}

function reminderCount(definition: ReportIssueDefinition, facts: ExerciseFacts): number | null {
  // ARM_LEG_UNSYNCED maps to two canonical issues, so its prompts cannot be attributed to either.
  if (definition.runtimeCodes.includes('ARM_LEG_UNSYNCED')) return null
  const events = facts.record && Array.isArray(facts.record.feedbackEvents) ? facts.record.feedbackEvents : []
  return events.filter((event) => event?.kind === 'correction' && event.code !== undefined && definition.runtimeCodes.includes(event.code)).length
}

export function buildIssues(facts: ExerciseFacts, previous: ExerciseFacts | null): IssueAnalysis[] {
  return definitionsFor(facts.exerciseId).map((definition) => {
    const evidence = facts.evidence.get(definition.canonicalId)
    const units = evidence?.units ?? []
    const stats = facts.stats.get(definition.canonicalId) ?? null
    const comparison = previous ? comparisonOf(previous.stats.get(definition.canonicalId) ?? null, stats) : null
    const withinSession = halves(units)
    const significant = isSignificant(stats)
    return {
      canonicalId: definition.canonicalId,
      exerciseId: definition.exerciseId,
      groupId: definition.groupId,
      themeId: definition.themeId,
      side: definition.side,
      dimension: definition.dimension,
      bodyRegion: definition.bodyRegion,
      reportLabel: definition.reportLabel,
      cue: definition.cue,
      evidenceSource: definition.evidenceSource === 'derived' ? 'derived' : 'rep',
      unit: issueUnit(definition),
      technicalPriorityWeight: definition.technicalPriorityWeight,
      stats,
      missingEvidenceReps: evidence?.missingEvidenceReps ?? 0,
      significance: significanceOf(stats),
      reminderCount: reminderCount(definition, facts),
      sideBreakdown: evidence?.sideUnits
        ? {
            left: ratioOrNull(affectedCount(evidence.sideUnits.left), evidence.sideUnits.left.length),
            right: ratioOrNull(affectedCount(evidence.sideUnits.right), evidence.sideUnits.right.length),
          }
        : null,
      comparison,
      withinSession,
      technicalPriority: significant && stats
        ? technicalPriority(definition, stats, comparison?.trend ?? null, withinSessionImproved(withinSession))
        : null,
    }
  })
}

export function withinSessionFinding(issues: readonly IssueAnalysis[]): Finding | null {
  const candidates = issues
    .filter((issue) => withinSessionImproved(issue.withinSession))
    .sort((left, right) => {
      const drop = (issue: IssueAnalysis) => (issue.withinSession as NonNullable<IssueAnalysis['withinSession']>).firstHalf.affected
        - (issue.withinSession as NonNullable<IssueAnalysis['withinSession']>).secondHalf.affected
      return drop(right) - drop(left)
        || right.technicalPriorityWeight - left.technicalPriorityWeight
        || compareCodeUnits(left.canonicalId, right.canonicalId)
    })
  const issue = candidates[0]
  if (!issue || !issue.withinSession) return null
  const { firstHalf, secondHalf } = issue.withinSession
  return {
    id: `within:${issue.canonicalId}`,
    kind: 'WITHIN_SESSION_IMPROVEMENT',
    exerciseIds: [issue.exerciseId],
    canonicalIds: [issue.canonicalId],
    dimension: issue.dimension,
    evidence: { type: 'WITHIN_SESSION', firstHalf, secondHalf, unit: issue.unit },
    text: `${exerciseName(issue.exerciseId)}：${issue.reportLabel}，前 ${ratioText(firstHalf, issue.unit)}，后 ${ratioText(secondHalf, issue.unit)}。`,
  }
}
