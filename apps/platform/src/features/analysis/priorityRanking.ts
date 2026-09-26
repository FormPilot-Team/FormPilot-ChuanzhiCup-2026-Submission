import { ANALYSIS_CONFIG_V1 } from './config'
import { exerciseList, exerciseName, SIDE_PAIR_COPY, THEME_COPY } from './copy'
import { compareCodeUnits, ratioText } from './ratio'
import type { AnalysisHighlightRegion, IssueAnalysis, IssueThemeId, PriorityIssue, PriorityMember, ScoredExerciseId } from './types'

const PRIORITY = ANALYSIS_CONFIG_V1.priority
const ORDER = ANALYSIS_CONFIG_V1.scoredExerciseIds

type Entry = Omit<PriorityIssue, 'rank'> & { weight: number; maxAffected: number; courseIndex: number }

function member(issue: IssueAnalysis): PriorityMember {
  return {
    canonicalId: issue.canonicalId,
    exerciseId: issue.exerciseId,
    side: issue.side,
    reportLabel: issue.reportLabel,
    unit: issue.unit,
    stats: issue.stats as NonNullable<IssueAnalysis['stats']>,
    trend: issue.comparison?.trend ?? null,
    technicalPriority: issue.technicalPriority as number,
  }
}

function bilateralRegion(region: AnalysisHighlightRegion): AnalysisHighlightRegion {
  if (region === 'left_arm' || region === 'right_arm' || region === 'left_elbow' || region === 'right_elbow') return 'both_arms'
  if (region === 'left_knee' || region === 'right_knee') return 'knees'
  return region
}

/** "6 次中 4 次", prefixed with the side for sided members: "左侧 6 次中 4 次". */
function memberEvidence(item: PriorityMember): string {
  const ratio = ratioText(item.stats, item.unit)
  return item.side === 'left' ? `左侧 ${ratio}` : item.side === 'right' ? `右侧 ${ratio}` : ratio
}

function singleEntry(issue: IssueAnalysis): Entry {
  const item = member(issue)
  return {
    id: issue.canonicalId,
    kind: 'ISSUE',
    canonicalIds: [issue.canonicalId],
    exerciseIds: [issue.exerciseId],
    themeId: issue.themeId,
    priority: item.technicalPriority,
    reportLabel: issue.reportLabel,
    cue: issue.cue,
    bodyRegion: issue.bodyRegion,
    members: [item],
    text: `${exerciseName(issue.exerciseId)}，${issue.reportLabel}（${ratioText(item.stats, item.unit)}）`,
    weight: issue.technicalPriorityWeight,
    maxAffected: item.stats.affected,
    courseIndex: ORDER.indexOf(issue.exerciseId),
  }
}

/** Both sides significant → one bilateral entry. Members keep their own ratios; counts are never summed. */
function sidePairEntry(left: IssueAnalysis, right: IssueAnalysis): Entry {
  const members = [member(left), member(right)]
  const copy = SIDE_PAIR_COPY[left.groupId] ?? { reportLabel: left.reportLabel, cue: left.cue }
  const evidence = members.map(memberEvidence).join('，')
  return {
    id: left.groupId,
    kind: 'SIDE_PAIR',
    canonicalIds: members.map((item) => item.canonicalId),
    exerciseIds: [left.exerciseId],
    themeId: left.themeId,
    priority: Math.max(...members.map((item) => item.technicalPriority)),
    reportLabel: copy.reportLabel,
    cue: copy.cue,
    bodyRegion: bilateralRegion(left.bodyRegion),
    members,
    text: `${exerciseName(left.exerciseId)}，${copy.reportLabel}（${evidence}）`,
    weight: left.technicalPriorityWeight,
    maxAffected: Math.max(...members.map((item) => item.stats.affected)),
    courseIndex: ORDER.indexOf(left.exerciseId),
  }
}

function themeCue(themeId: IssueThemeId, parts: Entry[]): string {
  if (themeId === 'TEMPO_TOO_FAST') {
    // Every tempo member carries its own seconds range; keep each exercise's range explicit.
    return `放慢速度：${parts.map((part) => `${exerciseName(part.exerciseIds[0])}${part.cue.replace(/^放慢(速度|节奏)，/, '')}`).join('；')}`
  }
  return `${THEME_COPY[themeId].cue}（${exerciseList(parts.map((part) => part.exerciseIds[0]))}）`
}

