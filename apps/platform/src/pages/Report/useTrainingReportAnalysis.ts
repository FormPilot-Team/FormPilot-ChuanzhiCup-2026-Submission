import { useMemo } from 'react'
import { analyzeTraining } from '../../features/analysis'
import type { TrainingAnalysis } from '../../features/analysis'
import { LocalStorageTrainingSessionRepository } from '../../features/training/LocalStorageTrainingSessionRepository'
import type { TrainingSessionRepository } from '../../features/training/TrainingSessionRepository'
import type { TrainingSessionState } from '../../features/training/types'

export type TrainingReportAnalysisState =
  | { status: 'ready'; session: TrainingSessionState; analysis: TrainingAnalysis }
  | { status: 'not_found' }
  | { status: 'error'; session: TrainingSessionState | null }

export function loadTrainingReportAnalysis(
  sessionId: string,
  repository: TrainingSessionRepository,
): TrainingReportAnalysisState {
  let session: TrainingSessionState | undefined
  try {
    session = repository.get(sessionId)
    if (!session) return { status: 'not_found' }
    return { status: 'ready', session, analysis: analyzeTraining(session, repository.list()) }
  } catch {
    return { status: 'error', session: session ?? null }
  }
}

const localRepository = new LocalStorageTrainingSessionRepository()

export function useTrainingReportAnalysis(
  sessionId: string,
  repository: TrainingSessionRepository = localRepository,
): TrainingReportAnalysisState {
  return useMemo(() => loadTrainingReportAnalysis(sessionId, repository), [repository, sessionId])
}
