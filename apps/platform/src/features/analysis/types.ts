import type { ExerciseId, MotionErrorCode } from '../exercises/types'
import type { TrainingMode, TrainingRulesVersion } from '../training/types'

export type AnalysisVersion = 'analysis-v1'
export type RulesSupport = 'SUPPORTED' | 'LEGACY_UNVERSIONED' | 'UNSUPPORTED'
export type AnalysisMode = TrainingMode | 'unknown'
export type RepetitionValidity = 'VALID' | 'PARTIAL' | 'INVALID'
export type ScoreTrend = 'IMPROVED' | 'STABLE' | 'REGRESSED'
export type IssueTrend = 'NEW' | 'RESOLVED' | 'IMPROVED' | 'PERSISTENT' | 'WORSENED' | 'INSUFFICIENT_DATA'
export type CapabilityDimension = 'AMPLITUDE' | 'STABILITY' | 'COORDINATION' | 'TEMPO' | 'FORM'
export type ComparisonLevel = 'FULL' | 'PARTIAL' | 'NONE'
export type ComparisonUnavailableReason =
  | 'CURRENT_NON_LIVE'
  | 'CURRENT_MODE_NOT_NORMAL'
  | 'CURRENT_RULES_LEGACY'
  | 'CURRENT_RULES_UNSUPPORTED'
  | 'CURRENT_NOT_FINALIZED'
  | 'NO_HISTORY'
  | 'NO_COMPATIBLE_HISTORY'
  | 'INSUFFICIENT_COMMON_EXERCISES'
  | null
export type ScoreUnavailableReason = 'INSUFFICIENT_VALID_REPS' | 'INCOMPLETE_SCOPE' | 'NO_PREVIOUS_VALUE' | null

export interface RulesAssessment {
  support: RulesSupport
  version: TrainingRulesVersion | null
}
export interface Incidence {
  affected: number
  evaluable: number
}

export interface RepetitionQualityCounts {
  valid: number
  partial: number
  invalid: number
  total: number
}

export interface AnalysisIssue {
  id: string
  exerciseId: ExerciseId
  code: MotionErrorCode
  side: 'left' | 'right' | 'bilateral' | null
  theme: string
  label: string
  cue: string
  incidence: Incidence
  rate: number | null
  significant: boolean
  reminderCount: number
  trend: IssueTrend | null
  previousIncidence: Incidence | null
  evidenceRefs: string[]
}

export interface ExerciseAnalysis {
  exerciseId: ExerciseId
  role: 'scored' | 'guidance'
  repetitionQuality: RepetitionQualityCounts
  analyzedRepCount: number
  score: number | null
  scoreUnavailableReason: ScoreUnavailableReason
  previousScore: number | null
  scoreDelta: number | null
  scoreTrend: ScoreTrend | null
  issues: AnalysisIssue[]
  tempoDirection: 'TOO_FAST' | 'TOO_SLOW' | 'APPROPRIATE' | null
  missingEvidence: string[]
}

export interface ComparisonSelection {
  level: ComparisonLevel
  previousSessionId: string | null
  previousStartedAt: number | null
  commonExerciseIds: ExerciseId[]
  overallComparable: boolean
  unavailableReason: ComparisonUnavailableReason
}

export interface CapabilityContribution {
  exerciseId: ExerciseId
  value: number
  evaluableUnits: number
}

export interface CapabilityAnalysis {
  dimension: CapabilityDimension
  value: number | null
  contributors: CapabilityContribution[]
  unavailableReason: 'INSUFFICIENT_EXERCISE_CONTRIBUTORS' | null
  previousValue: number | null
  comparisonContributors: ExerciseId[]
  delta: number | null
  trend: ScoreTrend | null
}

export interface CapabilityModelV2 {
  dimensions: CapabilityAnalysis[]
  radarAvailable: boolean
}

export interface WithinSessionInsight {
  id: string
  exerciseId: ExerciseId
  issueCode: MotionErrorCode
  firstWindow: Incidence
  lastWindow: Incidence
  text: string
  evidenceRefs: string[]
}

export interface Strength {
  id: string
  source: 'CAPABILITY' | 'EXERCISE'
  exerciseId: ExerciseId | null
  dimension: CapabilityDimension | null
  value: number
  text: string
  evidenceRefs: string[]
}

export interface PriorityIssue extends AnalysisIssue {
  technicalPriority: number
  mergedFrom: string[]
}

export interface NextFocus {
  id: string
  sourcePriorityId: string | null
  exerciseId: ExerciseId | null
  cue: string
  measurableTarget: string | null
  evidenceRefs: string[]
}

export interface SummarySentence {
  id: string
  text: string
  evidenceRefs: string[]
}

export interface DataQualityNotice {
  code:
    | 'LEGACY_RULES'
    | 'UNSUPPORTED_RULES'
    | 'MODE_UNKNOWN'
    | 'FAST_MODE'
    | 'NON_LIVE_SOURCE'
    | 'INVALID_REPS'
    | 'MISSING_TOP_ELBOW'
    | 'POSE_QUALITY'
    | 'GUIDANCE_EXCLUDED'
    | 'COMPARISON_LIMITED'
  severity: 'info' | 'warning'
  count: number | null
  text: string
}

export interface DataQuality {
  rules: RulesAssessment
  mode: AnalysisMode
  source: 'live' | 'demo' | 'synthetic'
  reps: RepetitionQualityCounts
  missingTopElbow: number
  poseQualityEvents: number
  environmentHint: string | null
  guidanceExerciseIds: ExerciseId[]
  comparisonLimitation: ComparisonUnavailableReason
  notices: DataQualityNotice[]
}

export interface TrainingAnalysis {
  version: AnalysisVersion
  sessionId: string
  sourceStartedAt: number
  rules: RulesAssessment
  mode: AnalysisMode
  comparison: ComparisonSelection
  scope: 'FULL_COURSE' | 'PARTIAL_COURSE'
  exercises: ExerciseAnalysis[]
  overallScore: number | null
  overallScoreUnavailableReason: ScoreUnavailableReason
  previousOverallScore: number | null
  overallDelta: number | null
  overallTrend: ScoreTrend | null
  issues: AnalysisIssue[]
  priorityIssues: PriorityIssue[]
  capabilities: CapabilityModelV2
  withinSession: WithinSessionInsight[]
  strengths: Strength[]
  nextFocus: NextFocus[]
  summary: SummarySentence[]
  dataQuality: DataQuality
}
