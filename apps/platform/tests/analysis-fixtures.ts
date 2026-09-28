import { ELECTRONIC_COACH_COURSE_V1 } from '../src/features/course/CourseDefinition'
import { calculateKneeRaiseMetrics, weightedKneeRaiseScore } from '../src/features/exercises/kneeRaise/scoring'
import type { KneeRaiseStateSnapshot } from '../src/features/exercises/kneeRaise/stateMachine'
import { calculateMetrics as calculateLateralMetrics, weightedScore as weightedLateralScore } from '../src/features/exercises/lateralRaise/scoring'
import type { LateralRaiseStateSnapshot } from '../src/features/exercises/lateralRaise/stateMachine'
import { calculateOverheadRaiseScoreComponents, overheadWeightedScore } from '../src/features/exercises/overheadRaise/scoring'
import { metricScore } from '../src/features/exercises/scoring'
import { calculateSquatMetrics, weightedSquatScore } from '../src/features/exercises/squat/scoring'
import type { SquatStateSnapshot } from '../src/features/exercises/squat/stateMachine'
import { STEP_JACK_V1 } from '../src/features/exercises/stepJack/config'
import { calculateStepJackMetrics, weightedStepJackScore } from '../src/features/exercises/stepJack/scoring'
import type { StepJackStateSnapshot } from '../src/features/exercises/stepJack/stateMachine'
import { ENGINEERING_THRESHOLD_VERSION, EXERCISE_SPEC_VERSION } from '../src/features/exercises/thresholdVersioning'
import type {
  ExerciseId, KneeRaiseRepSummary, LateralRaiseRepSummary, MotionErrorCode, OverheadRaiseRepSummary, RepSummary,
  RuleMetrics, SquatRepSummary, StepJackRepSummary,
} from '../src/features/exercises/types'
import type { FeedbackEvent } from '../src/features/feedback/types'
import type { ExerciseSessionResult, RepetitionResult, TrainingSessionState } from '../src/features/training/types'

/**
 * Realistic analysis-v1 fixtures. Every repetition's metrics and score come from the real runtime scoring
 * functions applied to its raw fields, and stored aggregates are deliberately wrong so any code that reads them fails.
 */
type Scored = Exclude<ExerciseId, 'shoulder_rotation'>
type RawOf<T> = Partial<Omit<T, 'exerciseId' | 'repIndex'>> & { omitTopElbow?: boolean }
export interface RawOverrides {
  overhead_raise: RawOf<OverheadRaiseRepSummary>
  lateral_raise: RawOf<LateralRaiseRepSummary>
  step_jack: RawOf<StepJackRepSummary>
  squat: RawOf<SquatRepSummary>
  knee_raise: RawOf<KneeRaiseRepSummary>
}

export interface ExerciseSpec<E extends Scored = Scored> {
  reps?: number
  raw?: (index: number) => RawOverrides[E] | undefined
  /** 0-based rep indexes completed on a pose-invalid frame (score 0, metrics.valid=false, pose error). */
  poseInvalid?: Partial<Record<number, 'BODY_OUT_OF_FRAME' | 'POSE_LOW_CONFIDENCE'>>
  /** 0-based rep indexes stored with `metrics: {}`. */
  emptyMetrics?: number[]
  prompts?: Partial<Record<MotionErrorCode, number>>
  targetValue?: number
}

export interface SessionSpec {
  id: string
  startedAt: number
  mode?: 'normal' | 'fast' | null
  rulesVersion?: { spec: string; threshold: string } | null
  source?: TrainingSessionState['source']
  status?: TrainingSessionState['status']
  courseStatus?: TrainingSessionState['courseStatus']
  exerciseOrder?: ExerciseId[]
  /** Exercises present in the record (defaults to the whole course); `false` removes one. */
  include?: ExerciseId[]
  shoulderPrompts?: Partial<Record<MotionErrorCode, number>>
  shoulderCompleted?: boolean
  exercises?: { [E in Scored]?: ExerciseSpec<E> }
}

