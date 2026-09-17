import type { ExerciseId, MotionError, MotionErrorCode } from '../exercises/types'

export interface FeedbackEvent {
  id: string
  timestamp: number
  kind: 'correction' | 'recovery'
  exerciseId: ExerciseId
  code?: MotionErrorCode
  message: string
  side?: MotionError['side']
  severity: number
}

export interface FeedbackPolicySnapshot {
  confirmedPrimaryFeedback?: MotionError
  recoveredFeedback?: FeedbackEvent
}
