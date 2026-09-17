import type { FeedbackEvent } from '../feedback/types'
import type { ExerciseId, MotionErrorCode, RepSummary, RuleMetrics } from '../exercises/types'
import type { CourseTargetType, EvaluationMode } from '../course/CourseDefinition'

export type TrainingCaptureSource = 'live' | 'demo' | 'synthetic'

export interface RepetitionResult {
  rep: RepSummary
  score: number
  metrics: RuleMetrics
  errors: MotionErrorCode[]
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
}

export interface TrainingSessionState {
  schemaVersion: 2
  id: string
  source: TrainingCaptureSource
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
