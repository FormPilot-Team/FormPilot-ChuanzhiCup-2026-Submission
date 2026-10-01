import type { FeedbackEvent } from '../feedback/types'
import type { ExerciseId, ExerciseState, MotionErrorCode, RuleResult } from '../exercises/types'
import { EXERCISE_ORDER } from '../exercises/order'
import { MemoryTrainingSessionRepository } from './MemoryTrainingSessionRepository'
import type { TrainingSessionRepository } from './TrainingSessionRepository'
import type { ExerciseSessionResult, GuidanceMetricSummary, TrainingCaptureSource, TrainingSessionState } from './types'
import { ELECTRONIC_COACH_COURSE_V1 } from '../course/CourseDefinition'
import { ENGINEERING_THRESHOLD_VERSION, EXERCISE_SPEC_VERSION } from '../exercises/thresholdVersioning'
import type { TrainingMode } from './types'

function createExercise(exerciseId: ExerciseId, startedAt: number): ExerciseSessionResult {
  const step = ELECTRONIC_COACH_COURSE_V1.steps.find((item) => item.exerciseId === exerciseId)
  return {
    exerciseId,
    startedAt,
    repetitions: [],
    metricAverages: {},
    overallScore: 0,
    topErrors: [],
    feedbackEvents: [],
    evaluationMode: step?.evaluationMode ?? 'scored',
    targetType: step?.target.type ?? 'reps',
    targetValue: step?.target.value,
  }
}

function createSessionId(now: number): string {
  return `session-${now}-${Math.random().toString(36).slice(2, 10)}`
}

interface GuidanceAccumulator {
  samples: number
  sums: Map<string, { value: number; score: number }>
  errorFrames: Map<MotionErrorCode, number>
}

const POSE_QUALITY_CODES = new Set<MotionErrorCode>(['BODY_OUT_OF_FRAME', 'POSE_LOW_CONFIDENCE'])

export class TrainingSession {
  private state: TrainingSessionState
  private lastPersistOk = true
  private readonly guidance = new Map<ExerciseId, GuidanceAccumulator>()

  constructor(
    now = Date.now(),
    private readonly repository: TrainingSessionRepository = new MemoryTrainingSessionRepository(),
    exerciseOrder: ExerciseId[] = EXERCISE_ORDER,
    source: TrainingCaptureSource = 'live',
    mode: TrainingMode = 'normal',
  ) {
    const order = [...exerciseOrder]
    this.state = {
      schemaVersion: 2,
      id: createSessionId(now),
      source,
      mode,
      rulesVersion: {
        spec: EXERCISE_SPEC_VERSION,
        threshold: ENGINEERING_THRESHOLD_VERSION,
      },
      startedAt: now,
      status: 'ready',
      courseId: ELECTRONIC_COACH_COURSE_V1.id,
      courseVersion: ELECTRONIC_COACH_COURSE_V1.version,
      courseStatus: 'in_progress',
      exerciseOrder: order,
      activeExerciseId: order[0],
      exercises: [createExercise(order[0], now)],
    }
  }

  start(): TrainingSessionState {
    this.state.status = 'active'
    this.persist()
    return this.snapshot()
  }

  togglePause(): TrainingSessionState {
    if (this.state.status === 'completed') return this.snapshot()
    this.state.status = this.state.status === 'paused' ? 'active' : 'paused'
    this.persist()
    return this.snapshot()
  }

  switchExercise(exerciseId: ExerciseId, now = Date.now()): TrainingSessionState {
    if (exerciseId === this.state.activeExerciseId) return this.snapshot()
    const current = this.exercise(this.state.activeExerciseId)
    current.endedAt ??= now
    this.state.activeExerciseId = exerciseId
    if (!this.state.exercises.some((item) => item.exerciseId === exerciseId)) {
      this.state.exercises.push(createExercise(exerciseId, now))
    }
    this.persist()
    return this.snapshot()
  }

  record(result: RuleResult, snapshot: ExerciseState, feedback?: FeedbackEvent): void {
    const exercise = this.exercise(result.exerciseId)
    if (feedback) exercise.feedbackEvents.push(feedback)
    if (exercise.evaluationMode === 'guidance') this.sampleGuidance(exercise, result)
    if (snapshot.completedRep && !exercise.repetitions.some((item) => item.rep.repIndex === snapshot.completedRep?.repIndex)) {
      exercise.repetitions.push({
        rep: snapshot.completedRep,
        score: result.currentScore,
        metrics: result.metrics,
        errors: result.errors.map((item) => item.code),
      })
      this.updateAggregates(exercise)
    }
    if (feedback || snapshot.completedRep) this.persist()
  }

