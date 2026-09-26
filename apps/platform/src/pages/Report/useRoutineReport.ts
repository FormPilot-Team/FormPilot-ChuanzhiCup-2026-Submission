import { useMemo } from 'react'
import { buildRoutineReport, type RoutineReport } from '../../features/routines/report/routineReport'
import { LocalStorageRoutineSessionRepository, type RoutineSessionRepository } from '../../features/routines/session/RoutineSessionRepository'

export type RoutineReportState =
  | { status: 'ready'; report: RoutineReport }
  | { status: 'not_found' }
  | { status: 'error' }

export function loadRoutineReport(sessionId: string, repository: RoutineSessionRepository): RoutineReportState {
  try {
    const records = repository.list()
    const record = records.find((item) => item.id === sessionId)
    if (!record) return { status: 'not_found' }
    const report = buildRoutineReport(record, records)
    return report ? { status: 'ready', report } : { status: 'error' }
  } catch {
    return { status: 'error' }
  }
}

const localRepository = new LocalStorageRoutineSessionRepository()

export function useRoutineReport(sessionId: string, repository: RoutineSessionRepository = localRepository): RoutineReportState {
  return useMemo(() => loadRoutineReport(sessionId, repository), [repository, sessionId])
}
