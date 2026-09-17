import type { ExerciseId, MotionErrorCode, RepSummary } from '../../src/features/exercises/types'
import type { FeedbackEvent } from '../../src/features/feedback/types'
import type { ExerciseSessionResult, TrainingSessionState } from '../../src/features/training/types'

export const REPORT_EXERCISE_ORDER: ExerciseId[] = [
  'shoulder_rotation',
  'overhead_raise',
  'lateral_raise',
  'step_jack',
  'squat',
  'knee_raise',
]

const SCORED_FIXTURES: Record<Exclude<ExerciseId, 'shoulder_rotation'>, {
  score: number
  metricAverages: Record<string, number>
  targetType: 'reps' | 'cycles'
  targetValue: number
  repCount: number
}> = {
  overhead_raise: {
    score: 86,
    metricAverages: { amplitude: 90, elbow: 88, synchronization: 82, stability: 86, tempo: 80, completion: 100 },
    targetType: 'reps', targetValue: 10, repCount: 10,
  },
  lateral_raise: {
    score: 81,
    metricAverages: { amplitude: 80, symmetry: 70, stability: 84, tempo: 78, completion: 95 },
    targetType: 'reps', targetValue: 10, repCount: 10,
  },
  step_jack: {
    score: 78,
    metricAverages: { coordination: 76, amplitude: 74, tempo: 72, stability: 80, completion: 90 },
    targetType: 'cycles', targetValue: 6, repCount: 12,
  },
  squat: {
    score: 77,
    metricAverages: { amplitude: 68, stability: 75, symmetry: 79, completion: 92, tempo: 70 },
    targetType: 'reps', targetValue: 10, repCount: 10,
  },
  knee_raise: {
    score: 79,
    metricAverages: { amplitude: 72, stability: 82, alternation: 77, symmetry: 75, tempo: 73, completion: 94 },
    targetType: 'reps', targetValue: 10, repCount: 10,
  },
}

function repetitions(exerciseId: Exclude<ExerciseId, 'shoulder_rotation'>, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    rep: {
      exerciseId,
      repIndex: index + 1,
      startedAt: 1_000 + index * 2_000,
      completedAt: 2_000 + index * 2_000,
      durationMs: 1_000,
      maxTorsoLean: 0,
    } as RepSummary,
    score: SCORED_FIXTURES[exerciseId].score,
    metrics: {},
    errors: [] as MotionErrorCode[],
  }))
}

export function correction(
  exerciseId: ExerciseId,
  code: MotionErrorCode,
  timestamp: number,
  side?: 'left' | 'right',
  severity = 0.8,
): FeedbackEvent {
  return { id: `${exerciseId}-${code}-${timestamp}`, timestamp, kind: 'correction', exerciseId, code, side, severity, message: code }
}

function scoredExercise(exerciseId: Exclude<ExerciseId, 'shoulder_rotation'>, index: number): ExerciseSessionResult {
  const fixture = SCORED_FIXTURES[exerciseId]
  return {
    exerciseId,
    startedAt: 1_700_000_000_000 + index * 60_000,
    endedAt: 1_700_000_045_000 + index * 60_000,
    repetitions: repetitions(exerciseId, fixture.repCount),
    metricAverages: { ...fixture.metricAverages },
    overallScore: fixture.score,
    topErrors: [],
    feedbackEvents: [],
    evaluationMode: 'scored',
    targetType: fixture.targetType,
    targetValue: fixture.targetValue,
    completed: true,
  }
}

export function createCompleteReportSession(): TrainingSessionState {
  const exercises: ExerciseSessionResult[] = [
    {
      exerciseId: 'shoulder_rotation',
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_030_000,
      repetitions: [],
      metricAverages: {},
      overallScore: 0,
      topErrors: [],
      feedbackEvents: [],
      evaluationMode: 'guidance',
      targetType: 'duration',
      targetValue: 30,
      completed: true,
    },
    ...REPORT_EXERCISE_ORDER.slice(1).map((id, index) => scoredExercise(id as Exclude<ExerciseId, 'shoulder_rotation'>, index + 1)),
  ]
  const lateral = exercises.find((item) => item.exerciseId === 'lateral_raise')!
  lateral.feedbackEvents = [
    correction('lateral_raise', 'ARM_TOO_LOW_R', 200, 'right', 0.7),
    correction('lateral_raise', 'ARM_TOO_LOW_R', 220, 'right', 0.9),
    correction('lateral_raise', 'ARM_TOO_LOW_R', 240, 'right', 0.8),
    correction('lateral_raise', 'ARM_TOO_LOW_R', 260, 'right', 0.8),
    { id: 'recovery', timestamp: 280, kind: 'recovery', exerciseId: 'lateral_raise', code: 'ARM_TOO_LOW_R', side: 'right', severity: 0, message: '恢复' },
  ]
  exercises.find((item) => item.exerciseId === 'squat')!.feedbackEvents = [
    correction('squat', 'DEPTH_INSUFFICIENT', 300),
    correction('squat', 'DEPTH_INSUFFICIENT', 320),
    correction('squat', 'DEPTH_INSUFFICIENT', 340),
  ]
  exercises.find((item) => item.exerciseId === 'step_jack')!.feedbackEvents = [
    correction('step_jack', 'ARM_LEG_UNSYNCED', 400),
    correction('step_jack', 'ARM_LEG_UNSYNCED', 420),
  ]

  return {
    schemaVersion: 2,
    id: 'session-report-complete',
    source: 'synthetic',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_360_000,
    status: 'completed',
    courseId: 'full_body_v1',
    courseVersion: '1.0.0',
    courseStatus: 'completed',
    courseOverallScore: 80,
    totalDurationMs: 360_000,
    totalFeedbackCount: 10,
    topRecurringErrors: ['ARM_TOO_LOW_R', 'DEPTH_INSUFFICIENT', 'ARM_LEG_UNSYNCED'],
    exerciseOrder: [...REPORT_EXERCISE_ORDER],
    activeExerciseId: 'knee_raise',
    exercises,
  }
}

export function createIncompleteReportSession(): TrainingSessionState {
  const session = createCompleteReportSession()
  session.id = 'session-report-incomplete'
  session.courseStatus = 'incomplete'
  session.courseOverallScore = 56
  session.activeExerciseId = 'lateral_raise'
  session.exercises = session.exercises.slice(0, 3)
  const lateral = session.exercises[2]
  lateral.completed = false
  lateral.repetitions = lateral.repetitions.slice(0, 3)
  return session
}