export const COURSE_ORDER = ELECTRONIC_COACH_COURSE_V1.steps.map((step) => step.exerciseId)
const PLANNED: Record<Scored, number> = { overhead_raise: 6, lateral_raise: 6, step_jack: 12, squat: 6, knee_raise: 10 }
const DURATION: Record<Scored, number> = { overhead_raise: 3000, lateral_raise: 2800, step_jack: 1400, squat: 4000, knee_raise: 1300 }
const BASE_CLOCK = 50_000

/** Deterministic per-rep jitter so reps are not identical (stays inside every recommended band / threshold). */
function jitterMs(index: number): number {
  return ((index * 137) % 300) - 150
}
function jitterLean(index: number): number {
  return index % 3
}

function overheadRep(index: number, startedAt: number, raw: RawOverrides['overhead_raise'] = {}): { rep: RepSummary; metrics: RuleMetrics } {
  const durationMs = raw.durationMs ?? DURATION.overhead_raise + jitterMs(index)
  const values = {
    peakShoulderL: 156, peakShoulderR: 153, minElbowL: 140, minElbowR: 143, topElbowL: 158, topElbowR: 161,
    maxSymmetryDiff: 7, maxTorsoLean: 5 + jitterLean(index), ...raw,
  }
  const topElbowL = raw.omitTopElbow ? 110 : values.topElbowL
  const topElbowR = raw.omitTopElbow ? 110 : values.topElbowR
  const components = calculateOverheadRaiseScoreComponents(values.peakShoulderL, values.peakShoulderR, topElbowL, topElbowR,
    values.maxSymmetryDiff, values.maxTorsoLean, durationMs)
  const elbow = Math.min(topElbowL, topElbowR)
  const metrics: RuleMetrics = {
    amplitude: metricScore((values.peakShoulderL + values.peakShoulderR) / 2, components.amplitude, '°'),
    elbow: metricScore(elbow, components.elbow, '°'),
    synchronization: metricScore(values.maxSymmetryDiff, components.synchronization, '°'),
    stability: metricScore(values.maxTorsoLean, components.stability, '°'),
    tempo: metricScore(durationMs / 1000, components.tempo, 's'),
  }
  const rep: OverheadRaiseRepSummary = {
    exerciseId: 'overhead_raise', repIndex: index + 1, startedAt, completedAt: startedAt + durationMs, durationMs,
    maxTorsoLean: values.maxTorsoLean, peakShoulderL: values.peakShoulderL, peakShoulderR: values.peakShoulderR,
    minElbowL: values.minElbowL, minElbowR: values.minElbowR,
    ...(raw.omitTopElbow ? {} : { topElbowL: values.topElbowL, topElbowR: values.topElbowR }),
    maxSymmetryDiff: values.maxSymmetryDiff,
    amplitudeScore: components.amplitude, elbowScore: components.elbow, synchronizationScore: components.synchronization,
    stabilityScore: components.stability, tempoScore: components.tempo, overallScore: components.overall, errors: [],
  }
  return { rep, metrics }
}

function lateralRep(index: number, startedAt: number, raw: RawOverrides['lateral_raise'] = {}): { rep: RepSummary; metrics: RuleMetrics } {
  const durationMs = raw.durationMs ?? DURATION.lateral_raise + jitterMs(index)
  const rep: LateralRaiseRepSummary = {
    exerciseId: 'lateral_raise', repIndex: index + 1, startedAt, completedAt: startedAt + durationMs, durationMs,
    maxTorsoLean: 6 + jitterLean(index), topHoldMs: 350, peakShoulderL: 86, peakShoulderR: 84, minElbowL: 162, minElbowR: 160, maxSymmetryDiff: 9,
    ...raw,
  }
  const snapshot = { completedRep: rep, phase: 'COMPLETE' } as unknown as LateralRaiseStateSnapshot
  const metrics = calculateLateralMetrics(snapshot, { shoulderL: 0, shoulderR: 0, symmetry: 0, torsoLean: 0, timestamp: rep.completedAt })
  return { rep, metrics }
}

