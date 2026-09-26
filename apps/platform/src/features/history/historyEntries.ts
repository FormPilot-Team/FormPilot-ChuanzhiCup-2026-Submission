import { scopeTitle } from '../routines/scope'
import { freeTrainingLabel } from '../training/trainingScope'
import { historyScoreText, type TrainingHistoryItem } from './TrainingHistory'
import type { RoutineHistoryItem } from './routineHistory'

/** Product name of Smart Training's full six-exercise course. */
export const WARM_UP_COURSE_TITLE = '热身训练 · 完整训练'

/** One training history across modes, newest first. Each kind keeps its own data and report. */
export type HistoryEntry =
  | { kind: 'smart'; id: string; startedAt: number; incomplete: boolean; smart: TrainingHistoryItem }
  | { kind: 'routine'; id: string; startedAt: number; incomplete: boolean; routine: RoutineHistoryItem }

export function mergeHistoryEntries(smart: readonly TrainingHistoryItem[], routine: readonly RoutineHistoryItem[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [
    ...smart.map((item) => ({ kind: 'smart' as const, id: item.session.id, startedAt: item.session.startedAt, incomplete: item.incomplete, smart: item })),
    ...routine.map((item) => ({ kind: 'routine' as const, id: item.record.id, startedAt: item.record.startedAt, incomplete: item.incomplete, routine: item })),
  ]
  return entries.sort((left, right) => right.startedAt - left.startedAt || (left.id === right.id ? 0 : left.id < right.id ? 1 : -1))
}

/** What was trained, as History and Home name it (e.g. 热身训练 · 完整训练, 八段锦 · 整套跟练). */
export function historyEntryTitle(entry: HistoryEntry): string {
  if (entry.kind === 'smart') {
    const { scope } = entry.smart
    return scope.kind === 'free_training' ? freeTrainingLabel(scope.exerciseId) : WARM_UP_COURSE_TITLE
  }
  return scopeTitle(entry.routine.report.program, entry.routine.record.scope)
}

/** The entry's own one-line result, exactly as its report states it. */
export function historyEntryHeadline(entry: HistoryEntry): string {
  if (entry.kind === 'smart') return historyScoreText(entry.smart.analysis, entry.smart.scope)
  return entry.routine.report.headline
}

/** Which product mode the entry belongs to; used for filters and the coach context. */
export function historyEntryModeId(entry: HistoryEntry): string {
  return entry.kind === 'smart' ? 'smart-training' : entry.routine.record.programId
}
