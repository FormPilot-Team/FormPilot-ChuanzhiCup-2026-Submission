import { buildRoutineReport, type RoutineReport } from '../routines/report/routineReport'
import type { RoutineSessionRepository } from '../routines/session/RoutineSessionRepository'
import type { RoutineSessionRecord } from '../routines/session/types'

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

/** The merged cross-mode timeline lives in historyEntries; re-exported for existing callers. */
export { mergeHistoryEntries, type HistoryEntry } from './historyEntries'