function stepJackRep(index: number, startedAt: number, raw: RawOverrides['step_jack'] = {}): { rep: RepSummary; metrics: RuleMetrics } {
  const durationMs = raw.durationMs ?? DURATION.step_jack + jitterMs(index)
  const side = raw.side ?? (index % 2 === 0 ? 'left' : 'right')
  const peakOpenRatio = raw.peakOpenRatio ?? 1.75
  const peakMeanShoulderAngle = raw.peakMeanShoulderAngle ?? 142
  // Runtime fallback: without both thresholds crossed, syncGapMs is the whole rep duration.
  const gated = peakOpenRatio >= STEP_JACK_V1.openMinRatio && peakMeanShoulderAngle >= STEP_JACK_V1.armTopMinAngle
  const rep: StepJackRepSummary = {
    exerciseId: 'step_jack', repIndex: index + 1, startedAt, completedAt: startedAt + durationMs, durationMs,
    maxTorsoLean: 6 + jitterLean(index), side, peakOpenRatio, peakMeanShoulderAngle, maxArmAngleDiff: 8,
    syncGapMs: gated ? 250 : durationMs, wrongSideSequence: false, incompleteReturn: false,
    ...raw,
  }
  const snapshot = { completedRep: rep, phase: 'CENTER' } as unknown as StepJackStateSnapshot
  const metrics = calculateStepJackMetrics(snapshot, {
    openRatio: 1, meanShoulderAngle: 0, torsoLean: 0, timestamp: rep.completedAt,
  } as Parameters<typeof calculateStepJackMetrics>[1])
  return { rep, metrics }
}

function squatRep(index: number, startedAt: number, raw: RawOverrides['squat'] = {}): { rep: RepSummary; metrics: RuleMetrics } {
  const durationMs = raw.durationMs ?? DURATION.squat + jitterMs(index)
  const rep: SquatRepSummary = {
    exerciseId: 'squat', repIndex: index + 1, startedAt, completedAt: startedAt + durationMs, durationMs, maxTorsoLean: 5 + jitterLean(index),
    bottomTime: startedAt + durationMs / 2, maxHipDrop: 0.32, minKneeSpreadRatio: 0.86, maxKneeHeightDiff: 0.05,
    depthScore: 0, stabilityScore: 0, symmetryScore: 0, completionScore: 100, tempoScore: 0, overallScore: 0, errors: [],
    ...raw,
  }
  const snapshot = { completedRep: rep, phase: 'COMPLETE' } as unknown as SquatStateSnapshot
  const metrics = calculateSquatMetrics(snapshot, { hipDrop: 0, kneeSpreadRatio: 1, kneeHeightDiff: 0, torsoLean: 0, timestamp: rep.completedAt })
  rep.depthScore = metrics.amplitude.score
  rep.stabilityScore = metrics.stability.score
  rep.symmetryScore = metrics.symmetry.score
  rep.tempoScore = metrics.tempo.score
  rep.overallScore = weightedSquatScore(metrics)
  return { rep, metrics }
}

