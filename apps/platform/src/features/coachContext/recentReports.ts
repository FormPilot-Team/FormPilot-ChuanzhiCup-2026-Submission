import type { TrainingHistoryItem } from '../history/TrainingHistory'
import { historyEntryHeadline, historyEntryModeId, historyEntryTitle, mergeHistoryEntries } from '../history/historyEntries'
import type { RoutineHistoryItem } from '../history/routineHistory'
import type { CustomHistoryItem } from '../history/customHistory'
import type { RecentReportSummary } from './types'

function path(sessionId: string): string {
  return `/report/${encodeURIComponent(sessionId)}`
}

/** The newest saved reports across all modes, as one-line summaries the coach could cite. */
export function buildRecentReports(
  smart: readonly TrainingHistoryItem[],
  routine: readonly RoutineHistoryItem[],
  limit = 5,
  custom: readonly CustomHistoryItem[] = [],
): RecentReportSummary[] {
  return mergeHistoryEntries(smart, routine, custom).slice(0, limit).map((entry) => ({
    sessionId: entry.id,
    modeId: historyEntryModeId(entry),
    modeTitle: historyEntryTitle(entry),
    startedAt: entry.startedAt,
    completed: !entry.incomplete,
    headline: historyEntryHeadline(entry),
    reportPath: path(entry.id),
  }))
}
