import { useMemo } from 'react'
import { buildCustomActionReport, type CustomActionReport } from '../../features/workshop/report'
import { LocalStorageCustomSessionRepository, isCustomSessionId, type CustomSessionRepository } from '../../features/workshop/session'
import { LocalStorageCustomActionRepository, type CustomActionRepository } from '../../features/workshop/store'

export type CustomActionReportState =
  | { status: 'ready'; report: CustomActionReport; actionExists: boolean }
  | { status: 'not_found' }
  | { status: 'error' }

export function loadCustomActionReport(sessionId: string, sessions: CustomSessionRepository, actions: CustomActionRepository): CustomActionReportState {
  if (!isCustomSessionId(sessionId)) return { status: 'not_found' }
  try {
    const records = sessions.list()
    const record = records.find((item) => item.id === sessionId)
    if (!record) return { status: 'not_found' }
    return { status: 'ready', report: buildCustomActionReport(record, records), actionExists: Boolean(actions.get(record.actionId)) }
  } catch {
    return { status: 'error' }
  }
}

const localSessions = new LocalStorageCustomSessionRepository()
const localActions = new LocalStorageCustomActionRepository()

export function useCustomActionReport(sessionId: string, sessions: CustomSessionRepository = localSessions, actions: CustomActionRepository = localActions): CustomActionReportState {
  return useMemo(() => loadCustomActionReport(sessionId, sessions, actions), [actions, sessionId, sessions])
}
