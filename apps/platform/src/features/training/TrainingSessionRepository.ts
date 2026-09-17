import type { TrainingSessionState } from './types'

export interface TrainingSessionRepository {
  save(session: TrainingSessionState): boolean
  get(id: string): TrainingSessionState | undefined
  list(): TrainingSessionState[]
}
