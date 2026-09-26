import type { CoachHighlightRegion } from '../coach/types'
import type { ExerciseId, MotionErrorCode } from '../exercises/types'
import type { TrainingCaptureSource, TrainingRulesVersion } from '../training/types'

export type AnalysisVersion = 'analysis-v1'
export type ScoredExerciseId = 'overhead_raise' | 'lateral_raise' | 'step_jack' | 'squat' | 'knee_raise'
export type CapabilityDimension = 'AMPLITUDE' | 'STABILITY' | 'COORDINATION' | 'TEMPO' | 'FORM'
export type CapabilityLabel = '幅度' | '稳定' | '协调' | '节奏' | '动作规范'
export type Trend = 'IMPROVED' | 'STABLE' | 'DECLINED'
export type IssueTrend = 'NEW' | 'RESOLVED' | 'IMPROVED' | 'PERSISTENT' | 'WORSENED' | 'INSUFFICIENT_DATA'
export type IssueSignificance = 'SIGNIFICANT' | 'NOT_SIGNIFICANT' | 'INSUFFICIENT_EVIDENCE'
export type RulesSupport = 'SUPPORTED' | 'LEGACY_UNVERSIONED' | 'UNSUPPORTED'
export type AnalysisMode = 'normal' | 'fast' | 'unknown'
export type RepetitionValidity = 'VALID' | 'PARTIAL' | 'INVALID'
export type IssueSide = 'left' | 'right'
/** Counting unit shown to the user: reps are 次, knee-raise left/right pairs are 组. */
export type IssueUnit = '次' | '组'
export type IssueThemeId = 'TORSO_STABILITY' | 'ELBOW_EXTENSION' | 'ARM_SYMMETRY' | 'TEMPO_TOO_FAST' | 'ALTERNATION'
export type AnalysisHighlightRegion = Exclude<CoachHighlightRegion, 'none'>
export type TempoDirection = 'TOO_FAST' | 'TOO_SLOW' | 'APPROPRIATE'

/** Integer incidence. `evaluable` is always ≥ 1 wherever a Ratio is emitted. */
export interface Ratio {
  affected: number
  evaluable: number
}

export interface ReportIssueDefinition {
  canonicalId: string
  exerciseId: ScoredExerciseId
  runtimeCodes: MotionErrorCode[]
  bodyRegion: AnalysisHighlightRegion
  dimension: CapabilityDimension
  reportLabel: string
  cue: string
  reportable: boolean
  trendable: boolean
  evidenceSource: 'rep' | 'derived' | 'reminder'
  groupId: string
  side: IssueSide | null
  themeId: IssueThemeId | null
  technicalPriorityWeight: 1 | 2 | 3
  sideModel: 'NONE' | 'SIDE_SPECIFIC' | 'REP_SIDE_BREAKDOWN'
}

/** Runtime codes that exist only for coverage: never an issue, never a denominator. */
export interface NonReportableIssueDefinition {
  canonicalId: string
  exerciseId: ExerciseId
  runtimeCodes: MotionErrorCode[]
  reportable: false
  trendable: false
  evidenceSource: 'reminder'
  reason: string
}

export type ComparisonReason =
  | 'NO_PREVIOUS_SESSION'
  | 'CURRENT_NOT_LIVE'
  | 'CURRENT_RULES_UNVERSIONED'
  | 'CURRENT_MODE_UNKNOWN'
  | 'CURRENT_FAST_MODE'
  | 'CURRENT_RULES_UNSUPPORTED'
  | 'CURRENT_NOT_COURSE_FLOW'
  | 'CURRENT_NOT_FINALIZED'
  | 'NO_ELIGIBLE_PREVIOUS'
  | 'INSUFFICIENT_COMMON_EXERCISES'
  | 'CURRENT_NOT_FULL_SCOPE'
  | 'NO_FULL_SCOPE_PREVIOUS'

export type CandidateExclusion =
  | 'NOT_LIVE'
  | 'FAST_MODE'
  | 'MODE_UNKNOWN'
  | 'RULES_UNVERSIONED'
  | 'RULES_MISMATCH'
  | 'NOT_COURSE_FLOW'
  | 'NOT_FINALIZED'

export interface Comparison {
  level: 'FULL' | 'PARTIAL' | 'NONE'
  /** Only FULL has a null reason. */
  reason: ComparisonReason | null
  /** User-facing sentence for `reason`; null for FULL. */
  reasonText: string | null
  previousSessionId: string | null
  previousStartedAt: number | null
  commonExerciseIds: ScoredExerciseId[]
  overallDeltaAllowed: boolean
  excluded: Array<{ sessionId: string; reasons: CandidateExclusion[] }>
}

export interface Overall {
  scope: 'FULL_COURSE' | 'COMPLETED_EXERCISES' | 'UNAVAILABLE'
  /** FULL_COURSE: course score. COMPLETED_EXERCISES: mean of the completed, scored exercises only. */
  score: number | null
  scoredExerciseCount: number
  completedExercises: number
  totalExercises: 6
  previousScore: number | null
  delta: number | null
  trend: Trend | null
}

