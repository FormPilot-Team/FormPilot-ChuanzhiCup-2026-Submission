import { classifyRepetition } from '../../analysis/repetitionValidity'
import { ANALYSIS_CONFIG_V1 } from '../../analysis/config'
import type { ExerciseId, MotionErrorCode, RepSummary } from '../../exercises/types'
import { REPORT_EXERCISE_PRESENTATION } from '../../report/presentation'
import type { ExerciseSessionResult, RepetitionResult, TrainingSessionState } from '../../training/types'
import { criteriaFor } from '../criteria'
import { getScoringSource } from '../sources'
import { meetsTarget, targetScore, targetText, withUnit } from '../targetScore'
import type { EvaluationCriterion } from '../types'

/**
 * 热身训练评分说明 (Scoring v2). Decomposes the exercise score the report shows — analysis-v1's mean of the valid
 * repetitions' scores — into the engineering-v1 components it is made of, names the criterion behind each, and
 * quotes rep-level evidence for the biggest deductions. Reads saved sessions only; no score is recomputed or changed.
 */
export interface RepEvidence {
  /** 1-based position among the recorded repetitions. */
  repNumber: number
  /** Seconds since the exercise's first repetition started. */
  atSeconds: number
  observed: number | null
  observedText: string
  targetText: string
  phase: string | null
  score: number
}

export interface WarmUpComponent {
  criterion: EvaluationCriterion
  weight: number
  /** Mean component score over the analysed repetitions (0–100). */
  score: number | null
  /** weight × (100 − score): points of the exercise score this component cost. */
  lostPoints: number | null
  evaluatedReps: number
  fullMarkReps: number
  /** Lowest-scoring repetitions for this component (up to two), only those below full marks. */
  worst: RepEvidence[]
}

export interface WarmUpAdvisoryCheck {
  criterion: EvaluationCriterion
  evaluatedReps: number
  affectedReps: number
  worst: RepEvidence[]
}

export interface WarmUpGuidanceCheck {
  criterion: EvaluationCriterion
  value: number | null
  valueText: string | null
  meets: boolean | null
}

export interface WarmUpExerciseExplanation {
  exerciseId: ExerciseId
  name: string
  evaluationMode: 'scored' | 'guidance'
  /** The score the report shows (analysis-v1): mean of the analysed repetitions, null below three. */
  score: number | null
  /** Σ weight × component score, before per-rep rounding; equals `score` within rounding. */
  weightedSum: number | null
  analyzedReps: number
  components: WarmUpComponent[]
  advisory: WarmUpAdvisoryCheck[]
  guidance: WarmUpGuidanceCheck[]
  guidanceSamples: number
  /** Biggest deductions first (lostPoints ≥ 2), at most two. */
  deductions: WarmUpComponent[]
  /** Requirements shown for reference: not observable, or not automated yet. */
  references: EvaluationCriterion[]
  /** Titles of the official sources behind this exercise's requirements (not its numbers). */
  officialSources: string[]
}

export interface WarmUpExplanation {
  exercises: WarmUpExerciseExplanation[]
  /** Always true for warm-up: every number is FormPilot-calibrated (engineering-v1), none is an official value. */
  thresholdsCalibrated: true
}

type Observer = (rep: RepSummary, result: RepetitionResult) => number | null