function kneeRep(index: number, startedAt: number, raw: RawOverrides['knee_raise'], peaks: { left?: number; right?: number }): { rep: RepSummary; metrics: RuleMetrics } {
  const durationMs = raw?.durationMs ?? DURATION.knee_raise + jitterMs(index)
  const side = raw?.side ?? (index % 2 === 0 ? 'left' : 'right')
  const rep: KneeRaiseRepSummary = {
    exerciseId: 'knee_raise', repIndex: index + 1, startedAt, completedAt: startedAt + durationMs, durationMs, maxTorsoLean: 5 + jitterLean(index),
    side, startTime: startedAt, topTime: startedAt + durationMs / 2, endTime: startedAt + durationMs,
    peakKneeHeight: side === 'left' ? -0.07 : -0.1, hipShiftMax: 0.08, amplitudeScore: 0, stabilityScore: 0, alternationScore: 100, symmetryScore: 0,
    tempoScore: 0, overallScore: 0, errors: [], wrongSideSequence: false, incompleteReturn: false,
    ...raw,
  }
  peaks[rep.side] = rep.peakKneeHeight
  const snapshot = {
    completedRep: rep, phase: 'CENTER', currentSide: rep.side, lastLeftPeak: peaks.left, lastRightPeak: peaks.right,
  } as unknown as KneeRaiseStateSnapshot
  const metrics = calculateKneeRaiseMetrics(snapshot, { leftKneeHeight: -1, rightKneeHeight: -1, hipHorizontalShift: 0, torsoLean: 0, timestamp: rep.completedAt })
  rep.amplitudeScore = metrics.amplitude.score
  rep.stabilityScore = metrics.stability.score
  rep.alternationScore = metrics.alternation.score
  rep.symmetryScore = metrics.symmetry.score
  rep.tempoScore = metrics.tempo.score
  rep.overallScore = weightedKneeRaiseScore(metrics)
  return { rep, metrics }
}

function weighted(exerciseId: Scored, metrics: RuleMetrics): number {
  if (exerciseId === 'overhead_raise') return overheadWeightedScore(metrics)
  if (exerciseId === 'lateral_raise') return weightedLateralScore(metrics)
  if (exerciseId === 'step_jack') return weightedStepJackScore(metrics)
  if (exerciseId === 'squat') return weightedSquatScore(metrics)
  return weightedKneeRaiseScore(metrics)
}

function prompts(exerciseId: ExerciseId, counts: Partial<Record<MotionErrorCode, number>> | undefined, clock: number): FeedbackEvent[] {
  if (!counts) return []
  return Object.entries(counts).flatMap(([code, count]) => Array.from({ length: count ?? 0 }, (_, index) => ({
    id: `${exerciseId}-${code}-${index}`, timestamp: clock + index, kind: 'correction' as const, exerciseId,
    code: code as MotionErrorCode, message: 'prompt', severity: 1,
  })))
}

function scoredExercise<E extends Scored>(exerciseId: E, spec: ExerciseSpec<E> = {}, startedAt: number): ExerciseSessionResult {
  const count = spec.reps ?? PLANNED[exerciseId]
  const peaks: { left?: number; right?: number } = {}
  const repetitions: RepetitionResult[] = Array.from({ length: count }, (_, index) => {
    const repStart = BASE_CLOCK + index * 6000
    const raw = spec.raw?.(index)
    const built = exerciseId === 'overhead_raise' ? overheadRep(index, repStart, raw as RawOverrides['overhead_raise'])
      : exerciseId === 'lateral_raise' ? lateralRep(index, repStart, raw as RawOverrides['lateral_raise'])
        : exerciseId === 'step_jack' ? stepJackRep(index, repStart, raw as RawOverrides['step_jack'])
          : exerciseId === 'squat' ? squatRep(index, repStart, raw as RawOverrides['squat'])
            : kneeRep(index, repStart, raw as RawOverrides['knee_raise'], peaks)
    const poseCode = spec.poseInvalid?.[index]
    if (poseCode) {
      const metrics = Object.fromEntries(Object.entries(built.metrics).map(([key, metric]) => [key, { ...metric, valid: false }]))
      return { rep: built.rep, score: 0, metrics, errors: [poseCode] }
    }
    if (spec.emptyMetrics?.includes(index)) return { rep: built.rep, score: weighted(exerciseId, built.metrics), metrics: {}, errors: [] }
    return { rep: built.rep, score: weighted(exerciseId, built.metrics), metrics: built.metrics, errors: [] }
  })
  const step = ELECTRONIC_COACH_COURSE_V1.steps.find((item) => item.exerciseId === exerciseId)
  const stored = repetitions.length ? Math.round(repetitions.reduce((sum, item) => sum + item.score, 0) / repetitions.length) : 0
  return {
    exerciseId, startedAt, endedAt: startedAt + 60_000, repetitions,
    // Deliberately misleading stored aggregates: analysis-v1 must never read them.
    metricAverages: { amplitude: 1, stability: 1 }, overallScore: stored === 0 ? 1 : stored - 17, topErrors: ['BODY_OUT_OF_FRAME'],
    feedbackEvents: prompts(exerciseId, spec.prompts, startedAt),
    evaluationMode: 'scored', targetType: step?.target.type, targetValue: spec.targetValue ?? step?.target.value,
  }
}

