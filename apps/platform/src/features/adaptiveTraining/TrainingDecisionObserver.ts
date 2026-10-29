import type { TrainingDecisionInput, ErrorCode } from './protocol.ts'

export interface DecisionObservation {
  exerciseId: TrainingDecisionInput['exerciseId']
  phase: TrainingDecisionInput['phase']
  trainingState: TrainingDecisionInput['trainingState']
  poseValid: boolean
  poseReliability?: number
  score: number | null
  errors: TrainingDecisionInput['errors']
  feedback?: { id: string; kind: 'correction' | 'recovery'; code?: ErrorCode }
  elapsedSeconds: number
  completion: number
  completedReps: number
}

// Sampled once per second; counts confirmed feedback events, never individual pose frames.
export class TrainingDecisionObserver {
  private exerciseId?: string
  private lastFeedbackId?: string
  private errorCode?: ErrorCode
  private streak = 0
  private response: TrainingDecisionInput['feedbackResponse'] = 'unknown'
  private stableSince?: number
  private scores: number[] = []
  private activeMs = 0
  private previousAt?: number
  private previouslyActive = false

  observe(v: DecisionObservation, now: number): TrainingDecisionInput {
    if (this.exerciseId !== v.exerciseId) {
      this.exerciseId = v.exerciseId; this.lastFeedbackId = undefined; this.errorCode = undefined
      this.streak = 0; this.response = 'unknown'; this.stableSince = undefined; this.scores = []
    }
    const observing = v.trainingState === 'ACTIVE' && v.poseValid
    if (observing && this.previouslyActive && this.previousAt !== undefined) this.activeMs += Math.max(0, Math.min(2000, now - this.previousAt))
    this.previousAt = now
    this.previouslyActive = observing
    if (observing && v.feedback && v.feedback.id !== this.lastFeedbackId) {
      this.lastFeedbackId = v.feedback.id
      // A transient rule recovery while returning to the starting phase does not establish effective correction.
      if (v.feedback.kind === 'recovery') { this.response = this.streak >= 2 ? 'not_corrected' : 'unknown' }
      else if (v.feedback.code) {
        this.streak = this.errorCode === v.feedback.code ? Math.min(1000, this.streak + 1) : 1
        this.errorCode = v.feedback.code
        this.response = this.streak >= 2 ? 'not_corrected' : 'unknown'
      }
    }
    if (observing && v.errors.length === 0) {
      this.stableSince ??= now
      if (now - this.stableSince >= 10000 && this.streak > 0) {
        this.streak = 0; this.errorCode = undefined; this.response = 'corrected'
      }
    } else this.stableSince = undefined
    if (observing && v.score !== null) this.scores = [...this.scores, v.score].slice(-20)
    return {
      exerciseId: v.exerciseId, phase: v.phase, trainingState: v.trainingState, poseValid: v.poseValid,
      ...(v.poseReliability === undefined ? {} : { poseReliability: v.poseReliability }),
      score: v.score, errors: v.errors, consecutiveErrors: this.streak, feedbackResponse: this.response,
      elapsedSeconds: Math.min(86400, Math.max(0, v.elapsedSeconds)), completion: Math.min(1, Math.max(0, v.completion)),
      history: {
        averageScore: this.scores.length ? Math.round(this.scores.reduce((sum, n) => sum + n, 0) / this.scores.length) : null,
        stableSeconds: this.stableSince === undefined ? 0 : Math.floor((now - this.stableSince) / 1000), completedReps: v.completedReps,
        activeSeconds: this.activeMs / 1000,
      },
    }
  }
}
