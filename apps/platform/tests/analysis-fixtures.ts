import { ELECTRONIC_COACH_COURSE_V1 } from '../src/features/course/CourseDefinition'
import type { ExerciseId, MotionErrorCode, RepSummary, RuleMetrics } from '../src/features/exercises/types'
import type { ExerciseSessionResult, RepetitionResult, TrainingSessionState } from '../src/features/training/types'

interface FixtureOptions {
  id: string
  startedAt: number
  score?: number
  mode?: TrainingSessionState['mode']
  source?: TrainingSessionState['source']
  legacy?: boolean
  courseStatus?: TrainingSessionState['courseStatus']
  status?: TrainingSessionState['status']
  exerciseIds?: ExerciseId[]
  affected?: Partial<Record<string, number>>
  invalid?: Partial<Record<ExerciseId, number[]>>
  missingTopElbow?: boolean
  poseQualityOnly?: boolean
}

const ORDER = ELECTRONIC_COACH_COURSE_V1.steps.map((item) => item.exerciseId)

function metrics(exerciseId: ExerciseId, score: number): RuleMetrics {
  const keys: Record<ExerciseId, string[]> = {
    shoulder_rotation: ['amplitude'],
    overhead_raise: ['amplitude', 'elbow', 'synchronization', 'stability', 'tempo'],
    lateral_raise: ['amplitude', 'symmetry', 'stability', 'tempo', 'completion'],
    step_jack: ['coordination', 'amplitude', 'tempo', 'stability', 'completion'],
    squat: ['amplitude', 'stability', 'symmetry', 'completion', 'tempo'],
    knee_raise: ['amplitude', 'stability', 'alternation', 'symmetry', 'tempo'],
  }
  return Object.fromEntries(keys[exerciseId].map((key) => [key, { value: score, score, valid: true }]))
}

function isAffected(options: FixtureOptions, exerciseId: ExerciseId, code: MotionErrorCode, index: number): boolean {
  return index <= (options.affected?.[`${exerciseId}:${code}`] ?? 0)
}

function repSummary(exerciseId: ExerciseId, index: number, options: FixtureOptions): RepSummary {
  const startedAt = options.startedAt + index * 5000
  const common = { exerciseId, repIndex: index, startedAt, completedAt: startedAt + 3000, durationMs: 3000, maxTorsoLean: 4 }
  switch (exerciseId) {
    case 'overhead_raise': return {
      ...common, exerciseId, peakShoulderL: 160, peakShoulderR: 160, minElbowL: 155, minElbowR: 155,
      ...(options.missingTopElbow ? {} : {
        topElbowL: isAffected(options, exerciseId, 'ELBOW_TOO_BENT_L', index) ? 120 : 155,
        topElbowR: isAffected(options, exerciseId, 'ELBOW_TOO_BENT_R', index) ? 120 : 155,
      }),
      maxSymmetryDiff: isAffected(options, exerciseId, 'ASYMMETRY', index) ? 20 : 5,
      amplitudeScore: 90, elbowScore: 90, synchronizationScore: 90, stabilityScore: 90, tempoScore: 90,
      overallScore: options.score ?? 80, errors: [],
    }
    case 'lateral_raise': return {
      ...common, exerciseId, topHoldMs: 400,
      peakShoulderL: isAffected(options, exerciseId, 'ARM_TOO_LOW_L', index) ? 70 : 90,
      peakShoulderR: isAffected(options, exerciseId, 'ARM_TOO_LOW_R', index) ? 70 : 90,
      minElbowL: 160, minElbowR: 160, maxSymmetryDiff: 5,
    }
    case 'step_jack': return {
      ...common, exerciseId, side: index % 2 ? 'left' : 'right', peakOpenRatio: 1.8, peakMeanShoulderAngle: 145,
      maxArmAngleDiff: 5, syncGapMs: isAffected(options, exerciseId, 'ARM_LEG_UNSYNCED', index) ? 600 : 100,
      wrongSideSequence: isAffected(options, exerciseId, 'WRONG_SIDE_SEQUENCE', index), incompleteReturn: false,
    }
    case 'squat': return {
      ...common, exerciseId, bottomTime: startedAt + 1500,
      maxHipDrop: isAffected(options, exerciseId, 'DEPTH_INSUFFICIENT', index) ? 0.2 : 0.35,
      minKneeSpreadRatio: 0.9, maxKneeHeightDiff: 0.02, depthScore: 90, stabilityScore: 90,
      symmetryScore: 90, completionScore: 100, tempoScore: 90, overallScore: options.score ?? 80, errors: [],
    }
    case 'knee_raise': return {
      ...common, exerciseId, side: index % 2 ? 'left' : 'right', startTime: startedAt, topTime: startedAt + 700,
      endTime: startedAt + 1400, durationMs: 1400,
      peakKneeHeight: isAffected(options, exerciseId, index % 2 ? 'KNEE_TOO_LOW_L' : 'KNEE_TOO_LOW_R', index) ? -0.2 : 0,
      hipShiftMax: 0.05, amplitudeScore: 90, stabilityScore: 90, alternationScore: 100, symmetryScore: 90,
      tempoScore: 90, overallScore: options.score ?? 80, errors: [], wrongSideSequence: false, incompleteReturn: false,
    }
    case 'shoulder_rotation': throw new Error('Guidance exercise has no repetition fixture')
  }
}