export function makeSession(spec: SessionSpec): TrainingSessionState {
  const include = spec.include ?? COURSE_ORDER
  const exercises: ExerciseSessionResult[] = include.map((exerciseId, position) => {
    const startedAt = spec.startedAt + position * 90_000
    if (exerciseId === 'shoulder_rotation') {
      return {
        exerciseId, startedAt, endedAt: startedAt + 15_000, repetitions: [], metricAverages: {}, overallScore: 0, topErrors: [],
        feedbackEvents: prompts(exerciseId, spec.shoulderPrompts, startedAt), evaluationMode: 'guidance', targetType: 'duration',
        targetValue: 15, completed: spec.shoulderCompleted ?? true,
      }
    }
    const scored = exerciseId as Scored
    return scoredExercise(scored, spec.exercises?.[scored] as ExerciseSpec<typeof scored> | undefined, startedAt)
  })
  const status = spec.status ?? 'completed'
  const session: TrainingSessionState = {
    schemaVersion: 2,
    id: spec.id,
    source: spec.source ?? 'live',
    startedAt: spec.startedAt,
    ...(status === 'completed' ? { endedAt: spec.startedAt + 600_000 } : {}),
    status,
    courseId: ELECTRONIC_COACH_COURSE_V1.id,
    courseVersion: ELECTRONIC_COACH_COURSE_V1.version,
    courseStatus: spec.courseStatus ?? (status === 'completed' ? (include.length === COURSE_ORDER.length ? 'completed' : 'incomplete') : 'in_progress'),
    courseOverallScore: 1,
    totalFeedbackCount: 999,
    topRecurringErrors: ['BODY_OUT_OF_FRAME', 'POSE_LOW_CONFIDENCE'],
    exerciseOrder: spec.exerciseOrder ?? [...COURSE_ORDER],
    activeExerciseId: include.at(-1) ?? 'shoulder_rotation',
    exercises,
  }
  if (spec.mode !== null) session.mode = spec.mode ?? 'normal'
  if (spec.rulesVersion !== null) session.rulesVersion = spec.rulesVersion ?? { spec: EXERCISE_SPEC_VERSION, threshold: ENGINEERING_THRESHOLD_VERSION }
  return session
}

/** First `count` reps get `value`, the rest get nothing. */
export function firstN<T>(count: number, value: T): (index: number) => T | undefined {
  return (index) => (index < count ? value : undefined)
}

/** Only the listed 0-based rep indexes get `value`. */
export function atIndexes<T>(indexes: readonly number[], value: T): (index: number) => T | undefined {
  return (index) => (indexes.includes(index) ? value : undefined)
}

const DAY = 86_400_000
export const T0 = 1_780_000_000_000
export const at = (days: number) => T0 + days * DAY

// ── 12 golden fixtures (8F-1A §26) ────────────────────────────────────────────────────────────────

export const FIRST_SESSION = makeSession({
  id: 'first', startedAt: at(1),
  exercises: { lateral_raise: { raw: atIndexes([0, 2, 3, 5], { peakShoulderL: 76, peakShoulderR: 86, maxSymmetryDiff: 10 }) } },
})