export interface IssueComparison {
  trend: IssueTrend | null
  previous: Ratio | null
  countDelta: number | null
  rateDeltaPct: number | null
}

export interface IssueAnalysis {
  canonicalId: string
  exerciseId: ScoredExerciseId
  groupId: string
  themeId: IssueThemeId | null
  side: IssueSide | null
  dimension: CapabilityDimension
  bodyRegion: AnalysisHighlightRegion
  reportLabel: string
  cue: string
  evidenceSource: 'rep' | 'derived'
  unit: IssueUnit
  technicalPriorityWeight: 1 | 2 | 3
  stats: Ratio | null
  /** Analyzed reps that lack the optional field this issue needs (PARTIAL evidence). */
  missingEvidenceReps: number
  significance: IssueSignificance
  reminderCount: number | null
  sideBreakdown: { left: Ratio | null; right: Ratio | null } | null
  comparison: IssueComparison | null
  withinSession: { firstHalf: Ratio; secondHalf: Ratio } | null
  technicalPriority: number | null
}

export interface SideBalance {
  groupId: string
  left: Ratio | null
  right: Ratio | null
}

export type DimensionUnavailableReason =
  | 'EXERCISE_NOT_COMPLETED'
  | 'INSUFFICIENT_EVALUABLE_REPS'
  | 'EVIDENCE_MISSING'
  | 'RULES_UNSUPPORTED'

export interface DimensionContribution {
  value: number | null
  evaluableReps: number
  unavailableReason: DimensionUnavailableReason | null
}

export interface CapabilityComparison {
  commonExerciseIds: ScoredExerciseId[]
  /** Current session re-aggregated over `commonExerciseIds` only. */
  current: number
  /** Previous session re-aggregated over the same `commonExerciseIds`. */
  previous: number
  delta: number
  trend: Trend
}

export interface CapabilityDimensionAnalysis {
  dimension: CapabilityDimension
  label: CapabilityLabel
  /** Current session over all of its contributors. Never compare this against `comparison.previous`. */
  value: number | null
  contributors: Array<{ exerciseId: ScoredExerciseId; value: number; evaluableReps: number }>
  unavailableReason: 'INSUFFICIENT_CONTRIBUTORS' | null
  comparison: CapabilityComparison | null
  comparisonUnavailableReason: 'NO_COMPARISON' | 'COMMON_SCOPE_TOO_SMALL' | null
}

export interface CapabilityAnalysis {
  available: boolean
  unavailableReason: 'RULES_UNSUPPORTED' | null
  radarAvailable: boolean
  dimensions: CapabilityDimensionAnalysis[]
}

export type FindingKind =
  | 'HISTORICAL_RESOLVED'
  | 'HISTORICAL_ISSUE_IMPROVED'
  | 'HISTORICAL_SCORE_IMPROVED'
  | 'HISTORICAL_OVERALL_IMPROVED'
  | 'WITHIN_SESSION_IMPROVEMENT'
  | 'EXERCISE_STRENGTH'
  | 'CAPABILITY_STRENGTH'
  | 'ISSUE_FREE_STRENGTH'

export type FindingEvidence =
  | { type: 'ISSUE_CHANGE'; current: Ratio; previous: Ratio; unit: IssueUnit }
  | { type: 'SCORE_CHANGE'; current: number; previous: number; delta: number }
  | { type: 'WITHIN_SESSION'; firstHalf: Ratio; secondHalf: Ratio; unit: IssueUnit }
  | { type: 'EXERCISE_SCORE'; score: number; minRepScore: number; validReps: number }
  | { type: 'CAPABILITY'; value: number; contributorCount: number; minContributorValue: number }
  | { type: 'ISSUE_FREE'; exercises: number; evaluable: number }

export interface Finding {
  id: string
  kind: FindingKind
  exerciseIds: ScoredExerciseId[]
  canonicalIds: string[]
  dimension: CapabilityDimension | null
  evidence: FindingEvidence
  text: string
}

export interface CompletionAnalysis {
  status: 'completed' | 'incomplete' | 'not_started'
  progress: number
  target: number
  unit: 'reps' | 'cycles'
}

export interface TempoAnalysis {
  direction: TempoDirection | null
  fast: number
  slow: number
  inBand: number
  bandMs: [number, number]
}

export interface ExerciseAnalysis {
  exerciseId: ScoredExerciseId
  displayName: string
  evaluationMode: 'scored'
  completion: CompletionAnalysis
  score: number | null
  previousScore: number | null
  scoreDelta: number | null
  scoreTrend: Trend | null
  reps: { recorded: number; valid: number; partial: number; invalid: number; analyzed: number }
  activeDurationMs: number | null
  consistency: { minRepScore: number; maxRepScore: number; spread: number } | null
  tempo: TempoAnalysis
  issues: IssueAnalysis[]
  sideBalance: SideBalance[]
  capabilityContribution: Record<CapabilityDimension, DimensionContribution>
  withinExerciseImprovement: Finding | null
  takeaway: string | null
}

