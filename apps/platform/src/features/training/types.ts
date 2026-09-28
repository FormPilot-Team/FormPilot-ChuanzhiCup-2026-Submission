import type { FeedbackEvent } from '../feedback/types'
import type { ExerciseId, MotionErrorCode, RepSummary, RuleMetrics } from '../exercises/types'
import type { CourseTargetType, EvaluationMode } from '../course/CourseDefinition'

export type TrainingCaptureSource = 'live' | 'demo' | 'synthetic'
export type TrainingMode = 'normal' | 'fast'

export interface TrainingRulesVersion {
  spec: string
  threshold: string
}

export interface RepetitionResult {
  rep: RepSummary
  score: number
  metrics: RuleMetrics
  errors: MotionErrorCode[]
}

/**
 * What a guidance exercise (肩部环绕, no repetitions) looked like while it was performed: means of each live metric
 * over the frames with a reliable pose, and on how many frames each correction condition held. Added by Scoring v2
 * so the report can explain the guidance exercise; it never enters any score.
 */
export interface GuidanceMetricSummary {
  samples: number
  metrics: Record<string, { value: number; score: number }>
  errorFrames: Partial<Record<MotionErrorCode, number>>
}

export interface ExerciseSessionResult {
  exerciseId: ExerciseId
  startedAt: number
  endedAt?: number
  repetitions: RepetitionResult[]
  metricAverages: Record<string, number>
  overallScore: number
  topErrors: MotionErrorCode[]
  feedbackEvents: FeedbackEvent[]
  evaluationMode?: EvaluationMode
  targetType?: CourseTargetType
  targetValue?: number
  completed?: boolean
  guidanceSummary?: GuidanceMetricSummary
}

export interface TrainingSessionState {
  schemaVersion: 2
  id: string
  source: TrainingCaptureSource
  mode?: TrainingMode
  rulesVersion?: TrainingRulesVersion
  startedAt: number
  endedAt?: number
  status: 'ready' | 'active' | 'paused' | 'completed'
  courseId?: string
  courseVersion?: string
  courseStatus?: 'in_progress' | 'completed' | 'incomplete'
  courseOverallScore?: number
  totalDurationMs?: number
  totalFeedbackCount?: number
  topRecurringErrors?: MotionErrorCode[]
  exerciseOrder: ExerciseId[]
  activeExerciseId: ExerciseId
  exercises: ExerciseSessionResult[]
}

const STATUSES = new Set(['ready', 'active', 'paused', 'completed'])

export function isTrainingSessionState(value: unknown): value is TrainingSessionState {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<TrainingSessionState>
  return item.schemaVersion === 2
    && typeof item.id === 'string'
    && typeof item.startedAt === 'number'
    && STATUSES.has(String(item.status))
    && Array.isArray(item.exerciseOrder)
    && typeof item.activeExerciseId === 'string'
    && Array.isArray(item.exercises)
}

export function withSessionSource(session: TrainingSessionState, fallback: TrainingCaptureSource = 'live'): TrainingSessionState {
  return { ...session, source: session.source ?? fallback }
}
