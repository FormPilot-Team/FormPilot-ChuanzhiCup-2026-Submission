import type { CoachEvidence, CoachProfile, Focus } from '../../recommendation/types'

/**
 * Canonical decision state (StartLux-style observation layer). Missing facts stay missing: no defaults
 * are invented, and every block carries its origin so synthetic or fixture data never looks live.
 */
export type DataOriginTag = 'live_reader' | 'synthetic_scenario' | 'synthetic_fixture'

export interface StateRoutineRecord {
  chapterId: string
  programId: string
  sessions: number
  completedSessions: number | null
  lastDaysAgo: number | null
  /** 0-100 follow-along similarity; null when not observed */
  meanScore: number | null
  trend: 'up' | 'flat' | 'down' | null
}
export interface StateGameRecord { gameId: string; plays: number; completedPlays: number | null; lastDaysAgo: number | null }
export interface StateFinding { focus: Exclude<Focus, 'general'>; subjectId: string; score: number | null; trend: 'worse' | 'same' | 'better' | null }

export interface DecisionState {
  profile: CoachProfile
  history: { status: 'missing' } | { status: 'present'; origin: DataOriginTag; sessionsLast28d: number | null; routines: StateRoutineRecord[]; games: StateGameRecord[] }
  report: { status: 'missing' } | { status: 'present'; origin: DataOriginTag; daysAgo: number | null; findings: StateFinding[] }
}

/** Scenario (annotation set) history/report -> state. Same shape the trained model saw. */
export function stateFromScenario(profile: CoachProfile, history: null | { sessionsLast28d: number; routines: StateRoutineRecord[]; games: StateGameRecord[] },
  report: null | { daysAgo: number; findings: StateFinding[] }): DecisionState {
  return {
    profile,
    history: history ? { status: 'present', origin: 'synthetic_scenario', sessionsLast28d: history.sessionsLast28d, routines: history.routines.map(r => ({ ...r })), games: history.games.map(g => ({ ...g })) } : { status: 'missing' },
    report: report ? { status: 'present', origin: 'synthetic_scenario', daysAgo: report.daysAgo, findings: report.findings.map(f => ({ focus: f.focus, subjectId: f.subjectId, score: f.score, trend: f.trend })) } : { status: 'missing' },
  }
}

const DAY = 86_400_000
/**
 * App evidence (validated CoachEvidence from the readers or the explicit synthetic fixture) -> state.
 * Only counts what the evidence actually states; unobserved quantities stay null.
 */
export function stateFromEvidence(profile: CoachProfile, evidence: readonly CoachEvidence[], now: number, chapterProgramme: (id: string) => string | undefined): DecisionState {
  const training = evidence.filter(e => e.category === 'training' && typeof e.contentId === 'string')
  const games = evidence.filter(e => e.category === 'game' && typeof e.contentId === 'string')
  const reports = evidence.filter(e => e.category === 'report')
  const origin: DataOriginTag = evidence.some(e => e.source === 'synthetic') ? 'synthetic_fixture' : 'live_reader'
  const routines = new Map<string, StateRoutineRecord>()
  for (const item of training) {
    const programId = chapterProgramme(item.contentId as string)
    if (!programId) continue
    const days = Math.max(0, Math.round((now - item.occurredAt) / DAY))
    const prev = routines.get(item.contentId as string)
    routines.set(item.contentId as string, { chapterId: item.contentId as string, programId, sessions: (prev?.sessions ?? 0) + 1, completedSessions: null, lastDaysAgo: Math.min(prev?.lastDaysAgo ?? days, days), meanScore: null, trend: null })
  }
  const gameMap = new Map<string, StateGameRecord>()
  for (const item of games) {
    const days = Math.max(0, Math.round((now - item.occurredAt) / DAY))
    const prev = gameMap.get(item.contentId as string)
    gameMap.set(item.contentId as string, { gameId: item.contentId as string, plays: (prev?.plays ?? 0) + 1, completedPlays: null, lastDaysAgo: Math.min(prev?.lastDaysAgo ?? days, days) })
  }
  const findings: StateFinding[] = reports.flatMap(item => item.focuses.filter((f): f is Exclude<Focus, 'general'> => f !== 'general').map(focus => ({ focus, subjectId: item.contentId ?? '', score: null, trend: null })))
  return {
    profile,
    history: routines.size || gameMap.size ? { status: 'present', origin, sessionsLast28d: null, routines: [...routines.values()], games: [...gameMap.values()] } : { status: 'missing' },
    report: findings.length ? { status: 'present', origin, daysAgo: null, findings } : { status: 'missing' },
  }
}
