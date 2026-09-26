import { historyScoreText, type TrainingHistoryItem } from '../history/TrainingHistory'
import { mergeHistoryEntries, type RoutineHistoryItem } from '../history/routineHistory'
import { scopeTitle } from '../routines/scope'
import { freeTrainingLabel } from '../training/trainingScope'
import type { RecentReportSummary } from './types'

function path(sessionId: string): string {
  return `/report/${encodeURIComponent(sessionId)}`
}

/** The newest saved reports across all modes, as one-line summaries the coach could cite. */
export function buildRecentReports(
  smart: readonly TrainingHistoryItem[],
  routine: readonly RoutineHistoryItem[],
  limit = 5,
): RecentReportSummary[] {
  return mergeHistoryEntries(smart, routine).slice(0, limit).map((entry) => {
    if (entry.kind === 'smart') {
      const { analysis, scope, session } = entry.smart
      return {
        sessionId: session.id,
        modeId: 'smart-training',
        modeTitle: scope.kind === 'free_training' ? freeTrainingLabel(scope.exerciseId) : '智能训练 · 完整训练',
        startedAt: session.startedAt,
        completed: !entry.incomplete,
        headline: historyScoreText(analysis, scope),
        reportPath: path(session.id),
      }
    }
    const { record, report } = entry.routine
    return {
      sessionId: record.id,
      modeId: record.programId,
      modeTitle: scopeTitle(report.program, record.scope),
      startedAt: record.startedAt,
      completed: !entry.incomplete,
      headline: report.headline,
      reportPath: path(record.id),
    }
  })
}
