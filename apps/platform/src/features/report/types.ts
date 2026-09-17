import type { CourseTargetType, EvaluationMode } from '../course/CourseDefinition'
import type { ExerciseId, MotionErrorCode } from '../exercises/types'
import type { TrainingCaptureSource } from '../training/types'

export const TRAINING_REPORT_VERSION = 'report-v1' as const

export type ReportCapabilityDimension = 'AMPLITUDE' | 'STABILITY' | 'COORDINATION' | 'TEMPO' | 'CONTROL'

export interface ReportCompletion {
  status: 'complete' | 'incomplete'
  completed: number
  total: number
  label: string
}

export interface ReportMetricSummary {
  key: string
  label: string
  value: number | null
}

export interface ReportIssue {
  id: string
  exerciseId: ExerciseId
  exerciseName: string
  errorCode: MotionErrorCode
  reportLabel: string
  message: string
  count: number
  side?: 'left' | 'right'
  maxSeverity: number
  firstTimestamp: number
}

export interface ExerciseReportSummary {
  exerciseId: ExerciseId
  name: string
  evaluationMode: EvaluationMode
  completion: 'completed' | 'incomplete' | 'unavailable'
  progress: number | null
  target: number | null
  targetType: CourseTargetType | null
  score: number | null
  metrics: ReportMetricSummary[]
  repCount: number | null
  cycleCount: number | null
  durationMs: number | null
  topIssues: ReportIssue[]
  summaryText: string
}

export interface CapabilityContribution {
  exerciseId: ExerciseId
  metricKeys: string[]
  value: number
}

export interface CapabilitySummaryItem {
  dimension: ReportCapabilityDimension
  label: string
  value: number | null
  sampleCount: number
  availableExerciseCount: number
  totalExerciseCount: number
  contributions: CapabilityContribution[]
}

export interface ReportRecommendation {
  id: string
  priority: number
  sourceType: 'issue' | 'capability' | 'exercise_metric' | 'neutral'
  sourceExercise?: ExerciseId
  sourceError?: MotionErrorCode
  text: string
}

export interface TrainingReportData {
  reportVersion: typeof TRAINING_REPORT_VERSION
  sessionId: string
  courseId: string | null
  courseName: string
  courseVersion: string | null
  courseStatus: 'completed' | 'incomplete'
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  completion: ReportCompletion
  overallScore: number | null
  overallScoreLabel: string
  overallScoreScope: 'complete_course' | 'completed_scored_average' | 'unavailable'
  overallScoreDescription: string
  guidanceExercises: ExerciseReportSummary[]
  scoredExercises: ExerciseReportSummary[]
  exerciseSummaries: ExerciseReportSummary[]
  capabilitySummary: CapabilitySummaryItem[]
  topIssues: ReportIssue[]
  recommendations: ReportRecommendation[]
  feedbackCount: number
  metadata: {
    sourceSessionSchemaVersion: number
    captureSource: TrainingCaptureSource
    scoreSource: 'session' | 'derived_from_saved_exercise_results' | 'unavailable'
    confirmedIssueCount: number
  }
}
