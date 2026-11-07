import type { CoachProfile, CoachQuestion, CoachRecommendationResult } from '../../recommendation/types'
import type { CoachWebResponse } from '../../recommendation/webContracts'
import type { DecisionComparison } from '../types'

/**
 * FormPilot Coach Decision contract v1 (frozen for the competition build).
 * One synchronous, browser-only call: recommendCoachDecision(input, options) -> CoachDecisionResponse.
 * The caller never sees features, weights or ranking internals. All fields are JSON-safe.
 */
export const COACH_DECISION_CONTRACT = 'fp-coach-decision/v1' as const
export type CoachDecisionMode = 'off' | 'shadow' | 'active'
export const DEFAULT_COACH_DECISION_MODE: CoachDecisionMode = 'off'

/** Where a history / report block came from. Declared by the host; echoed back and never upgraded. */
export type CoachDecisionDataOrigin = 'live_local_records' | 'synthetic_demo'
export type CoachDecisionFocus = 'reach' | 'stability' | 'coordination' | 'rhythm'

/** One catalogue chapter the user has practised (aggregated; use historyFromRoutineSessions() for platform records). */
export interface CoachDecisionChapterHistory {
  /** Catalogue chapter id, e.g. "bdj-3". */
  chapterId: string
  /** Sessions that included this chapter (integer >= 1). */
  sessions: number
  /** Sessions where the chapter was followed to the end (<= sessions); null = not observed. */
  completedSessions?: number | null
  /** Mean follow-along similarity 0..100; null = not observed. */
  meanScore?: number | null
  trend?: 'up' | 'flat' | 'down' | null
  /** Epoch ms of the most recent session with this chapter; null = unknown. */
  lastPracticedAt?: number | null
}
export interface CoachDecisionTrainingHistory { origin: CoachDecisionDataOrigin; chapters: CoachDecisionChapterHistory[] }

export interface CoachDecisionGamePlay {
  /** Catalogue game id, e.g. "apple" (see COACH_KNOWLEDGE kind "game"). */
  gameId: string
  plays: number
  completedPlays?: number | null
  lastPlayedAt?: number | null
}
export interface CoachDecisionGameHistory { origin: CoachDecisionDataOrigin; games: CoachDecisionGamePlay[] }

export interface CoachDecisionReportFinding {
  focus: CoachDecisionFocus
  /** Catalogue chapter or programme id the finding refers to. */
  subjectId: string
  /** 0..100 sub-score of the finding; null = not observed (treated as medium need). */
  score?: number | null
  trend?: 'worse' | 'same' | 'better' | null
}
export interface CoachDecisionReport { origin: CoachDecisionDataOrigin; createdAt?: number | null; findings: CoachDecisionReportFinding[] }

/** Content the host cannot offer right now (not installed, not launchable). Ids must exist in the trusted catalogue. */
export interface CoachDecisionAvailability { snapshotRef: string; unavailableIds: string[] }

export interface CoachDecisionInput {
  contract: typeof COACH_DECISION_CONTRACT
  /** AI Coach profile form (existing CoachProfile v1): goals, difficulties, regions, preference, risk, acknowledged. */
  profile: CoachProfile
  trainingHistory?: CoachDecisionTrainingHistory | null
  gameHistory?: CoachDecisionGameHistory | null
  latestReport?: CoachDecisionReport | null
  availability?: CoachDecisionAvailability | null
  /** Epoch ms used for recency; defaults to the engine clock. */
  now?: number
}

export interface CoachDecisionOptions {
  /** Default 'off'. 'shadow' runs the model but always displays the rules result. 'active' displays the model result. */
  mode?: CoachDecisionMode
  /**
   * Owner decision. The bundled weights are trained on AI labels (tier ai_experimental); ACTIVE refuses them unless this
   * is true. It never relaxes the safety pool, the risk hold or the output guard.
   */
  allowExperimentalModel?: boolean
}

export type CoachDecisionFallbackReason =
  | 'MODEL_DISABLED' | 'SHADOW_MODE' | 'PROFILE_REQUIRED' | 'SAFETY_HOLD' | 'INPUT_INVALID' | 'INVALID_AVAILABILITY'
  | 'MODEL_MISSING' | 'MODEL_NOT_TRAINED' | 'WEIGHTS_INVALID' | 'MODEL_VERSION_MISMATCH' | 'LABELS_NOT_ACCEPTED'
  | 'CATALOGUE_MISMATCH' | 'CONTENT_FEATURES_MISMATCH' | 'UNBOUND_WEIGHTS' | 'EXPERIMENTAL_MODEL_NOT_APPROVED'
  | 'NO_CANDIDATES' | 'MODEL_ABSTAINED' | 'MODEL_ERROR' | 'OUTPUT_GUARD_REJECTED'