  completeGuidanceExercise(exerciseId: ExerciseId, now = Date.now()): void {
    const exercise = this.exercise(exerciseId)
    exercise.endedAt ??= now
    exercise.completed = true
    exercise.evaluationMode = 'guidance'
    exercise.targetType = 'duration'
    this.persist()
  }

  finish(now = Date.now(), courseStatus: 'completed' | 'incomplete' = 'completed'): TrainingSessionState {
    this.exercise(this.state.activeExerciseId).endedAt ??= now
    this.state.status = 'completed'
    this.state.courseStatus = courseStatus
    this.state.endedAt = now
    this.state.totalDurationMs = now - this.state.startedAt
    const scored = this.state.exercises.filter((item) => item.evaluationMode !== 'guidance' && item.repetitions.length)
    this.state.courseOverallScore = scored.length ? Math.round(scored.reduce((sum, item) => sum + item.overallScore, 0) / scored.length) : 0
    this.state.totalFeedbackCount = this.state.exercises.reduce((sum, item) => sum + item.feedbackEvents.length, 0)
    const errorCounts = new Map<MotionErrorCode, number>()
    for (const item of this.state.exercises) for (const repetition of item.repetitions) for (const code of repetition.errors) errorCounts.set(code, (errorCounts.get(code) ?? 0) + 1)
    this.state.topRecurringErrors = [...errorCounts.entries()].sort((a,b) => b[1]-a[1]).slice(0,3).map(([code]) => code)
    this.lastPersistOk = this.persist()
    return this.snapshot()
  }

  didPersist(): boolean {
    return this.lastPersistOk
  }

  snapshot(): TrainingSessionState {
    return structuredClone(this.state)
  }

  status(): TrainingSessionState['status'] {
    return this.state.status
  }

  private exercise(exerciseId: ExerciseId): ExerciseSessionResult {
    const existing = this.state.exercises.find((item) => item.exerciseId === exerciseId)
    if (existing) return existing
    const created = createExercise(exerciseId, Date.now())
    this.state.exercises.push(created)
    return created
  }

  /** 引导类动作没有次数，记录实时指标的均值供报告使用 */
  private sampleGuidance(exercise: ExerciseSessionResult, result: RuleResult): void {
    const metrics = Object.entries(result.metrics)
    if (result.phase === 'READY' || !metrics.length || !metrics.every(([, metric]) => metric.valid)) return
    if (result.errors.some((error) => POSE_QUALITY_CODES.has(error.code))) return
    let accumulator = this.guidance.get(exercise.exerciseId)
    if (!accumulator) {
      accumulator = { samples: 0, sums: new Map(), errorFrames: new Map() }
      this.guidance.set(exercise.exerciseId, accumulator)
    }
    accumulator.samples += 1
    for (const [key, metric] of metrics) {
      const sum = accumulator.sums.get(key) ?? { value: 0, score: 0 }
      accumulator.sums.set(key, { value: sum.value + metric.value, score: sum.score + metric.score })
    }
    for (const code of new Set(result.errors.map((error) => error.code))) accumulator.errorFrames.set(code, (accumulator.errorFrames.get(code) ?? 0) + 1)
    const samples = accumulator.samples
    const summary: GuidanceMetricSummary = {
      samples,
      metrics: Object.fromEntries([...accumulator.sums].map(([key, sum]) => [key, { value: sum.value / samples, score: sum.score / samples }])),
      errorFrames: Object.fromEntries(accumulator.errorFrames),
    }
    exercise.guidanceSummary = summary
  }

  private updateAggregates(exercise: ExerciseSessionResult): void {
    if (exercise.repetitions.length === 0) return
    exercise.overallScore = Math.round(exercise.repetitions.reduce((sum, item) => sum + item.score, 0) / exercise.repetitions.length)
    const metricKeys = new Set(exercise.repetitions.flatMap((item) => Object.keys(item.metrics)))
    exercise.metricAverages = Object.fromEntries([...metricKeys].map((key) => {
      const values = exercise.repetitions.map((item) => item.metrics[key]?.score).filter((value): value is number => value !== undefined)
      return [key, values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0]
    }))
    const counts = new Map<MotionErrorCode, number>()
    for (const rep of exercise.repetitions) for (const code of rep.errors) counts.set(code, (counts.get(code) ?? 0) + 1)
    exercise.topErrors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([code]) => code)
  }

  private persist(): boolean {
    return this.repository.save(this.snapshot())
  }
}