/** Same themeId significant in ≥2 DIFFERENT exercises → one cross-exercise entry. Never merges within one exercise. */
function themeEntry(themeId: IssueThemeId, parts: Entry[]): Entry {
  const sorted = [...parts].sort((left, right) => left.courseIndex - right.courseIndex)
  const members = sorted.flatMap((part) => part.members)
  const exerciseIds = sorted.map((part) => part.exerciseIds[0])
  const label = THEME_COPY[themeId].reportLabel
  const evidence = sorted.map((part) => `${exerciseName(part.exerciseIds[0])} ${part.members.map(memberEvidence).join('、')}`).join('，')
  const top = [...sorted].sort((left, right) => right.priority - left.priority || left.courseIndex - right.courseIndex)[0]
  return {
    id: `theme:${themeId}`,
    kind: 'THEME',
    canonicalIds: members.map((item) => item.canonicalId),
    exerciseIds,
    themeId,
    priority: Math.max(...sorted.map((part) => part.priority)),
    reportLabel: `${exerciseList(exerciseIds)}中都出现${label}`,
    cue: themeCue(themeId, sorted),
    bodyRegion: top.bodyRegion,
    members,
    text: `${exerciseList(exerciseIds)}中都出现${label}（${evidence}）`,
    weight: Math.max(...sorted.map((part) => part.weight)),
    maxAffected: Math.max(...members.map((item) => item.stats.affected)),
    courseIndex: Math.min(...sorted.map((part) => part.courseIndex)),
  }
}

export function rankPriorityIssues(issues: readonly IssueAnalysis[]): PriorityIssue[] {
  const significant = issues.filter((issue) => issue.significance === 'SIGNIFICANT' && issue.stats && issue.technicalPriority !== null)

  // 1. Left/right merge inside one exercise.
  const sideEntries: Entry[] = []
  const consumed = new Set<string>()
  for (const issue of significant) {
    if (consumed.has(issue.canonicalId)) continue
    const partner = issue.side ? significant.find((other) => other !== issue && other.groupId === issue.groupId) : undefined
    if (partner) {
      const [left, right] = issue.side === 'left' ? [issue, partner] : [partner, issue]
      sideEntries.push(sidePairEntry(left, right))
      consumed.add(left.canonicalId).add(right.canonicalId)
    } else {
      sideEntries.push(singleEntry(issue))
      consumed.add(issue.canonicalId)
    }
  }

  // 2. Cross-exercise theme merge.
  const entries: Entry[] = []
  const byTheme = new Map<IssueThemeId, Entry[]>()
  for (const entry of sideEntries) {
    if (entry.themeId) byTheme.set(entry.themeId, [...(byTheme.get(entry.themeId) ?? []), entry])
    else entries.push(entry)
  }
  for (const [themeId, parts] of byTheme) {
    const exercises = new Set(parts.map((part) => part.exerciseIds[0]))
    if (exercises.size >= PRIORITY.themeMinMembers) entries.push(themeEntry(themeId, parts))
    else entries.push(...parts)
  }

  // 3. Rank and select greedily under the caps.
  entries.sort((left, right) => right.priority - left.priority
    || right.weight - left.weight
    || right.maxAffected - left.maxAffected
    || left.courseIndex - right.courseIndex
    || compareCodeUnits(left.id, right.id))
  const perExercise = new Map<ScoredExerciseId, number>()
  const selected: PriorityIssue[] = []
  for (const entry of entries) {
    if (selected.length >= PRIORITY.maxItems) break
    if (entry.exerciseIds.some((id) => (perExercise.get(id) ?? 0) >= PRIORITY.maxPerExercise)) continue
    for (const id of entry.exerciseIds) perExercise.set(id, (perExercise.get(id) ?? 0) + 1)
    selected.push({
      rank: (selected.length + 1) as PriorityIssue['rank'],
      id: entry.id,
      kind: entry.kind,
      canonicalIds: entry.canonicalIds,
      exerciseIds: entry.exerciseIds,
      themeId: entry.themeId,
      priority: entry.priority,
      reportLabel: entry.reportLabel,
      cue: entry.cue,
      bodyRegion: entry.bodyRegion,
      members: entry.members,
      text: entry.text,
    })
  }
  return selected
}