export const FULL_IMPROVEMENT = {
  history: [makeSession({
    id: 'improvement-before', startedAt: at(1),
    exercises: {
      overhead_raise: { raw: () => ({ maxSymmetryDiff: 11, maxTorsoLean: 8 }) },
      lateral_raise: { raw: (index) => ({ maxTorsoLean: 8, ...([0, 2, 3, 5].includes(index) ? { peakShoulderL: 70, peakShoulderR: 84, maxSymmetryDiff: 14 } : {}) }) },
      step_jack: { raw: () => ({ syncGapMs: 330, maxTorsoLean: 9 }) },
      squat: { raw: atIndexes([0, 2, 4], { maxHipDrop: 0.2 }) },
      knee_raise: { raw: () => ({ hipShiftMax: 0.14 }) },
    },
  })],
  current: makeSession({
    id: 'improvement', startedAt: at(2),
    exercises: {
      lateral_raise: { raw: atIndexes([1], { peakShoulderL: 72, peakShoulderR: 84, maxSymmetryDiff: 12 }) },
      knee_raise: { raw: () => ({ hipShiftMax: 0.1 }) },
    },
  }),
}

export const FULL_REGRESSION = {
  history: [makeSession({
    id: 'regression-before', startedAt: at(1),
    exercises: { overhead_raise: { raw: atIndexes([1, 4], { peakShoulderL: 146, peakShoulderR: 147 }) } },
  })],
  current: makeSession({
    id: 'regression', startedAt: at(2),
    exercises: {
      overhead_raise: { raw: atIndexes([0, 2, 3, 5], { peakShoulderL: 128, peakShoulderR: 131 }) },
      squat: { raw: (index) => ({ maxTorsoLean: 8, ...(index % 2 === 0 ? { minKneeSpreadRatio: 0.66 } : {}) }) },
      knee_raise: { raw: () => ({ hipShiftMax: 0.17 }) },
    },
  }),
}

export const PERSISTENT_ISSUE = {
  history: [makeSession({
    id: 'persistent-before', startedAt: at(1),
    exercises: {
      squat: { raw: atIndexes([0, 1, 3, 5], { maxHipDrop: 0.22 }) },
      lateral_raise: { raw: atIndexes([0, 2, 3, 5], { peakShoulderL: 74, peakShoulderR: 84 }) },
    },
  })],
  current: makeSession({
    id: 'persistent', startedAt: at(2),
    exercises: {
      squat: { raw: atIndexes([0, 2, 4], { maxHipDrop: 0.22 }) },
      lateral_raise: { raw: atIndexes([1, 4], { peakShoulderL: 74, peakShoulderR: 84 }) },
    },
  }),
}

export const RESOLVED_ISSUE = {
  history: [makeSession({
    id: 'resolved-before', startedAt: at(1),
    exercises: {
      squat: { raw: atIndexes([0, 2, 4], { maxHipDrop: 0.2 }) },
      knee_raise: { raw: atIndexes([0, 4], { peakKneeHeight: -0.16 }) },
      overhead_raise: { raw: atIndexes([1, 4], { topElbowL: 121 }) },
    },
  })],
  current: makeSession({
    id: 'resolved', startedAt: at(2),
    exercises: { overhead_raise: { raw: (index) => (index >= 3 ? { omitTopElbow: true } : undefined) } },
  }),
}