export interface PriorityMember {
  canonicalId: string
  exerciseId: ScoredExerciseId
  side: IssueSide | null
  reportLabel: string
  unit: IssueUnit
  stats: Ratio
  trend: IssueTrend | null
  technicalPriority: number
}

export interface PriorityIssue {
  rank: 1 | 2 | 3
  id: string
  kind: 'ISSUE' | 'SIDE_PAIR' | 'THEME'
  canonicalIds: string[]
  exerciseIds: ScoredExerciseId[]
  themeId: IssueThemeId | null
  priority: number
  reportLabel: string
  cue: string
  bodyRegion: AnalysisHighlightRegion
  /** Each member keeps its own ratio; members are never summed into one incidence. */
  members: PriorityMember[]
  text: string
}

export interface FocusTarget {
  compliantAtLeast: number
  outOf: number
  unit: IssueUnit
  text: string
}

export interface FocusItem {
  rank: 1 | 2
  source: 'PRIORITY_ISSUE' | 'WEAK_CAPABILITY'
  exerciseIds: ScoredExerciseId[]
  canonicalIds: string[]
  bodyRegion: AnalysisHighlightRegion
  cue: string
  target: FocusTarget | null
  text: string
}

export type SummarySlot = 'OVERALL' | 'IMPROVEMENT' | 'PRIORITY' | 'NO_PRIORITY' | 'LIMITED_DATA' | 'STRENGTH' | 'WITHIN_SESSION'

export interface SummarySentence {
  slot: SummarySlot
  text: string
  evidenceRefs: string[]
}

export type SessionFlag =
  | 'LEGACY_RULES_UNVERSIONED'
  | 'RULES_UNSUPPORTED'
  | 'MODE_UNKNOWN'
  | 'FAST_MODE'
  | 'LEGACY_FAST_SUSPECTED'
  | 'NON_LIVE_SOURCE'
  | 'NOT_COURSE_FLOW'
  | 'NOT_FINALIZED'

export type ComparisonLimitation =
  | 'NO_OVERALL_DELTA_PARTIAL'
  | 'ISSUE_PREVIOUS_INSUFFICIENT'
  | 'CAPABILITY_COMMON_SCOPE_TOO_SMALL'
  | 'EXERCISE_NOT_COMMON'

export interface PoseQualityCounts {
  /** Correction prompts (feedback events). Never mixed with rep counts. */
  outOfFramePrompts: number
  lowConfidencePrompts: number
  /** INVALID reps whose completion frame carried a pose-quality error. */
  outOfFrameInvalidReps: number
  lowConfidenceInvalidReps: number
}

export interface DataQuality {
  rulesSupport: RulesSupport
  sessionFlags: SessionFlag[]
  poseQuality: PoseQualityCounts & {
    byExercise: Array<PoseQualityCounts & { exerciseId: ExerciseId }>
    environmentHint: 'FRAMING' | 'VISIBILITY' | null
  }
  reps: {
    recorded: number
    valid: number
    partial: number
    invalid: number
    byExercise: Array<{ exerciseId: ScoredExerciseId; recorded: number; valid: number; partial: number; invalid: number }>
  }
  missingEvidence: Array<{
    exerciseId: ScoredExerciseId
    canonicalId: string
    reps: number
    reason: 'LEGACY_SESSION_NO_TOP_ELBOW' | 'TOP_ELBOW_NOT_CAPTURED'
  }>
  /** Scored exercises whose analyzed reps are below the issue minimum, so none of their issues can be significant. */
  limitedExercises: Array<{ exerciseId: ScoredExerciseId; analyzedReps: number }>
  guidance: { exerciseId: 'shoulder_rotation'; status: CompletionAnalysis['status']; scored: false }
  comparisonLimitations: ComparisonLimitation[]
  notes: string[]
}

export interface GuidanceAnalysis {
  exerciseId: 'shoulder_rotation'
  status: CompletionAnalysis['status']
  targetSeconds: number
  text: string
}

export interface TrainingAnalysis {
  analysisVersion: AnalysisVersion
  sessionId: string
  sessionStartedAt: number
  source: TrainingCaptureSource
  mode: AnalysisMode
  rulesVersion: TrainingRulesVersion | null
  courseComplete: boolean
  comparison: Comparison
  overall: Overall
  exercises: ExerciseAnalysis[]
  guidance: GuidanceAnalysis
  capability: CapabilityAnalysis
  priorityIssues: PriorityIssue[]
  improvements: Finding[]
  strengths: Finding[]
  nextFocus: FocusItem[]
  summary: SummarySentence[]
  dataQuality: DataQuality
}