function repetition(exerciseId: Exclude<ExerciseId, 'shoulder_rotation'>, index: number, options: FixtureOptions): RepetitionResult {
  const invalid = options.invalid?.[exerciseId]?.includes(index) ?? false
  return {
    rep: repSummary(exerciseId, index, options),
    score: options.score ?? 80,
    metrics: invalid ? {} : metrics(exerciseId, options.score ?? 80),
    errors: options.poseQualityOnly && index <= 3 ? ['POSE_LOW_CONFIDENCE'] : [],
  }
}

function exercise(exerciseId: ExerciseId, options: FixtureOptions): ExerciseSessionResult {
  if (exerciseId === 'shoulder_rotation') return {
    exerciseId, startedAt: options.startedAt, endedAt: options.startedAt + 15000, repetitions: [], metricAverages: {},
    overallScore: 0, topErrors: [], feedbackEvents: options.poseQualityOnly ? Array.from({ length: 3 }, (_, index) => ({
      id: `pose-${index}`, timestamp: options.startedAt + index, kind: 'correction' as const, exerciseId,
      code: 'POSE_LOW_CONFIDENCE' as const, message: 'pose', severity: 1,
    })) : [], evaluationMode: 'guidance', targetType: 'duration', targetValue: 15, completed: true,
  }
  const count = exerciseId === 'knee_raise' ? 10 : 6
  const repetitions = Array.from({ length: count }, (_, offset) => repetition(exerciseId, offset + 1, options))
  return {
    exerciseId, startedAt: options.startedAt, endedAt: options.startedAt + count * 5000, repetitions,
    metricAverages: { fakeLegacyAggregate: 1 }, overallScore: 1, topErrors: [], feedbackEvents: [], evaluationMode: 'scored',
    targetType: exerciseId === 'step_jack' ? 'cycles' : 'reps', targetValue: count, completed: true,
  }
}

export function makeAnalysisSession(options: FixtureOptions): TrainingSessionState {
  const exerciseIds = options.exerciseIds ?? ORDER
  const status = options.status ?? 'completed'
  return {
    schemaVersion: 2,
    id: options.id,
    source: options.source ?? 'live',
    mode: options.mode ?? 'normal',
    ...(options.legacy ? {} : { rulesVersion: { spec: 'exercise-rules-v1.0', threshold: 'engineering-v1' } }),
    startedAt: options.startedAt,
    endedAt: status === 'completed' ? options.startedAt + 100000 : undefined,
    status,
    courseId: ELECTRONIC_COACH_COURSE_V1.id,
    courseVersion: ELECTRONIC_COACH_COURSE_V1.version,
    courseStatus: options.courseStatus ?? (exerciseIds.length === ORDER.length ? 'completed' : 'incomplete'),
    courseOverallScore: 1,
    totalFeedbackCount: 999,
    topRecurringErrors: ['BODY_OUT_OF_FRAME'],
    exerciseOrder: ORDER,
    activeExerciseId: exerciseIds.at(-1) ?? 'shoulder_rotation',
    exercises: exerciseIds.map((id) => exercise(id, options)),
  }
}

