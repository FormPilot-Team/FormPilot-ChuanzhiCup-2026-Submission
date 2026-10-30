import type { InterventionStrategy } from '../adaptiveTraining/protocol'
import type { ExerciseId, MotionErrorCode } from '../exercises/types'
import type { FeedbackEvent } from '../feedback/types'
import type { RoutineFeedbackCode } from '../routines/followAlong/feedbackPolicy'
import type { RoutineId } from '../routines/types'
import type { EvidenceLevel, Observability } from '../scoring/types'
import type { TrainingCaptureSource, TrainingMode, TrainingRulesVersion } from '../training/types'

/** Independent transport version; not the stored session or scoring version. */
export const COACH_SCHEMA_VERSION = 1 as const

export type EpochTime = { domain: 'epoch-ms'; value: number }
export type CoachTime = EpochTime
  | { domain: 'training-monotonic-ms'; clockId: string; value: number }
  | { domain: 'video-seconds'; clockId: string; value: number }

export interface CoachProvenance {
  source: TrainingCaptureSource | 'unknown'
  mode: TrainingMode | 'unknown'
  /** Producer and capture source are independent: rules may process synthetic poses. */
  producer: 'rules' | 'repository' | 'model' | 'simulation'
}

export type DataProvenance = Omit<CoachProvenance, 'producer'> & {
  producer: Exclude<CoachProvenance['producer'], 'model'>
}

export interface CoachEnvelope {
  schemaVersion: typeof COACH_SCHEMA_VERSION
  id: string
  recordedAt: EpochTime
  provenance: CoachProvenance
  /** Unknown confidence stays null; it is neither a score nor an evidence grade. */
  confidence: number | null
}

export type MotionSubject = { kind: 'exercise'; id: ExerciseId }
  | { kind: 'routine'; id: RoutineId }

type ScoreValue = { status: 'available'; value: number; scoringVersion: string }
  | { status: 'missing' | 'insufficient' | 'not_observable'; value: null; scoringVersion: string | null }

/** Different score kinds must never be averaged into an unlabelled common score. */
export type CoachScore =
  | ({ scoreKind: 'warmup-standard'; scale: '0-100' } & (
    | { status: 'available'; value: number; scoringVersion: string; rulesVersion: TrainingRulesVersion }
    | { status: 'missing' | 'insufficient' | 'not_observable'; value: null; scoringVersion: string | null; rulesVersion: TrainingRulesVersion | null }
  ))
  | (ScoreValue & {
    scoreKind: 'routine-technique'
    scale: '0-100'
    rulesVersion: TrainingRulesVersion | null
  })
  | (ScoreValue & {
    scoreKind: 'follow-along-similarity'
    scale: '0-1'
    rulesVersion: null
  })
  | {
    scoreKind: 'guidance'
    scale: 'none'
    status: 'guidance'
    value: null
    scoringVersion: null
    rulesVersion: null
  }

export interface ScoringEvidence extends CoachEnvelope {
  provenance: DataProvenance
  sessionId: string
  subject: MotionSubject
  /** Original persisted record and its version; not an LLM citation or a truth certificate. */
  recordRef: { id: string; version: string }
  window: { start: CoachTime; end: CoachTime }
  score: CoachScore
  quality: { sampleCount: number; observability: Observability; evidenceLevel: EvidenceLevel | null }
  criterionIds: string[]
}

export type WarmupCoachFeedback = { kind: FeedbackEvent['kind']; code: MotionErrorCode | null }
export type RoutineCoachFeedback =
  | { kind: 'correction'; code: Exclude<RoutineFeedbackCode, 'READING' | 'CUE' | 'FOLLOWING_WELL' | 'RECOVERED'> }
  | { kind: 'recovery'; code: Extract<RoutineFeedbackCode, 'RECOVERED'> }

interface MotionEventEnvelope extends CoachEnvelope {
  provenance: DataProvenance
  sessionId: string
  occurredAt: CoachTime
  eventKind: 'observation' | 'repetition' | 'feedback'
  repetitionIndex: number | null
  evidenceRefs: string[]
}

/** Keep confirmed routine feedback separate from warm-up rule error codes. */
export type MotionEvent = MotionEventEnvelope & (
  | { subject: Extract<MotionSubject, { kind: 'exercise' }>; feedback: WarmupCoachFeedback | null }
  | { subject: Extract<MotionSubject, { kind: 'routine' }>; feedback: RoutineCoachFeedback | null }
)

export interface TrainingSessionSummary extends CoachEnvelope {
  provenance: DataProvenance
  sessionId: string
  recordRef: { id: string; version: string }
  kind: 'warmup' | 'routine'
  startedAt: EpochTime
  endedAt: EpochTime | null
  status: 'active' | 'paused' | 'completed' | 'incomplete'
  activeDurationMs: number | null
  completedReps: number | null
  /** Keep the original evidence/kinds; this contract does not compute an overall score. */
  evidence: ScoringEvidence[]
}

export interface CoachIntervention extends CoachEnvelope {
  sessionId: string
  status: 'proposed'
  confirmation: 'required'
  executed: false
  /** Reuse the existing decision vocabulary. No controller or executable command. */
  strategy: InterventionStrategy
  explanation: string
  evidenceRefs: string[]
}

export type PlanCourseRef = { kind: 'warmup-course'; id: string; version: string }
  | { kind: 'routine-program'; id: RoutineId; version: string }

export interface TrainingPlanDraft extends CoachEnvelope {
  status: 'draft'
  confirmation: 'required'
  executed: false
  /** Versioned catalogue references only; no threshold or dose overrides in Phase 1A. */
  courses: PlanCourseRef[]
  rationale: string
  evidenceRefs: string[]
}

export type AgentTool = 'read_session' | 'read_history' | 'read_scoring_evidence' | 'draft_plan'
export interface ToolInvocation { requestId: string; tool: AgentTool }
export type AgentToolErrorCode = 'NOT_FOUND' | 'INSUFFICIENT_DATA' | 'INVALID_INPUT'
  | 'UNSUPPORTED_VERSION' | 'PERMISSION_DENIED' | 'NOT_ALLOWED' | 'TIMEOUT' | 'UNAVAILABLE'

interface ToolResultEnvelope extends CoachEnvelope {
  provenance: DataProvenance
  requestId: string
}

/** Only read/draft results. Validation does not execute or authenticate a tool. */
export type AgentToolResult = ToolResultEnvelope & (
  | { ok: true; tool: 'read_session'; data: TrainingSessionSummary; error: null }
  | { ok: true; tool: 'read_history'; data: TrainingSessionSummary[]; error: null }
  | { ok: true; tool: 'read_scoring_evidence'; data: ScoringEvidence[]; error: null }
  | { ok: true; tool: 'draft_plan'; data: TrainingPlanDraft; error: null }
  | { ok: false; tool: AgentTool; data: null; error: { code: AgentToolErrorCode; message: string; retryable: boolean } }
)

/** Explicit, caller-supplied snapshots; validators never query storage or a network. */
export interface CoachValidationContext {
  evidence: readonly ScoringEvidence[]
  catalogue: readonly PlanCourseRef[]
}

export interface ValidationIssue {
  path: string
  code: 'INVALID_INPUT' | 'UNSUPPORTED_VERSION' | 'OUT_OF_RANGE' | 'TIME_DOMAIN_CONFLICT'
    | 'MISSING_EVIDENCE' | 'NOT_ALLOWED'
  message: string
}

export type ValidationResult<T> = { ok: true; value: T }
  | { ok: false; errors: ValidationIssue[] }