export interface CoachDecisionExplanation {
  feature: string
  /** Readable feature name (zh-CN). */
  label: string
  group: 'P' | 'H' | 'R'
  groupLabel: string
  value: number
  /** Contribution to the score (coefficient × standardized value). Positive = pushed this item up. */
  points: number
}

export interface CoachDecisionRankedItem {
  rank: number
  id: string
  kind: 'chapter' | 'game'
  programId: string | null
  title: string
  href: string | null
  launch: 'in_app_route' | 'external_app'
  /** Model score, comparable only within one response. */
  score: number
  /** Calibrated probability that annotators would grade the item suitable (>= 2 of 3). Not a medical probability. */
  suitability: number
  /** True when the item is part of the model's display slate (<= 3 chapters from <= 2 programmes, <= 2 games). */
  inSlate: boolean
  reasons: string[]
  explanation: CoachDecisionExplanation[]
}

export interface CoachDecisionModelInfo {
  release: string
  id: 'fp-cdm-m2'
  version: string
  runtimeVersion: string
  family: string
  featureSet: string
  /** human = two independent human annotators; ai_experimental = single AI annotator (weak supervision). */
  tier: 'human' | 'ai_experimental'
  tierLabel: string
  binding: 'release_bound' | 'unbound_research_variant'
  weightsFingerprint: string
  weightsSha256: string | null
  contentModel: { id: 'fp-cdm-m1'; tableVersion: string; fingerprint: string; modelOfRecord: string }
  catalogueFingerprint: string
  trainedOn: { labelsSha256: string | null; matrixSha256: string; devFamilies: number }
  /** offlineTechnical = tests, guard and evaluation passed offline; humanValidation = labels from humans or still pending; never product-accepted here. */
  validation: { offlineTechnical: 'passed'; humanValidation: 'pending' | 'human_labels'; productAcceptance: 'not_accepted' }
}

export interface CoachDecisionResponse {
  contract: typeof COACH_DECISION_CONTRACT
  mode: CoachDecisionMode
  /** Status of what `display` shows. */
  status: 'ready' | 'empty' | 'profile_required' | 'safety_hold' | 'error'
  /** Who produced `display`: the unchanged rules service, or the trained model (ACTIVE only). */
  decisionOrigin: 'rules' | 'model'
  /** Render this. Same shape as the Agent Web P0 result; null only when status is 'error'. */
  display: { result: CoachRecommendationResult; answers: Record<CoachQuestion, string> } | null
  /** Model ranking over the retrieved candidates (SHADOW and ACTIVE); empty when the model did not run. */
  ranking: CoachDecisionRankedItem[]
  /** Programme-level view of the ranking (mean of each programme's best two chapters). */
  programmes: Array<{ programId: string; title: string; score: number; suitability: number }>
  model: CoachDecisionModelInfo | null
  execution: 'disabled' | 'not_run' | 'executed' | 'failed'
  /** Calibrated probability that the top item beats the runner-up; null when the model did not run. */
  confidence: number | null
  abstained: boolean
  abstainReason: 'LOW_SUITABILITY' | 'OUT_OF_DISTRIBUTION' | 'NO_CANDIDATES' | null
  /** Features of the top candidate outside the training range (OUT_OF_DISTRIBUTION only). */
  outOfDistributionFeatures: string[]
  /** Why `display` is the rules result (null when the model result is displayed). */
  fallbackReason: CoachDecisionFallbackReason | null
  /** Model slate vs rules slate (SHADOW/ACTIVE after a successful run). */
  comparison: DecisionComparison | null
  guard: { checked: boolean; violations: string[] }
  inputIssues: Array<{ path: string; message: string }>
  dataSources: {
    profile: 'self_reported'
    trainingHistory: CoachDecisionDataOrigin | 'missing'
    gameHistory: CoachDecisionDataOrigin | 'missing'
    latestReport: CoachDecisionDataOrigin | 'missing'
    catalogue: 'trusted_project_catalogue'
  }
  /** The unchanged Agent Web P0 rules response (always computed, never modified). */
  rules: CoachWebResponse
  error: null | { code: 'INVALID_REQUEST'; message: string }
  limitations: string[]
  executedActions: false
}
