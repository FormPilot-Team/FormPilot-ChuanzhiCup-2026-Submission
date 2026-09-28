import type { RoutineId } from '../routines/types'
import type { PoseMetricId } from './routine/poseMetrics'
import type { PhaseWindowSpec } from './routine/phaseWindows'

/**
 * FormPilot Scoring v2 — evidence-based, explainable evaluation.
 *
 * Three layers are kept apart on purpose:
 * - Layer A (requirement): what counts as doing the movement correctly, and who says so (`sourceType`, `sourceId`);
 * - Layer B (observation): what the camera and a 2D pose model can actually measure (`observable`, `measurement`);
 * - Layer C (calibration): how far from the target costs how many points (`target`, `thresholdSource`).
 * A numeric threshold is FORMPILOT_CALIBRATED unless a source states that number; it is never presented as a
 * national standard.
 */
export const SCORING_VERSION = 'scoring-v2.1' as const

export type SourceType =
  | 'OFFICIAL_STANDARD'
  | 'OFFICIAL_GUIDANCE'
  | 'COMPETITION_RULE'
  | 'ACADEMIC_EVIDENCE'
  | 'FORMPILOT_CALIBRATED'

/**
 * A: an official standard or official motion guidance addresses this requirement of this movement directly.
 * B: peer-reviewed domestic research, a sports textbook, or an official fitness principle that is general rather
 *    than specific to this movement.
 * C: only FormPilot's own reference demonstration and engineering calibration.
 */
export type EvidenceLevel = 'A' | 'B' | 'C'

/**
 * OBSERVABLE: a frontal 2D pose measures it directly.
 * PROXY: only an indirect 2D estimate exists (e.g. forward lean seen as a lower wrist); used with care.
 * NOT_OBSERVABLE: breathing, intent, gaze, hand shape, foot direction, sagittal spine shape … never scored.
 */
export type Observability = 'OBSERVABLE' | 'PROXY' | 'NOT_OBSERVABLE'

/**
 * SCORED: measured and weighted into the technique score.
 * ADVISORY: measured and shown with its evidence, but carries no weight (noisy, or a correction-only check).
 * REFERENCE_ONLY: shown as a movement requirement; not measured by the camera (yet).
 */
export type ScoringRole = 'SCORED' | 'ADVISORY' | 'REFERENCE_ONLY'

/**
 * VERIFIED_FULL_TEXT: the official full text was obtained and the relevant passages were read.
 * VERIFIED_METADATA: an official publisher/catalogue page confirms the item, but its full text was not read.
 * SECONDARY_ONLY: only a search result or secondary source confirms the item.
 * PENDING: the original source still needs a manual check.
 */
export type SourceVerification = 'VERIFIED_FULL_TEXT' | 'VERIFIED_METADATA' | 'SECONDARY_ONLY' | 'PENDING'

export interface ScoringSource {
  id: string
  type: SourceType
  title: string
  organization: string
  /** Publication date or year as published, e.g. 2018-01-10. */
  published: string | null
  /** Standard number, DOI, or journal volume/issue. */
  identifier: string | null
  url: string | null
  verification: SourceVerification
  /** Whether an official publisher/catalogue page confirmed the bibliographic metadata. */
  metadataVerified: boolean
  /** Whether the official full text was obtained and its relevant passages were actually read. */
  fullTextVerified: boolean
  /** ISO calendar date of the latest verification, or null while pending. */
  verifiedAt: string | null
  /** Human-readable audit note. It must not imply more access than the flags above. */
  verificationNote: string
  /** What FormPilot takes from this source. */
  usedFor: string
}

export type ScoringMode = 'warm-up' | RoutineId

export type Severity = 'major' | 'minor'

/**
 * `atLeast` / `atMost`: full marks on the right side of `value`, falling linearly to 0 at `zeroAt`.
 * `between`: full marks inside [min, max], falling to 0 at `tolerance` beyond either end.
 */
export type CriterionTarget =
  | { kind: 'atLeast'; value: number; zeroAt: number; unit: string }
  | { kind: 'atMost'; value: number; zeroAt: number; unit: string }
  | { kind: 'between'; min: number; max: number; tolerance: number; unit: string }

/**
 * How a window's user samples become one observation:
 * high = 75th percentile (reached and held), low = 25th percentile, typical = median, spread = p90 − p10.
 */
export type WindowAggregation = 'high' | 'low' | 'typical' | 'spread'

export type CriterionMeasurement =
  /** 热身: one weighted component of the existing per-rep score (`RuleMetrics[metricKey]`). */
  | { kind: 'rep-component'; metricKey: string; componentWeight: number }
  /** 热身: a per-rep check that drives corrections / report issues but has no score weight. */
  | { kind: 'rep-check'; issueCanonicalIds: ReadonlyArray<string> }
  /** 肩部环绕 guidance exercise: a live metric sampled while rotating. */
  | { kind: 'guidance-metric'; metricKey: string }
  /** 跟练: a user pose metric aggregated inside phase windows found in the standard video. */
  | { kind: 'pose-window'; metric: PoseMetricId; aggregation: WindowAggregation; window: PhaseWindowSpec }
  /** 跟练: a statistic of the follow-along comparison itself (timing), shown for reference only. */
  | { kind: 'follow-along'; statistic: 'syncShare' }
  | { kind: 'none' }

export interface EvaluationCriterion {
  id: string
  mode: ScoringMode
  /** Exercise id (热身) or chapter id (跟练); `*` applies to every chapter of the routine. */
  exercise: string
  name: string
  /** What the camera checks, in user language. */
  description: string
  /** The movement requirement this criterion stands for (paraphrased, not quoted). */
  requirement: string
  sourceType: SourceType
  sourceId: string
  sourceTitle: string
  additionalSourceIds: ReadonlyArray<string>
  evidenceLevel: EvidenceLevel
  observable: Observability
  scoring: ScoringRole
  measurement: CriterionMeasurement
  metric: { label: string; unit: string } | null
  landmarks: ReadonlyArray<string>
  /** Movement phase the check applies to, e.g. 托举顶点. */
  phase: string | null
  target: CriterionTarget | null
  /** Distance from the target to zero points, in the target's unit. */
  tolerance: number | null
  /** Where the number comes from; FORMPILOT_CALIBRATED unless a source states it. */
  thresholdSource: 'FORMPILOT_CALIBRATED' | 'NONE'
  /** How the number was chosen (reference demonstration values, engineering history …). */
  thresholdBasis: string | null
  weight: number
  severity: Severity
  feedback: {
    /** Deduction reason, e.g. 托举顶部双肘未伸直. */
    issue: string
    /** Correction cue, e.g. 两掌上托时两肘慢慢伸直. */
    cue: string
  }
  limitations: ReadonlyArray<string>
}
