import { parseStoredRoutineSessions, ROUTINE_SESSION_STORAGE_KEY } from '../../../routines/session/RoutineSessionRepository'
import type { RoutineSessionRecord } from '../../../routines/session/types'
import { COACH_KNOWLEDGE } from '../../recommendation/catalogue'
import { readRecommendationContext } from '../../recommendation/context'
import type { CoachProfile, KnowledgeEntry } from '../../recommendation/types'
import { COACH_DECISION_CONTRACT, type CoachDecisionInput, type CoachDecisionReport, type CoachDecisionTrainingHistory } from './contract'

/**
 * Mapping from the platform's own stores to CoachDecisionInput. Pure functions over already-validated records; the
 * local collector reuses the existing strict parsers and the consent-gated recommendation context reader. Nothing is
 * written, uploaded or repaired.
 */

/** Chapter counted as completed when at least this share of its seconds was followed. */
export const CHAPTER_COMPLETED_SHARE = 0.8
/** Score change (0..100) between the last two scored sessions that counts as up / down. */
export const TREND_DELTA = 5

/** RoutineSessionRecord[] (formpilot.routine-sessions:v1) -> aggregated per-chapter history. Live, normal-speed, finished sessions only. */
export function historyFromRoutineSessions(records: readonly RoutineSessionRecord[], catalogue: readonly KnowledgeEntry[] = COACH_KNOWLEDGE): CoachDecisionTrainingHistory | null {
  const chapters = new Set(catalogue.filter(e => e.kind === 'chapter').map(e => e.id))
  const per = new Map<string, { sessions: number; completed: number; scores: Array<{ at: number; score: number }>; last: number }>()
  const usable = records.filter(r => r.source === 'live' && r.mode === 'normal' && r.outcome !== 'in_progress')
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
  for (const record of usable) {
    const at = record.endedAt ?? record.startedAt
    for (const c of record.chapters) {
      if (!chapters.has(c.chapterId) || !(c.coveredSeconds > 0)) continue
      const item = per.get(c.chapterId) ?? { sessions: 0, completed: 0, scores: [], last: 0 }
      item.sessions += 1
      if (c.totalSeconds > 0 && c.coveredSeconds >= CHAPTER_COMPLETED_SHARE * c.totalSeconds) item.completed += 1
      if (c.samples > 0) item.scores.push({ at, score: Math.max(0, Math.min(100, (c.similaritySum / c.samples) * 100)) })
      item.last = Math.max(item.last, at)
      per.set(c.chapterId, item)
    }
  }
  if (!per.size) return null
  return {
    origin: 'live_local_records',
    chapters: [...per.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([chapterId, v]) => {
      const s = v.scores
      const delta = s.length >= 2 ? s[s.length - 1].score - s[s.length - 2].score : null
      return {
        chapterId, sessions: v.sessions, completedSessions: v.completed,
        meanScore: s.length ? Math.round((s.reduce((t, x) => t + x.score, 0) / s.length) * 10) / 10 : null,
        trend: delta === null ? null : delta >= TREND_DELTA ? 'up' as const : delta <= -TREND_DELTA ? 'down' as const : 'flat' as const,
        lastPracticedAt: v.last,
      }
    }),
  }
}

/**
 * Collects the decision input from this browser's local records. Call ONLY after the user granted the AI Coach data
 * consent; without consent it returns a profile-only input. Game history has no platform store yet and stays missing.
 */
export function collectLocalDecisionInput(profile: CoachProfile, deps: { storage: { getItem(key: string): string | null }; now: number; consent: 'granted' | 'denied' }): CoachDecisionInput {
  const input: CoachDecisionInput = { contract: COACH_DECISION_CONTRACT, profile, now: deps.now }
  if (deps.consent !== 'granted') return input
  let records: RoutineSessionRecord[] = []
  try {
    const raw = deps.storage.getItem(ROUTINE_SESSION_STORAGE_KEY)
    records = raw ? parseStoredRoutineSessions(JSON.parse(raw)) : []
  } catch { records = [] }
  const training = historyFromRoutineSessions(records)
  if (training) input.trainingHistory = training
  const known = new Set(COACH_KNOWLEDGE.map(e => e.id))
  const context = readRecommendationContext(deps.storage, deps.now)
  const reports = context.evidence.filter(e => e.category === 'report' && e.source === 'live' && typeof e.contentId === 'string' && known.has(e.contentId))
  const findings: CoachDecisionReport['findings'] = []
  for (const e of reports) for (const focus of e.focuses) {
    if (focus === 'general') continue
    if (!findings.some(f => f.focus === focus && f.subjectId === e.contentId)) findings.push({ focus, subjectId: e.contentId as string, score: null, trend: null })
  }
  if (findings.length) input.latestReport = { origin: 'live_local_records', createdAt: Math.max(...reports.map(e => e.occurredAt)), findings: findings.slice(0, 50) }
  return input
}
