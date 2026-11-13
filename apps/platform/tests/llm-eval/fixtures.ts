import { recommendCoachDecision } from '../../src/features/coachAgent/decisionModel/engine'
import { collectLocalDecisionInput } from '../../src/features/coachAgent/decisionModel/engine/platform'
import type { CoachProfile } from '../../src/features/coachAgent/recommendation/types'
import type { AgentTransport } from '../../src/features/coachLlm/agent'
import type { AgentToolContext } from '../../src/features/coachLlm/tools'
import { createBridgeTransport } from '../../src/features/coachLlm/transport'
import { ROUTINE_SESSION_STORAGE_KEY } from '../../src/features/routines/session/RoutineSessionRepository'
import { SESSION_STORAGE_KEY } from '../../src/features/training/LocalStorageTrainingSessionRepository'
import { FULL_IMPROVEMENT, at, makeSession } from '../analysis-fixtures'
import { routineRecord } from '../helpers/routineFixtures'

/**
 * Evaluation fixtures (TEST DATA, not real users): golden warm-up sessions from the analysis test suite and generated
 * routine records, stored as `live`/`normal` so the readers treat them like real camera sessions. Every report that
 * uses them says so.
 */
export const BRIDGE = process.env.FP_AGENT_URL ?? 'http://127.0.0.1:4321'
export const ORIGIN = 'http://127.0.0.1:4173'

export function bridgeTransport(): AgentTransport {
  const fetcher: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), Origin: ORIGIN } })
  return createBridgeTransport(BRIDGE, fetcher)
}

export function memoryStorage(entries: Record<string, unknown>): Pick<Storage, 'getItem'> {
  const map = new Map(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]))
  return { getItem: (key: string) => map.get(key) ?? null }
}

export const WARMUP_RECORDS = [...FULL_IMPROVEMENT.history, FULL_IMPROVEMENT.current]
export const ROUTINE_RECORDS = [
  routineRecord({ id: 'eval-bdj-old', startedAt: at(3), chapters: { 'bdj-5': { similarity: 0.6 } } }),
  routineRecord({ id: 'eval-bdj-new', startedAt: at(5), chapters: { 'bdj-2': { similarity: 0.62 }, 'bdj-5': { similarity: 0.58 } } }),
]
export const SYNTHETIC_ONLY = [makeSession({ id: 'eval-synthetic', startedAt: at(4), source: 'synthetic' })]

export const PROFILE: CoachProfile = { version: 1, goals: ['mobility'], difficulties: ['stiffness'], regions: ['shoulders', 'neck'], preference: 'mixed', risk: 'none', acknowledged: true }
export const RISK_PROFILE: CoachProfile = { ...PROFILE, risk: 'acute_pain' }

export interface ContextOptions { consent?: boolean; profile?: CoachProfile | null; warmup?: unknown[]; routine?: unknown[] }

export function toolContext(options: ContextOptions = {}): AgentToolContext {
  const storage = memoryStorage({
    ...(options.warmup ?? WARMUP_RECORDS ? { [SESSION_STORAGE_KEY]: options.warmup ?? WARMUP_RECORDS } : {}),
    ...(options.routine ?? ROUTINE_RECORDS ? { [ROUTINE_SESSION_STORAGE_KEY]: options.routine ?? ROUTINE_RECORDS } : {}),
  })
  const consent = options.consent ?? true
  const profile = options.profile === undefined ? PROFILE : options.profile
  return {
    storage, now: () => at(6), recordsConsent: consent, gamesAvailable: null,
    // Same call as the competition build's AI Coach page: ACTIVE with the owner-approved experimental model.
    recommend: () => profile ? recommendCoachDecision(collectLocalDecisionInput(profile, { storage, now: at(6), consent: consent ? 'granted' : 'denied' }), { mode: 'active', allowExperimentalModel: true }) : null,
  }
}