export const NEW_ISSUE = {
  history: [makeSession({
    id: 'new-before', startedAt: at(1),
    exercises: {
      overhead_raise: { raw: atIndexes([2], { peakShoulderL: 142, peakShoulderR: 143 }) },
      lateral_raise: { raw: atIndexes([3], { maxTorsoLean: 13 }) },
      squat: { raw: atIndexes([0, 3], { maxKneeHeightDiff: 0.1 }) },
    },
  })],
  current: makeSession({
    id: 'new', startedAt: at(2),
    exercises: {
      overhead_raise: { raw: atIndexes([0, 2, 4], { peakShoulderL: 142, peakShoulderR: 143 }) },
      lateral_raise: { raw: atIndexes([1, 4], { maxTorsoLean: 13 }) },
      squat: { raw: (index) => ({ ...(index === 1 || index === 4 ? { maxHipDrop: 0.24 } : {}), ...(index === 2 ? { maxKneeHeightDiff: 0.1 } : {}) }) },
    },
  }),
}

export const PARTIAL_SESSION = {
  history: [makeSession({ id: 'partial-before', startedAt: at(1) })],
  current: makeSession({
    id: 'partial', startedAt: at(2), courseStatus: 'incomplete',
    include: ['shoulder_rotation', 'overhead_raise', 'lateral_raise', 'step_jack', 'squat'],
    exercises: { squat: { reps: 3 } },
  }),
  /** Ended during lateral raise: only overhead raise is common and completed. */
  oneCommon: makeSession({
    id: 'partial-one', startedAt: at(2), courseStatus: 'incomplete',
    include: ['shoulder_rotation', 'overhead_raise', 'lateral_raise'],
    exercises: { lateral_raise: { reps: 2 } },
  }),
}

/** Overhead: reps 1 and 3 completed on pose-invalid frames, rep 5 stored with empty metrics. */
export const INVALID_REPS = makeSession({
  id: 'invalid', startedAt: at(1),
  exercises: { overhead_raise: { poseInvalid: { 1: 'BODY_OUT_OF_FRAME', 3: 'POSE_LOW_CONFIDENCE' }, emptyMetrics: [5], raw: atIndexes([0, 2], { maxSymmetryDiff: 16 }) } },
})
export const INVALID_REPS_FOUR = makeSession({
  id: 'invalid-four', startedAt: at(1),
  exercises: { overhead_raise: { poseInvalid: { 0: 'BODY_OUT_OF_FRAME', 1: 'BODY_OUT_OF_FRAME', 2: 'POSE_LOW_CONFIDENCE' }, emptyMetrics: [3] } },
})

/** Clean reps everywhere; only pose-quality prompts (including during shoulder rotation). */
export const POSE_QUALITY_ONLY = makeSession({
  id: 'pose', startedAt: at(1),
  shoulderPrompts: { BODY_OUT_OF_FRAME: 3, POSE_LOW_CONFIDENCE: 1 },
  exercises: {
    overhead_raise: { prompts: { BODY_OUT_OF_FRAME: 2 } },
    lateral_raise: { prompts: { BODY_OUT_OF_FRAME: 2, POSE_LOW_CONFIDENCE: 1 } },
    squat: { prompts: { POSE_LOW_CONFIDENCE: 1 } },
  },
})

/** 0915 shape: no rulesVersion, no mode, no topElbow (JSON-omitted); minElbow < 135 must not be used as a fallback. */
export const LEGACY_SESSION = makeSession({
  id: 'legacy', startedAt: at(1), mode: null, rulesVersion: null,
  exercises: { overhead_raise: { raw: () => ({ omitTopElbow: true, minElbowL: 130, minElbowR: 128 }) } },
})
export const LEGACY_FAST_SUSPECTED = makeSession({
  id: 'legacy-fast', startedAt: at(1), mode: null, rulesVersion: null,
  exercises: {
    overhead_raise: { reps: 1, raw: () => ({ omitTopElbow: true }) },
    lateral_raise: { reps: 1 }, step_jack: { reps: 2 }, squat: { reps: 1 }, knee_raise: { reps: 1 },
  },
})

/** Real fast mode: stored targets stay at the normal course values, each exercise ends after one rep (step jack: one cycle). */
export const FAST_SESSION = makeSession({
  id: 'fast', startedAt: at(1), mode: 'fast',
  exercises: {
    overhead_raise: { reps: 1 }, lateral_raise: { reps: 1 }, step_jack: { reps: 2 }, squat: { reps: 1 }, knee_raise: { reps: 1 },
  },
})

