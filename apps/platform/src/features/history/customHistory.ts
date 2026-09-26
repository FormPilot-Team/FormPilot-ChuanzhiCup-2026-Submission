import { buildCustomActionReport, type CustomActionReport } from '../workshop/report'
import type { CustomActionSessionRecord, CustomSessionRepository } from '../workshop/session'

export interface CustomHistoryItem {
  record: CustomActionSessionRecord
  report: CustomActionReport
  incomplete: boolean
}

export type CustomHistoryLoadState =
  | { status: 'ready'; items: CustomHistoryItem[] }
  | { status: 'error' }

/** Same rule as the other modes: synthetic (test) and fast records stay out of the user's history. */
export function isPrimaryCustomRecord(record: CustomActionSessionRecord): boolean {
  return record.source === 'live' && record.mode === 'normal'
}

export function buildCustomHistoryItems(records: readonly CustomActionSessionRecord[]): CustomHistoryItem[] {
  return records
    .filter(isPrimaryCustomRecord)
    .sort((left, right) => right.startedAt - left.startedAt || (left.id < right.id ? 1 : -1))
    .map((record) => ({ record, report: buildCustomActionReport(record, records), incomplete: record.outcome !== 'completed' }))
}

export function loadCustomHistory(repository: CustomSessionRepository): CustomHistoryLoadState {
  try {
    return { status: 'ready', items: buildCustomHistoryItems(repository.list()) }
  } catch {
    return { status: 'error' }
  }
}
