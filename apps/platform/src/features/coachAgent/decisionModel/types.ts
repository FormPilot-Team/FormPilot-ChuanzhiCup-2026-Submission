import type { BodyRegion, CoachEvidence, CoachQuestion, CoachRecommendationResult, Focus, KnowledgeEntry } from '../recommendation/types'
import type { CoachWebResponse } from '../recommendation/webContracts'

export const DECISION_MODEL_ID = 'fp-coach-ranker'
export const DECISION_MODEL_VERSION = '1.0.0'

/**
 * off    : default. Model code is not executed; the response is the P0 rules result.
 * shadow : model runs for offline comparison; the active result stays the P0 rules result.
 * active : controlled demo only; the guarded model slate becomes the active result.
 * Only trusted host code chooses the mode. A Web request can never enable the model.
 */
export type DecisionModelMode = 'off' | 'shadow' | 'active'

/** App-owned availability snapshot. It can only remove items; it never adds catalogue entries. */
export interface CatalogueAvailability {
  snapshotRef: string
  /** Programme ids (removes the routine and all its chapters), chapter ids or game ids. */
  unavailableIds: readonly string[]
}

export interface DecisionModelOptions {
  mode?: DecisionModelMode
  availability?: CatalogueAvailability
}

export type ModelExecution = 'disabled' | 'not_applicable' | 'executed' | 'failed'
export type DecisionFallbackReason =
  | 'MODEL_DISABLED' | 'SHADOW_MODE' | 'REQUEST_INVALID' | 'PROFILE_REQUIRED' | 'SAFETY_HOLD'
  | 'INVALID_AVAILABILITY' | 'INTEGRITY_MISMATCH' | 'MODEL_ERROR' | 'OUTPUT_GUARD_REJECTED'

export interface FeatureContribution {
  feature: 'region_relevance' | 'focus_alignment' | 'measured_involvement' | 'load_penalty' | 'evidence' | 'coverage_gain' | 'diversity_penalty'
  /** Raw feature value before weighting. */
  value: number
  weight: number
  /** weight × value (negative for penalties). */
  points: number
  detail: string
  sources: string[]
}

export interface DecisionSlateItem {
  /** 1-based position in the unified priority order. */
  rank: number
  id: string
  kind: 'chapter' | 'game'
  programId?: string
  title: string
  href: string | null
  launch: 'in_app_route' | 'external_app'
  matchLevel: 'primary' | 'supplementary'
  utility: number
  contributions: FeatureContribution[]
}

export interface CoverageGap {
  region: BodyRegion
  reason: 'NO_SAFE_LAUNCHABLE_ITEM'
}

export interface DecisionModelOutput {
  model: {
    id: typeof DECISION_MODEL_ID
    version: typeof DECISION_MODEL_VERSION
    kind: 'deterministic_constrained_ranker'
    trainedWeights: false
    descriptorsId: string
    descriptorsExtractorVersion: string
    catalogueFingerprint: string
  }
  status: 'ready' | 'empty'
  priority: DecisionSlateItem[]
  /** P0-compatible shape so existing Web components can render the slate. */
  result: CoachRecommendationResult
  answers: Record<CoachQuestion, string>
  focus: Focus[]
  coverage: { selectedRegions: BodyRegion[]; coveredRegions: BodyRegion[]; gaps: CoverageGap[] }
  excluded: { byAvailability: string[]; byMeasuredCaution: string[] }
  availabilityRef: string | null
}

export interface DecisionComparison {
  rankingEffect: 'not_compared' | 'identical' | 'reordered' | 'changed'
  /** Chapter/game ids present in the model slate but not in the rules slate. */
  addedIds: string[]
  /** Chapter/game ids present in the rules slate but not in the model slate. */
  removedIds: string[]
  /** Ids whose list position differs, including added/removed ones. */
  influencedIds: string[]
}

export interface CoachDecisionResponse {
  schemaVersion: 1
  /** The unchanged P0 response for the same request. Always computed and always a valid fallback. */
  rules: CoachWebResponse
  decisionOrigin: 'rules' | 'model'
  active: {
    status: CoachWebResponse['status']
    result: CoachRecommendationResult | null
    answers: Record<CoachQuestion, string> | null
  }
  mode: DecisionModelMode
  modelExecution: ModelExecution
  fallbackReason: DecisionFallbackReason | null
  /** Model slate when it executed (shadow or active); null otherwise. */
  model: DecisionModelOutput | null
  guard: { checked: boolean; violations: string[] }
  comparison: DecisionComparison
  /** Input provenance. Profiles are self-reported; synthetic fixtures stay labelled synthetic. */
  dataOrigin: 'self_report_profile' | 'self_report_profile_with_synthetic_fixture' | 'none'
  /** Rules results ignore host availability; listed ids are unavailable items the rules slate still shows. */
  rulesAvailabilityConflicts: string[]
  /** The model never starts training, games, timers, storage writes or network calls. */
  executedActions: false
  limitations: string[]
}

export interface RankerInput {
  profile: import('../recommendation/types').CoachProfile
  evidence: CoachEvidence[]
  availability: CatalogueAvailability | null
  catalogue: readonly KnowledgeEntry[]
}
