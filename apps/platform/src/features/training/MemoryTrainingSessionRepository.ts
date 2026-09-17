import type { TrainingSessionRepository } from './TrainingSessionRepository'
import type { TrainingSessionState } from './types'

export class MemoryTrainingSessionRepository implements TrainingSessionRepository {
  private sessions: TrainingSessionState[] = []

  save(session: TrainingSessionState): boolean {
    const index = this.sessions.findIndex((item) => item.id === session.id)
    if (index >= 0) this.sessions[index] = structuredClone(session)
    else this.sessions.push(structuredClone(session))
    this.sessions = this.sessions.slice(-20)
    return true
  }

  get(id: string): TrainingSessionState | undefined {
    return this.sessions.find((item) => item.id === id)
  }

  list(): TrainingSessionState[] {
    return structuredClone(this.sessions)
  }
}
