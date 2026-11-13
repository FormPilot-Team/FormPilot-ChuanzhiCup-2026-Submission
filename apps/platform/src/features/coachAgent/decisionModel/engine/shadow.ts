import type { CoachRecommendationResult } from '../../recommendation/types'
import type { CoachDecisionResponse } from './contract'

/**
 * SHADOW acceptance log (WEB_INTEGRATION_READY.md §10). Optional, separate import; used only in the Web's dev /
 * acceptance build while COACH_DECISION_MODE = 'shadow'. An entry holds no profile answers, no history values and no
 * free text: only content ids, the decision outcome and the call time. It is kept on the device; the Web never uploads it.
 * Checked offline by scripts/decision-model/cdm/shadow-acceptance.ts.
 */
export const COACH_DECISION_SHADOW_LOG_SCHEMA = 'fp-coach-decision-shadow-log/v1' as const
/** Suggested local key and cap for the acceptance build (memory-only logging is also fine). */
export const COACH_DECISION_SHADOW_LOG_KEY = 'formpilot.coach-decision-shadow-log:v1'
export const COACH_DECISION_SHADOW_LOG_MAX = 500

export interface CoachDecisionSlateIds { routines: string[]; chapters: string[]; games: string[] }
export interface CoachDecisionShadowLogEntry {
  schema: typeof COACH_DECISION_SHADOW_LOG_SCHEMA
  /** Epoch ms of the call. */
  at: number
  /** Wall time of the recommendCoachDecision call measured by the host (performance.now() delta); null = not measured. */
  elapsedMs: number | null
  mode: CoachDecisionResponse['mode']
  status: CoachDecisionResponse['status']
  decisionOrigin: CoachDecisionResponse['decisionOrigin']
  execution: CoachDecisionResponse['execution']
  fallbackReason: CoachDecisionResponse['fallbackReason']
  abstainReason: CoachDecisionResponse['abstainReason']
  outOfDistributionFeatures: string[]
  confidence: number | null
  release: string | null
  weightsFingerprint: string | null
  tier: string | null
  /** What the user saw (display), what the rules produced, and the model slate (ranking items in the slate, rank order). */
  displayed: CoachDecisionSlateIds
  rules: CoachDecisionSlateIds
  modelSlate: { chapters: string[]; games: string[] }
  rankingEffect: 'not_compared' | 'identical' | 'reordered' | 'changed'
  guardViolations: string[]
  inputIssueCount: number
  dataSources: CoachDecisionResponse['dataSources']
}

const ids = (result: CoachRecommendationResult | null | undefined): CoachDecisionSlateIds => ({
  routines: result?.routines.map(x => x.entry.id) ?? [],
  chapters: result?.chapters.map(x => x.entry.id) ?? [],
  games: result?.games.map(x => x.entry.id) ?? [],
})

export function toShadowLogEntry(res: CoachDecisionResponse, meta: { at: number; elapsedMs?: number | null }): CoachDecisionShadowLogEntry {
  const slate = res.ranking.filter(x => x.inSlate)
  return {
    schema: COACH_DECISION_SHADOW_LOG_SCHEMA, at: meta.at, elapsedMs: meta.elapsedMs ?? null,
    mode: res.mode, status: res.status, decisionOrigin: res.decisionOrigin, execution: res.execution,
    fallbackReason: res.fallbackReason, abstainReason: res.abstainReason, outOfDistributionFeatures: [...res.outOfDistributionFeatures],
    confidence: res.confidence, release: res.model?.release ?? null, weightsFingerprint: res.model?.weightsFingerprint ?? null, tier: res.model?.tier ?? null,
    displayed: ids(res.display?.result), rules: ids(res.rules.result),
    modelSlate: { chapters: slate.filter(x => x.kind === 'chapter').map(x => x.id), games: slate.filter(x => x.kind === 'game').map(x => x.id) },
    rankingEffect: res.comparison?.rankingEffect ?? 'not_compared', guardViolations: [...res.guard.violations],
    inputIssueCount: res.inputIssues.length, dataSources: { ...res.dataSources },
  }
}
