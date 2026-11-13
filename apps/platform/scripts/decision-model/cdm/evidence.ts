import { COACH_KNOWLEDGE } from '../../../src/features/coachAgent/recommendation/catalogue'
import type { CoachEvidence, Focus } from '../../../src/features/coachAgent/recommendation/types'
import type { SyntheticHistory, SyntheticReport } from './scenarioTypes'

/** Programme-level focus mapping copied from recommendation/context.ts (SUBJECT_FOCUS) so baselines see history the way the app would. */
const SUBJECT_FOCUS: Record<string, Focus[]> = { baduanjin: ['coordination', 'rhythm'], taijiquan: ['coordination', 'stability'], wuqinxi: ['coordination', 'rhythm'], yijinjing: ['stability'] }
const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 7, 12)

/**
 * Converts a synthetic scenario history/report into CoachEvidence (source: synthetic) so P0 and PR #49
 * baselines receive the same information as the trained model. Mirrors recommendation/context.ts shapes.
 */
export function scenarioEvidence(history: SyntheticHistory | null, report: SyntheticReport | null): CoachEvidence[] {
  const out: CoachEvidence[] = []
  for (const item of history?.routines ?? []) {
    out.push({ id: `syn:training:${item.chapterId}`, category: 'training', source: 'synthetic', title: `合成历史：${item.chapterId}`,
      detail: `${item.sessions} 次，完成 ${item.completedSessions}，均分 ${item.meanScore}`, focuses: SUBJECT_FOCUS[item.programId] ?? ['general'],
      contentId: item.chapterId, occurredAt: NOW - item.lastDaysAgo * DAY, references: [`scenario:history:${item.chapterId}`] })
  }
  for (const item of history?.games ?? []) {
    const game = COACH_KNOWLEDGE.find(entry => entry.id === item.gameId)
    out.push({ id: `syn:game:${item.gameId}`, category: 'game', source: 'synthetic', title: `合成游戏记录：${item.gameId}`,
      detail: `${item.plays} 局，完成 ${item.completedPlays}`, focuses: game?.focuses ?? ['general'], contentId: item.gameId,
      occurredAt: NOW - item.lastDaysAgo * DAY, references: [`scenario:game:${item.gameId}`] })
  }
  for (const [index, finding] of (report?.findings ?? []).entries()) {
    out.push({ id: `syn:report:${index}`, category: 'report', source: 'synthetic', title: finding.label, detail: `分项 ${finding.score}/100，趋势 ${finding.trend}`,
      focuses: [finding.focus], contentId: finding.subjectId, occurredAt: NOW - (report?.daysAgo ?? 0) * DAY, references: [`scenario:report:${index}`] })
  }
  return out
}
