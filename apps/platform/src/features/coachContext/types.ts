/**
 * What a future AI Coach conversation may read about the user's training. Reserved in the Integration Phase:
 * training modes expose it, nothing consumes it yet, and no LLM is involved. Everything here is already shown to
 * the user on screen or in a report, so the coach can only explain, never invent.
 */
export type CoachModeKind = 'smart-training' | 'routine'

export type CoachFeedbackTone = 'neutral' | 'info' | 'success' | 'warning'

export interface CoachContextMode {
  id: string
  title: string
  kind: CoachModeKind
}

export interface CoachContextExercise {
  id: string
  name: string
  /** Human position inside the session, e.g. 第三式 · 3 / 10. */
  position?: string
  /** The teaching cue currently shown. */
  cue?: string
}

export interface CoachContextFeedback {
  code: string
  message: string
  tone: CoachFeedbackTone
}

export interface CoachSessionStats {
  /** Course state as the training page shows it (PREPARING, ACTIVE, PAUSED, …). */
  state: string
  elapsedSeconds: number
  totalSeconds: number | null
  /** Mode-specific live numbers (percentages 0–100 or counts); never re-derived by the coach. */
  metrics: Readonly<Record<string, number | null>>
}

export interface RecentReportSummary {
  sessionId: string
  modeId: string
  modeTitle: string
  startedAt: number
  completed: boolean
  /** The report's own one-line summary. */
  headline: string
  reportPath: string
}

export interface CoachContext {
  currentMode: CoachContextMode
  currentExercise: CoachContextExercise | null
  currentFeedback: CoachContextFeedback | null
  sessionStats: CoachSessionStats | null
  recentReports: ReadonlyArray<RecentReportSummary>
}