/** 3 reps carry topElbowL/R = 120; 3 reps have no topElbow but minElbow < 135. */
export const MISSING_TOP_ELBOW = makeSession({
  id: 'missing-elbow', startedAt: at(1),
  exercises: {
    overhead_raise: { raw: (index) => (index < 3 ? { topElbowL: 120, topElbowR: 120 } : { omitTopElbow: true, minElbowL: 100, minElbowR: 104 }) },
  },
})
export const LOW_MIN_ELBOW_TOP_OK = makeSession({
  id: 'low-min-top-ok', startedAt: at(1),
  exercises: { overhead_raise: { raw: () => ({ minElbowL: 90, minElbowR: 95, topElbowL: 150, topElbowR: 136 }) } },
})

// ── Supplementary fixtures ────────────────────────────────────────────────────────────────────────

/** First rep starts on the right (runtime expects left first); arms stay low on 6 of 12 reps. */
export const STEP_JACK_FIRST_REP_AND_SYNC_GATE = makeSession({
  id: 'step-gates', startedAt: at(1),
  exercises: {
    step_jack: {
      raw: (index) => ({
        side: index % 2 === 0 ? 'right' : 'left',
        wrongSideSequence: index === 0,
        ...(index % 2 === 1 ? { peakMeanShoulderAngle: 115 } : {}),
      }),
    },
  },
})

/** Sides L,R,L,L,R,L,R,R,L,R → non-overlapping pairs (0,1),(3,4),(5,6),(7,8); rep 2 and rep 9 stay unpaired. */
export const KNEE_RAISE_PAIRING_SIDES: Array<'left' | 'right'> = ['left', 'right', 'left', 'left', 'right', 'left', 'right', 'right', 'left', 'right']
export const KNEE_RAISE_PAIRING = makeSession({
  id: 'knee-pairing', startedAt: at(1),
  exercises: {
    knee_raise: {
      raw: (index) => ({ side: KNEE_RAISE_PAIRING_SIDES[index], wrongSideSequence: index > 0 && KNEE_RAISE_PAIRING_SIDES[index] === KNEE_RAISE_PAIRING_SIDES[index - 1] }),
    },
  },
})

/** Torso instability significant in lateral raise, step jack and squat; overhead elbows fail on both sides. */
export const THEME_MERGE_AND_CAPS = makeSession({
  id: 'theme', startedAt: at(1),
  exercises: {
    overhead_raise: { raw: firstN(4, { topElbowL: 120, topElbowR: 122 }) },
    lateral_raise: { raw: firstN(4, { maxTorsoLean: 13 }) },
    step_jack: { raw: firstN(5, { maxTorsoLean: 15 }) },
    squat: { raw: firstN(4, { maxTorsoLean: 13 }) },
  },
})

export const DEMO_SESSION = makeSession({ id: 'demo', startedAt: at(1), source: 'demo' })
export const STANDALONE_SESSION = makeSession({
  id: 'standalone', startedAt: at(1), exerciseOrder: ['lateral_raise', 'step_jack', 'squat', 'knee_raise'],
  include: ['lateral_raise', 'step_jack', 'squat', 'knee_raise'], courseStatus: 'completed',
})

export const DETERMINISM = {
  current: makeSession({ id: 'det', startedAt: at(3), exercises: { squat: { raw: firstN(3, { maxHipDrop: 0.2 }) } } }),
  history: [
    makeSession({ id: 'det-a', startedAt: at(2), exercises: { squat: { raw: firstN(4, { maxHipDrop: 0.2 }) } } }),
    makeSession({ id: 'det-b', startedAt: at(2) }),
    makeSession({ id: 'det-c', startedAt: at(1) }),
  ],
}
