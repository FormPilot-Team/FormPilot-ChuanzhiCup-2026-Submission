import type { CoachDecisionMode } from '../features/coachAgent/decisionModel/engine'

/**
 * Web V1 switch for the fp-cdm decision engine (docs/ai-coach-agent/decision-model/WEB_INTEGRATION_READY.md §5).
 *
 * - Product default is `off`: users see the Agent Web P0 rule recommendation, the model does not run.
 * - `shadow` is for development / internal acceptance only: users still see the rule result, the model runs in the
 *   background and its ranking is shown in a clearly labelled developer panel and written to the local SHADOW log.
 *   Enable it with `VITE_COACH_DECISION_MODE=shadow` at build time, or with `?coachMode=shadow` in a DEV server.
 * - `active` is never selectable here: it needs the project owner's approval, and this build never passes
 *   `allowExperimentalModel: true`.
 */
export type WebCoachDecisionMode = Extract<CoachDecisionMode, 'off' | 'shadow'>

export const COACH_DECISION_DEFAULT_MODE: WebCoachDecisionMode = 'off'

export function resolveCoachDecisionMode(env: { DEV?: boolean; VITE_COACH_DECISION_MODE?: string } = import.meta.env, search = typeof window === 'undefined' ? '' : window.location.search): WebCoachDecisionMode {
  if (env.VITE_COACH_DECISION_MODE === 'shadow') return 'shadow'
  if (env.DEV && new URLSearchParams(search).get('coachMode') === 'shadow') return 'shadow'
  return COACH_DECISION_DEFAULT_MODE
}
