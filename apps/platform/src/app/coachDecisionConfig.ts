import type { CoachDecisionMode } from '../features/coachAgent/decisionModel/engine'

/**
 * Web V1 switch for the fp-cdm decision engine (docs/ai-coach-agent/decision-model/WEB_INTEGRATION_READY.md §5).
 *
 * | Build                                                      | Mode   | Experimental weights               |
 * | ---------------------------------------------------------- | ------ | ---------------------------------- |
 * | `dev`, `build` (ordinary)                                  | off    | not approved                       |
 * | DEV + `?coachMode=shadow`, or `VITE_COACH_DECISION_MODE=shadow` | shadow | not approved                  |
 * | `competition:build` (`vite build --mode competition`)      | active | approved by the project owner (2026-11-09) |
 *
 * ACTIVE follows the build mode alone (`import.meta.env.MODE`, a compile-time constant). No URL parameter,
 * localStorage key, env value of an ordinary build or user action can turn it on or approve the experimental weights.
 * The engine's risk hold, candidate safety pool, Guard, abstention and fallbacks are unchanged in every mode.
 */
export type WebCoachDecisionMode = Extract<CoachDecisionMode, 'off' | 'shadow' | 'active'>

export interface CoachDecisionRuntime {
  mode: WebCoachDecisionMode
  /** Passed to `recommendCoachDecision` only by the competition build. */
  allowExperimentalModel: boolean
  source: 'default' | 'dev_shadow' | 'acceptance_shadow' | 'competition_build'
}

export const COACH_DECISION_DEFAULT_MODE: WebCoachDecisionMode = 'off'
export const COMPETITION_BUILD_MODE = 'competition'

export interface DecisionEnv { DEV?: boolean; MODE?: string; VITE_COACH_DECISION_MODE?: string }

export function resolveCoachDecisionRuntime(env: DecisionEnv = import.meta.env as DecisionEnv, search = typeof window === 'undefined' ? '' : window.location.search): CoachDecisionRuntime {
  if (env.MODE === COMPETITION_BUILD_MODE) return { mode: 'active', allowExperimentalModel: true, source: 'competition_build' }
  if (env.VITE_COACH_DECISION_MODE === 'shadow') return { mode: 'shadow', allowExperimentalModel: false, source: 'acceptance_shadow' }
  if (env.DEV && new URLSearchParams(search).get('coachMode') === 'shadow') return { mode: 'shadow', allowExperimentalModel: false, source: 'dev_shadow' }
  return { mode: COACH_DECISION_DEFAULT_MODE, allowExperimentalModel: false, source: 'default' }
}

/** Mode only, for places that just label it. */
export function resolveCoachDecisionMode(env?: DecisionEnv, search?: string): WebCoachDecisionMode {
  return resolveCoachDecisionRuntime(env, search).mode
}
