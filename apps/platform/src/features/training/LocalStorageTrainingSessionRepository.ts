import type { TrainingSessionRepository } from './TrainingSessionRepository'
import { isTrainingSessionState, withSessionSource, type TrainingSessionState } from './types'

export const SESSION_STORAGE_KEY = 'ai-coach.sessions:v2'

export function parseStoredSessions(raw: unknown): TrainingSessionState[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isTrainingSessionState).map((item) => withSessionSource(item))
}

export function isStaleActiveSession(session: TrainingSessionState): boolean {
  if (!['ready', 'active', 'paused'].includes(session.status) || session.courseStatus !== 'in_progress' || session.endedAt !== undefined) return false
  return session.exercises.every((exercise) => !exercise.completed
    && exercise.repetitions.length === 0
    && exercise.feedbackEvents.length === 0
    && exercise.overallScore === 0)
}

export class LocalStorageTrainingSessionRepository implements TrainingSessionRepository {
  save(session: TrainingSessionState): boolean {
    if (typeof localStorage === 'undefined') return false
    try {
      const sessions = this.list().filter((item) => item.id === session.id || !isStaleActiveSession(item))
      const index = sessions.findIndex((item) => item.id === session.id)
      if (index >= 0) sessions[index] = structuredClone(session)
      else sessions.push(structuredClone(session))
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions.slice(-20)))
      return true
    } catch {
      return false
    }
  }

  get(id: string): TrainingSessionState | undefined {
    return this.list().find((item) => item.id === id)
  }

  list(): TrainingSessionState[] {
    if (typeof localStorage === 'undefined') return []
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY)
      if (!raw) return []
      return parseStoredSessions(JSON.parse(raw) as unknown)
    } catch {
      return []
    }
  }
}