function field(rep: RepSummary, key: string): number | null {
  const value = (rep as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function metricValue(result: RepetitionResult, key: string): number | null {
  const value = result.metrics?.[key]?.value
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const mean2 = (a: number | null, b: number | null) => (a === null || b === null ? null : (a + b) / 2)
const min2 = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.min(a, b))
const seconds = (rep: RepSummary) => (Number.isFinite(rep.durationMs) ? rep.durationMs / 1000 : null)

/** The raw value each criterion stands for, read from the saved repetition (the value its score used). */
const OBSERVERS: Readonly<Record<string, Observer>> = {
  'wu.overhead_raise.arm_height': (rep) => mean2(field(rep, 'peakShoulderL'), field(rep, 'peakShoulderR')),
  'wu.overhead_raise.elbow': (rep) => min2(field(rep, 'minElbowL'), field(rep, 'minElbowR')),
  'wu.overhead_raise.sync': (rep) => field(rep, 'maxSymmetryDiff'),
  'wu.overhead_raise.torso': (rep) => field(rep, 'maxTorsoLean'),
  'wu.overhead_raise.tempo': seconds,
  'wu.lateral_raise.arm_height': (rep) => mean2(field(rep, 'peakShoulderL'), field(rep, 'peakShoulderR')),
  'wu.lateral_raise.symmetry': (rep) => field(rep, 'maxSymmetryDiff'),
  'wu.lateral_raise.torso': (rep) => field(rep, 'maxTorsoLean'),
  'wu.lateral_raise.tempo': seconds,
  'wu.lateral_raise.completion': () => 1,
  'wu.lateral_raise.elbow': (rep) => min2(field(rep, 'minElbowL'), field(rep, 'minElbowR')),
  'wu.step_jack.coordination': (rep) => field(rep, 'syncGapMs'),
  'wu.step_jack.amplitude': (rep) => field(rep, 'peakOpenRatio'),
  'wu.step_jack.tempo': seconds,
  'wu.step_jack.stability': (rep) => field(rep, 'maxTorsoLean'),
  'wu.step_jack.completion': (rep) => ((rep as unknown as { incompleteReturn?: boolean }).incompleteReturn ? 0 : 1),
  'wu.step_jack.alternation': (rep) => ((rep as unknown as { wrongSideSequence?: boolean }).wrongSideSequence ? 0 : 1),
  'wu.squat.depth': (rep) => field(rep, 'maxHipDrop'),
  'wu.squat.knee_track': (rep) => field(rep, 'minKneeSpreadRatio'),
  'wu.squat.balance': (rep) => field(rep, 'maxKneeHeightDiff'),
  'wu.squat.completion': () => 1,
  'wu.squat.tempo': seconds,
  'wu.knee_raise.height': (rep) => field(rep, 'peakKneeHeight'),
  'wu.knee_raise.stability': (rep) => field(rep, 'hipShiftMax'),
  'wu.knee_raise.alternation': (rep) => ((rep as unknown as { wrongSideSequence?: boolean }).wrongSideSequence ? 0 : 1),
  'wu.knee_raise.symmetry': (_rep, result) => metricValue(result, 'symmetry'),
  'wu.knee_raise.tempo': seconds,
}

interface AnalyzedRep {
  index: number
  result: RepetitionResult
}

function analyzedReps(record: ExerciseSessionResult): AnalyzedRep[] {
  const repetitions = Array.isArray(record.repetitions) ? record.repetitions : []
  return repetitions.flatMap((result, index) => (classifyRepetition(result, record) === 'INVALID' ? [] : [{ index, result }]))
}

function evidence(criterion: EvaluationCriterion, item: AnalyzedRep, firstStart: number, score: number): RepEvidence {
  const observer = OBSERVERS[criterion.id]
  const observed = observer ? observer(item.result.rep, item.result) : null
  const unit = criterion.target?.unit ?? ''
  const binary = criterion.target?.kind === 'atLeast' && criterion.target.value === 1 && criterion.target.zeroAt === 0
  return {
    repNumber: item.index + 1,
    atSeconds: Math.max(0, Math.round((item.result.rep.startedAt - firstStart) / 100) / 10),
    observed,
    observedText: observed === null ? '—' : binary ? (observed >= 1 ? '是' : '否') : withUnit(observed, unit),
    targetText: criterion.target ? (binary ? '是' : targetText(criterion.target)) : '—',
    phase: criterion.phase,
    score: Math.round(score),
  }
}

function componentOf(criterion: EvaluationCriterion, analyzed: readonly AnalyzedRep[], firstStart: number): WarmUpComponent | null {
  if (criterion.measurement.kind !== 'rep-component') return null
  const key = criterion.measurement.metricKey
  const scored = analyzed.flatMap((item) => {
    const value = item.result.metrics?.[key]?.score
    return typeof value === 'number' && Number.isFinite(value) ? [{ item, score: value }] : []
  })
  const score = scored.length ? scored.reduce((sum, entry) => sum + entry.score, 0) / scored.length : null
  const weight = criterion.measurement.componentWeight
  return {
    criterion,
    weight,
    score: score === null ? null : Math.round(score),
    lostPoints: score === null ? null : Math.round(weight * (100 - score) * 10) / 10,
    evaluatedReps: scored.length,
    fullMarkReps: scored.filter((entry) => entry.score >= 100).length,
    worst: scored
      .filter((entry) => entry.score < 100)
      .sort((left, right) => left.score - right.score || left.item.index - right.item.index)
      .slice(0, 2)
      .map((entry) => evidence(criterion, entry.item, firstStart, entry.score)),
  }
}

function advisoryOf(criterion: EvaluationCriterion, analyzed: readonly AnalyzedRep[], firstStart: number): WarmUpAdvisoryCheck | null {
  if (criterion.measurement.kind !== 'rep-check') return null
  const observer = OBSERVERS[criterion.id]
  const target = criterion.target
  // The first knee-raise / step-jack rep cannot express alternation (see analysis-v1 issue evidence).
  const evaluable = criterion.id.endsWith('.alternation') ? analyzed.filter((item) => item.index > 0) : analyzed
  const observed = evaluable.flatMap((item) => {
    const value = observer ? observer(item.result.rep, item.result) : null
    if (value === null) return []
    const affected = target ? !meetsTarget(value, target) : value < 1
    return [{ item, value, affected, score: target ? targetScore(value, target) : affected ? 0 : 100 }]
  })
  return {
    criterion,
    evaluatedReps: observed.length,
    affectedReps: observed.filter((entry) => entry.affected).length,
    worst: observed.filter((entry) => entry.affected).sort((left, right) => left.score - right.score).slice(0, 2)
      .map((entry) => evidence(criterion, entry.item, firstStart, entry.score)),
  }
}

function guidanceOf(criterion: EvaluationCriterion, record: ExerciseSessionResult | undefined): WarmUpGuidanceCheck | null {
  if (criterion.measurement.kind !== 'guidance-metric') return null
  const summary = record?.guidanceSummary?.metrics?.[criterion.measurement.metricKey]
  const value = summary && Number.isFinite(summary.value) ? summary.value : null
  return {
    criterion,
    value,
    valueText: value === null || !criterion.target ? null : withUnit(value, criterion.target.unit),
    meets: value === null || !criterion.target ? null : meetsTarget(value, criterion.target),
  }
}

function officialSources(criteria: readonly EvaluationCriterion[]): string[] {
  const ids = new Set<string>()
  for (const criterion of criteria) {
    if (criterion.sourceType !== 'FORMPILOT_CALIBRATED') ids.add(criterion.sourceId)
  }
  return [...ids].map((id) => getScoringSource(id).title)
}

export function explainWarmUpExercise(session: TrainingSessionState, exerciseId: ExerciseId): WarmUpExerciseExplanation {
  const record = session.exercises.find((item) => item.exerciseId === exerciseId)
  const criteria = criteriaFor('warm-up', exerciseId)
  const guidanceMode = exerciseId === 'shoulder_rotation' || record?.evaluationMode === 'guidance'
  const analyzed = record && !guidanceMode ? analyzedReps(record) : []
  const firstStart = analyzed.length ? Math.min(...analyzed.map((item) => item.result.rep.startedAt)) : 0
  const components = criteria.map((criterion) => componentOf(criterion, analyzed, firstStart)).filter((item): item is WarmUpComponent => item !== null)
  const scores = analyzed.map((item) => item.result.score)
  const score = scores.length >= ANALYSIS_CONFIG_V1.exerciseScore.minAnalyzedReps
    ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
    : null
  const weightedParts = components.filter((item) => item.score !== null)
  const weightedSum = score !== null && weightedParts.length === components.length && components.length
    ? Math.round(weightedParts.reduce((sum, item) => sum + item.weight * (item.score as number), 0))
    : null
  return {
    exerciseId,
    name: REPORT_EXERCISE_PRESENTATION[exerciseId].name,
    evaluationMode: guidanceMode ? 'guidance' : 'scored',
    score: guidanceMode ? null : score,
    weightedSum,
    analyzedReps: analyzed.length,
    components,
    advisory: criteria.map((criterion) => advisoryOf(criterion, analyzed, firstStart)).filter((item): item is WarmUpAdvisoryCheck => item !== null),
    guidance: criteria.map((criterion) => guidanceOf(criterion, record)).filter((item): item is WarmUpGuidanceCheck => item !== null),
    guidanceSamples: record?.guidanceSummary?.samples ?? 0,
    deductions: score === null ? [] : components
      .filter((item) => item.lostPoints !== null && item.lostPoints >= 2)
      .sort((left, right) => (right.lostPoints as number) - (left.lostPoints as number))
      .slice(0, 2),
    references: criteria.filter((criterion) => criterion.scoring === 'REFERENCE_ONLY'),
    officialSources: officialSources(criteria),
  }
}

/** “第 4 次（开始后 12.3 秒）最小肘角（全程）137°，满分要求 ≥ 150°”. */
export function repEvidenceSentence(criterion: EvaluationCriterion, item: RepEvidence): string {
  const metric = criterion.metric?.label ?? criterion.name
  return `第 ${item.repNumber} 次（开始后 ${item.atSeconds} 秒）${metric} ${item.observedText}，满分要求 ${item.targetText}`
}

/** Explanations for the exercises of a session, in its own order. */
export function explainWarmUpSession(session: TrainingSessionState): WarmUpExplanation {
  const order = session.exerciseOrder.filter((id, index, all) => all.indexOf(id) === index)
  return { exercises: order.map((exerciseId) => explainWarmUpExercise(session, exerciseId)), thresholdsCalibrated: true }
}

/** The warm-up criterion behind a live correction code of an exercise, when one exists. */
export function warmUpCriterionForCode(exerciseId: ExerciseId, code: MotionErrorCode | string): EvaluationCriterion | undefined {
  const byCode: Partial<Record<string, string>> = CODE_CRITERION[exerciseId] ?? {}
  const id = byCode[code]
  return id ? criteriaFor('warm-up', exerciseId).find((criterion) => criterion.id === id) : undefined
}

const CODE_CRITERION: Partial<Record<ExerciseId, Partial<Record<string, string>>>> = {
  shoulder_rotation: { MOTION_TOO_SMALL: 'wu.shoulder_rotation.range', ARMS_UNSYNCED: 'wu.shoulder_rotation.coordination', MOTION_PAUSED: 'wu.shoulder_rotation.continuity', TORSO_LEAN: 'wu.shoulder_rotation.torso' },
  overhead_raise: { ARMS_TOO_LOW: 'wu.overhead_raise.arm_height', ELBOW_TOO_BENT_L: 'wu.overhead_raise.elbow', ELBOW_TOO_BENT_R: 'wu.overhead_raise.elbow', ASYMMETRY: 'wu.overhead_raise.sync', TORSO_LEAN: 'wu.overhead_raise.torso', TOO_FAST: 'wu.overhead_raise.tempo' },
  lateral_raise: { ARM_TOO_LOW_L: 'wu.lateral_raise.arm_height', ARM_TOO_LOW_R: 'wu.lateral_raise.arm_height', ASYMMETRY: 'wu.lateral_raise.symmetry', ELBOW_TOO_BENT_L: 'wu.lateral_raise.elbow', ELBOW_TOO_BENT_R: 'wu.lateral_raise.elbow', TORSO_LEAN: 'wu.lateral_raise.torso', TOO_FAST: 'wu.lateral_raise.tempo', INCOMPLETE_REP: 'wu.lateral_raise.completion' },
  step_jack: { STEP_TOO_SMALL: 'wu.step_jack.amplitude', ARM_TOO_LOW: 'wu.step_jack.amplitude', ARM_LEG_UNSYNCED: 'wu.step_jack.coordination', BODY_SWAY: 'wu.step_jack.stability', TOO_FAST: 'wu.step_jack.tempo', INCOMPLETE_RETURN: 'wu.step_jack.completion', WRONG_SIDE_SEQUENCE: 'wu.step_jack.alternation' },
  squat: { DEPTH_INSUFFICIENT: 'wu.squat.depth', KNEE_VALGUS: 'wu.squat.knee_track', LEFT_RIGHT_ASYMMETRY: 'wu.squat.balance', TORSO_LATERAL_LEAN: 'wu.squat.balance', TOO_FAST: 'wu.squat.tempo', INCOMPLETE_REP: 'wu.squat.completion' },
  knee_raise: { KNEE_TOO_LOW_L: 'wu.knee_raise.height', KNEE_TOO_LOW_R: 'wu.knee_raise.height', BODY_SWAY: 'wu.knee_raise.stability', WRONG_SIDE_SEQUENCE: 'wu.knee_raise.alternation', LEFT_RIGHT_HEIGHT_GAP: 'wu.knee_raise.symmetry', TOO_FAST: 'wu.knee_raise.tempo' },
}
