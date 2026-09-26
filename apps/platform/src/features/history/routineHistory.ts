import { buildRoutineReport, type RoutineReport } from '../routines/report/routineReport'
import type { RoutineSessionRepository } from '../routines/session/RoutineSessionRepository'
import type { RoutineSessionRecord } from '../routines/session/types'
import type { TrainingHistoryItem } from './TrainingHistory'

export interface RoutineHistoryItem {
  record: RoutineSessionRecord
  report: RoutineReport
  incomplete: boolean
}

export type RoutineHistoryLoadState =
  | { status: 'ready'; items: RoutineHistoryItem[] }
  | { status: 'error' }

/** Same rule as Smart Training: test (synthetic) and fast-mode records stay out of the user's history. */
export function isPrimaryRoutineRecord(record: RoutineSessionRecord): boolean {
  return record.source === 'live' && record.mode === 'normal'
}

function compareRecords(left: RoutineSessionRecord, right: RoutineSessionRecord): number {
  return right.startedAt - left.startedAt || (left.id === right.id ? 0 : left.id < right.id ? 1 : -1)
}

export function buildRoutineHistoryItems(records: readonly RoutineSessionRecord[]): RoutineHistoryItem[] {
  return records
    .filter(isPrimaryRoutineRecord)
    .sort(compareRecords)
    .flatMap((record) => {
      const report = buildRoutineReport(record, records)
      return report ? [{ record, report, incomplete: record.outcome !== 'completed' }] : []
    })
}

export function loadRoutineHistory(repository: RoutineSessionRepository): RoutineHistoryLoadState {
  try {
    return { status: 'ready', items: buildRoutineHistoryItems(repository.list()) }
  } catch {
    return { status: 'error' }
  }
}

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