export const FIRST_SESSION = makeAnalysisSession({ id: 'first', startedAt: 2000, score: 80 })
export const FULL_IMPROVEMENT = {
  current: makeAnalysisSession({ id: 'improved', startedAt: 2000, score: 90 }),
  history: [makeAnalysisSession({ id: 'improved-before', startedAt: 1000, score: 80 })],
}
export const FULL_REGRESSION = {
  current: makeAnalysisSession({ id: 'regressed', startedAt: 2000, score: 70 }),
  history: [makeAnalysisSession({ id: 'regressed-before', startedAt: 1000, score: 85 })],
}
export const PERSISTENT_ISSUE = {
  current: makeAnalysisSession({ id: 'persistent', startedAt: 2000, affected: { 'squat:DEPTH_INSUFFICIENT': 4 } }),
  history: [makeAnalysisSession({ id: 'persistent-before', startedAt: 1000, affected: { 'squat:DEPTH_INSUFFICIENT': 4 } })],
}
export const RESOLVED_ISSUE = {
  current: makeAnalysisSession({ id: 'resolved', startedAt: 2000 }),
  history: [makeAnalysisSession({ id: 'resolved-before', startedAt: 1000, affected: { 'squat:DEPTH_INSUFFICIENT': 3 } })],
}
export const NEW_ISSUE = {
  current: makeAnalysisSession({ id: 'new', startedAt: 2000, affected: { 'squat:DEPTH_INSUFFICIENT': 2 } }),
  history: [makeAnalysisSession({ id: 'new-before', startedAt: 1000 })],
}
export const PARTIAL_SESSION = {
  current: makeAnalysisSession({ id: 'partial', startedAt: 2000, exerciseIds: ['shoulder_rotation', 'overhead_raise', 'lateral_raise'] }),
  history: [makeAnalysisSession({ id: 'partial-before', startedAt: 1000, exerciseIds: ['shoulder_rotation', 'overhead_raise', 'lateral_raise'] })],
}
export const INVALID_REPS = makeAnalysisSession({ id: 'invalid', startedAt: 2000, invalid: { squat: [1, 2, 3, 4] } })
export const POSE_QUALITY_ONLY = makeAnalysisSession({ id: 'pose', startedAt: 2000, poseQualityOnly: true })
export const LEGACY_SESSION = makeAnalysisSession({ id: 'legacy', startedAt: 2000, legacy: true })
export const FAST_SESSION = makeAnalysisSession({ id: 'fast', startedAt: 2000, mode: 'fast' })
export const MISSING_TOP_ELBOW = makeAnalysisSession({ id: 'missing-elbow', startedAt: 2000, missingTopElbow: true })
export const STEP_JACK_FIRST_REP_AND_SYNC_GATE = makeAnalysisSession({ id: 'step-gates', startedAt: 2000, affected: { 'step_jack:WRONG_SIDE_SEQUENCE': 1, 'step_jack:ARM_LEG_UNSYNCED': 2 } })
export const KNEE_RAISE_PAIRING = makeAnalysisSession({ id: 'knee-pairing', startedAt: 2000 })
export const THEME_MERGE_AND_CAPS = makeAnalysisSession({ id: 'merge', startedAt: 2000, affected: {
  'overhead_raise:ELBOW_TOO_BENT_L': 4, 'overhead_raise:ELBOW_TOO_BENT_R': 4,
  'lateral_raise:ARM_TOO_LOW_L': 4, 'lateral_raise:ARM_TOO_LOW_R': 4,
} })
export const DEMO_AND_STANDALONE = makeAnalysisSession({ id: 'demo', startedAt: 2000, source: 'demo' })
export const DETERMINISM = makeAnalysisSession({ id: 'determinism', startedAt: 2000, affected: { 'squat:DEPTH_INSUFFICIENT': 3 } })
