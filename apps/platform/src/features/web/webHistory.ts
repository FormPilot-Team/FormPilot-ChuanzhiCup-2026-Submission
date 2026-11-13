import { customTrainingPath, reportPath, routineTrainingPath, trainingEntryPath } from '../../app/routes'
import { loadTrainingHistory } from '../history/TrainingHistory'
import { loadCustomHistory } from '../history/customHistory'
import { historyEntryHeadline, historyEntryTitle, mergeHistoryEntries, type HistoryEntry } from '../history/historyEntries'
import { buildHomeTrainingSummary, type HomeTrainingSummary } from '../history/homeSummary'
import { loadRoutineHistory } from '../history/routineHistory'
import { LocalStorageRoutineSessionRepository, type RoutineSessionRepository } from '../routines/session/RoutineSessionRepository'
import type { RoutineId } from '../routines/types'
import { LocalStorageTrainingSessionRepository } from '../training/LocalStorageTrainingSessionRepository'
import type { TrainingSessionRepository } from '../training/TrainingSessionRepository'
import { LocalStorageCustomSessionRepository, type CustomSessionRepository } from '../workshop/session'
import { LocalStorageCustomActionRepository, type CustomActionRepository } from '../workshop/store'
import type { CustomActionDefinition } from '../workshop/types'

/** Where a history entry came from, in the Web V1 board language (游戏 has no formal record store yet). */
export type WebHistorySource = 'training' | 'routine'

export interface WebHistoryRepositories {
  training?: TrainingSessionRepository
  routine?: RoutineSessionRepository
  custom?: CustomSessionRepository
  actions?: CustomActionRepository
}

export interface WebActionSummary {
  action: CustomActionDefinition
  lastTrainedAt: number | null
}

/**
 * One read of the user's local training data for the Web V1 boards. Every number here is derived from the
 * existing stores (smart / routine / custom sessions, 动作工坊 actions); nothing is estimated or filled in.
 */
export interface WebHistorySnapshot {
  entries: HistoryEntry[]
  finished: HistoryEntry[]
  /** At least one store could not be read; the rest is still shown. */
  unavailable: boolean
  summary: HomeTrainingSummary
  todayCount: number
  /** Consecutive local calendar days, ending today or yesterday, with at least one finished training. */
  streakDays: number
  actions: WebActionSummary[]
  actionsReadOnly: boolean
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function trainingStreakDays(finished: readonly HistoryEntry[], now: number): number {
  const days = new Set(finished.map((entry) => localDayKey(entry.startedAt)))
  const cursor = new Date(now)
  cursor.setHours(12, 0, 0, 0)
  if (!days.has(localDayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (days.has(localDayKey(cursor.getTime()))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** Active training time of an entry as its own record stores it; null when the record does not say. */
export function entryDurationMs(entry: HistoryEntry): number | null {
  if (entry.kind === 'routine') return entry.routine.record.activeMs
  if (entry.kind === 'custom') return entry.custom.record.activeMs
  const session = entry.smart.session
  if (typeof session.totalDurationMs === 'number') return session.totalDurationMs
  return session.endedAt !== undefined ? Math.max(0, session.endedAt - session.startedAt) : null
}

export function entrySource(entry: HistoryEntry): WebHistorySource {
  return entry.kind === 'routine' ? 'routine' : 'training'
}

export function entryRoutineId(entry: HistoryEntry): RoutineId | null {
  return entry.kind === 'routine' ? entry.routine.record.programId : null
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '时长未记录'
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒` : `${seconds} 秒`
}

export function formatEntryDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export { historyEntryHeadline, historyEntryTitle }

/** Where "带着重点再练一次" leads: the same exercise, routine form or custom action, never back to Home. */
export function entryRetrainPath(entry: HistoryEntry): string {
  if (entry.kind === 'custom') return customTrainingPath(entry.custom.record.actionId)
  if (entry.kind === 'smart') return trainingEntryPath(entry.smart.scope)
  const { programId, scope } = entry.routine.record
  return routineTrainingPath(programId, scope.kind === 'form' ? scope.chapterId : undefined)
}

export function entryReportPath(entry: HistoryEntry): string {
  return reportPath(entry.id)
}

export function loadWebHistory(repositories: WebHistoryRepositories = {}, now = Date.now()): WebHistorySnapshot {
  const training = repositories.training ?? new LocalStorageTrainingSessionRepository()
  const routine = repositories.routine ?? new LocalStorageRoutineSessionRepository()
  const custom = repositories.custom ?? new LocalStorageCustomSessionRepository()
  const actionRepository = repositories.actions ?? new LocalStorageCustomActionRepository()

  const smart = loadTrainingHistory(training)
  const routines = loadRoutineHistory(routine)
  const customs = loadCustomHistory(custom)
  const entries = mergeHistoryEntries(
    smart.status === 'ready' ? smart.items : [],
    routines.status === 'ready' ? routines.items : [],
    customs.status === 'ready' ? customs.items : [],
  )
  const finished = entries.filter((entry) => !entry.incomplete)
  const todayKey = localDayKey(now)

  let actions: WebActionSummary[] = []
  let actionsReadOnly = false
  let actionsUnavailable = false
  try {
    const loaded = actionRepository.load()
    actionsReadOnly = loaded.readOnly
    let sessions: ReturnType<CustomSessionRepository['list']> = []
    try { sessions = custom.list() } catch { sessions = [] }
    const lastTrained = new Map<string, number>()
    for (const session of sessions) lastTrained.set(session.actionId, Math.max(lastTrained.get(session.actionId) ?? 0, session.startedAt))
    actions = loaded.actions
      .map((action) => ({ action, lastTrainedAt: lastTrained.get(action.id) ?? null }))
      .sort((left, right) => (right.lastTrainedAt ?? 0) - (left.lastTrainedAt ?? 0) || Date.parse(right.action.updatedAt) - Date.parse(left.action.updatedAt))
  } catch {
    actionsUnavailable = true
  }

  return {
    entries,
    finished,
    unavailable: smart.status === 'error' || routines.status === 'error' || customs.status === 'error' || actionsUnavailable,
    summary: buildHomeTrainingSummary(entries, now),
    todayCount: finished.filter((entry) => localDayKey(entry.startedAt) === todayKey).length,
    streakDays: trainingStreakDays(finished, now),
    actions,
    actionsReadOnly,
  }
}

/** "昨天训练" style relative day for the action cards. */
export function relativeDayText(timestamp: number | null, now = Date.now()): string {
  if (timestamp === null) return '从未训练'
  const start = (value: number) => { const date = new Date(value); date.setHours(0, 0, 0, 0); return date.getTime() }
  const days = Math.round((start(now) - start(timestamp)) / 86_400_000)
  if (days <= 0) return '今天训练'
  if (days === 1) return '昨天训练'
  if (days < 7) return `${days} 天前训练`
  const date = new Date(timestamp)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日训练`
}
