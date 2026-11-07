import type { CoachProfile, Focus } from '../../../src/features/coachAgent/recommendation/types'

/** All scenario users, histories and reports are SYNTHETIC designs. Only the annotators' judgments are human. */
export interface SyntheticRoutineHistory {
  chapterId: string
  programId: string
  sessions: number
  completedSessions: number
  lastDaysAgo: number
  /** follow-along similarity 0-100 (same kind as the app's routine score), synthetic */
  meanScore: number
  trend: 'up' | 'flat' | 'down'
}
export interface SyntheticGameHistory { gameId: string; plays: number; completedPlays: number; lastDaysAgo: number }
export interface SyntheticHistory {
  dataOrigin: 'synthetic_scenario'
  sessionsLast28d: number
  routines: SyntheticRoutineHistory[]
  games: SyntheticGameHistory[]
}
export interface SyntheticFinding { focus: Exclude<Focus, 'general'>; subjectId: string; score: number; trend: 'worse' | 'same' | 'better'; label: string }
export interface SyntheticReport { dataOrigin: 'synthetic_scenario'; subjectId: string; daysAgo: number; findings: SyntheticFinding[] }

export interface Scenario {
  id: string
  familyId: string
  condition: 'A_profile' | 'B_history' | 'C_history_report'
  split: 'dev' | 'test'
  profile: CoachProfile
  history: SyntheticHistory | null
  report: SyntheticReport | null
  /** Judged candidate ids in annotator display order (seeded shuffle). */
  candidates: string[]
  /** Pool provenance kept for audit only; never shown to annotators. */
  pooledFrom: Record<string, Array<'rules_p0' | 'pr49_ranker' | 'random_fill'>>
}

export interface ScenarioFile {
  schemaVersion: 1
  id: string
  seed: number
  generatedBy: string
  dataOrigin: 'synthetic_scenarios_for_human_annotation'
  families: number
  scenarios: Scenario[]
}
