import { analyzeTraining, ANALYSIS_VERSION } from '../analysis'
import { assessRulesSupport } from '../analysis/rulesSupport'
import { ERROR_CODES } from '../adaptiveTraining/protocol'
import type { ExerciseId } from '../exercises/types'
import { criteriaFor, explainWarmUpExercise, SCORING_VERSION } from '../scoring'
import type { EvaluationCriterion } from '../scoring/types'
import type { ExerciseSessionResult, TrainingSessionState } from '../training/types'
import type { DataProvenance, ScoringEvidence, TrainingSessionSummary } from './contracts'
import { ReaderFault, type EvidenceDetail, type MappedSession } from './readerTypes'
import { validateTrainingSessionSummary } from './validation'

const EXERCISES = ['shoulder_rotation', 'overhead_raise', 'lateral_raise', 'step_jack', 'squat', 'knee_raise'] as const
const MAX_EPOCH = 8_640_000_000_000_000
type JsonRecord = Record<string, unknown>

function corrupt(path: string, message: string): never {
  throw new ReaderFault('CORRUPT', path, message)
}

function object(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) corrupt(path, 'Expected a stored JSON object.')
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) corrupt(path, 'Expected ordinary JSON data.')
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) corrupt(path, 'Stored accessors are not allowed.')
  }
  return value as JsonRecord
}

function text(value: unknown, path: string, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) corrupt(path, 'Expected bounded, nonempty text.')
  return value
}

function number(value: unknown, path: string, max = Number.MAX_SAFE_INTEGER, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isSafeInteger(value))) {
    corrupt(path, 'Expected a finite number in the allowed range.')
  }
  return value
}

function array(value: unknown, path: string, limit = 10_000): unknown[] {
  if (!Array.isArray(value) || value.length > limit) corrupt(path, 'Expected a bounded stored array.')
  return value as unknown[]
}

function choice<const T extends readonly string[]>(value: unknown, choices: T, path: string): T[number] {
  if (typeof value !== 'string' || !choices.includes(value)) corrupt(path, 'Unknown stored enum value.')
  return value
}

function optionalNumber(record: JsonRecord, key: string, path: string, max?: number, integer = false): void {
  if (record[key] !== undefined) number(record[key], `${path}.${key}`, max, integer)
}

function errorCodes(value: unknown, path: string): void {
  array(value, path).forEach((code, index) => choice(code, ERROR_CODES, `${path}[${index}]`))
}

function validateExercise(raw: unknown, path: string, start: number, end: number | undefined): void {
  const item = object(raw, path)
  const id = choice(item.exerciseId, EXERCISES, `${path}.exerciseId`)
  const startedAt = number(item.startedAt, `${path}.startedAt`, MAX_EPOCH, true)
  if (startedAt < start || (end !== undefined && startedAt > end)) corrupt(`${path}.startedAt`, 'Exercise time is outside its session.')
  if (item.endedAt !== undefined) {
    const endedAt = number(item.endedAt, `${path}.endedAt`, MAX_EPOCH, true)
    if (endedAt < startedAt || (end !== undefined && endedAt > end)) corrupt(`${path}.endedAt`, 'Exercise end is outside its session.')
  }
  number(item.overallScore, `${path}.overallScore`, 100)
  const averages = object(item.metricAverages, `${path}.metricAverages`)
  Object.entries(averages).forEach(([key, score]) => number(score, `${path}.metricAverages.${key}`, 100))
  errorCodes(item.topErrors, `${path}.topErrors`)
  if (item.evaluationMode !== undefined) {
    choice(item.evaluationMode, ['scored', 'guidance'], `${path}.evaluationMode`)
    if ((id === 'shoulder_rotation') !== (item.evaluationMode === 'guidance')) corrupt(`${path}.evaluationMode`, 'Guidance and scored exercise kinds cannot be exchanged.')
  }
  if (item.completed !== undefined && typeof item.completed !== 'boolean') corrupt(`${path}.completed`, 'Expected a completion flag.')
  if (item.targetType !== undefined) choice(item.targetType, ['duration', 'reps', 'cycles'], `${path}.targetType`)
  optionalNumber(item, 'targetValue', path)
  const seen = new Set<number>()
  array(item.repetitions, `${path}.repetitions`).forEach((rawRep, index) => {
    const repPath = `${path}.repetitions[${index}]`
    const result = object(rawRep, repPath)
    const rep = object(result.rep, `${repPath}.rep`)
    if (rep.exerciseId !== id || id === 'shoulder_rotation') corrupt(`${repPath}.rep.exerciseId`, 'Repetition belongs to another exercise or a guidance exercise.')
    const repIndex = number(rep.repIndex, `${repPath}.rep.repIndex`, Number.MAX_SAFE_INTEGER, true)
    if (repIndex < 1 || seen.has(repIndex)) corrupt(`${repPath}.rep.repIndex`, 'Repetition indices must be positive and unique.')
    seen.add(repIndex)
    const repStart = number(rep.startedAt, `${repPath}.rep.startedAt`)
    const repEnd = number(rep.completedAt, `${repPath}.rep.completedAt`)
    const duration = number(rep.durationMs, `${repPath}.rep.durationMs`)
    if (repEnd < repStart || duration <= 0 || duration > repEnd - repStart + 1) corrupt(`${repPath}.rep`, 'Repetition times are inconsistent on the training clock.')
    // All persisted per-repetition score fields remain bounded, including unused legacy aggregates.
    for (const [key, value] of Object.entries(rep)) {
      if (/Score$/.test(key)) number(value, `${repPath}.rep.${key}`, 100)
      else if (typeof value === 'number' && !Number.isFinite(value)) corrupt(`${repPath}.rep.${key}`, 'Expected finite raw observations; signed pose offsets are allowed.')
    }
    number(result.score, `${repPath}.score`, 100)
    const metrics = object(result.metrics, `${repPath}.metrics`)
    for (const [key, rawMetric] of Object.entries(metrics)) {
      const metricPath = `${repPath}.metrics.${key}`
      const metric = object(rawMetric, metricPath)
      if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) corrupt(`${metricPath}.value`, 'Expected a finite observed metric.')
      number(metric.score, `${metricPath}.score`, 100)
      if (typeof metric.valid !== 'boolean') corrupt(`${metricPath}.valid`, 'Expected metric validity.')
    }
    errorCodes(result.errors, `${repPath}.errors`)
    if (rep.errors !== undefined) errorCodes(rep.errors, `${repPath}.rep.errors`)
  })
  array(item.feedbackEvents, `${path}.feedbackEvents`).forEach((rawEvent, index) => {
    const eventPath = `${path}.feedbackEvents[${index}]`
    const event = object(rawEvent, eventPath)
    text(event.id, `${eventPath}.id`)
    number(event.timestamp, `${eventPath}.timestamp`)
    if (event.exerciseId !== id) corrupt(`${eventPath}.exerciseId`, 'Feedback belongs to another exercise.')
    choice(event.kind, ['correction', 'recovery'], `${eventPath}.kind`)
    if (event.code !== undefined) choice(event.code, ERROR_CODES, `${eventPath}.code`)
    if (event.side !== undefined) choice(event.side, ['left', 'right'], `${eventPath}.side`)
    text(event.message, `${eventPath}.message`, 2048)
    number(event.severity, `${eventPath}.severity`)
  })
  if (item.guidanceSummary !== undefined) {
    if (id !== 'shoulder_rotation') corrupt(`${path}.guidanceSummary`, 'Guidance samples belong only to guidance exercises.')
    const guidance = object(item.guidanceSummary, `${path}.guidanceSummary`)
    const count = number(guidance.samples, `${path}.guidanceSummary.samples`, Number.MAX_SAFE_INTEGER, true)
    const metrics = object(guidance.metrics, `${path}.guidanceSummary.metrics`)
    for (const [key, rawMetric] of Object.entries(metrics)) {
      const metric = object(rawMetric, `${path}.guidanceSummary.metrics.${key}`)
      if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) corrupt(`${path}.guidanceSummary.metrics.${key}.value`, 'Expected a finite guidance observation.')
      number(metric.score, `${path}.guidanceSummary.metrics.${key}.score`, 100)
    }
    const errors = object(guidance.errorFrames, `${path}.guidanceSummary.errorFrames`)
    for (const [code, frames] of Object.entries(errors)) {
      choice(code, ERROR_CODES, `${path}.guidanceSummary.errorFrames.${code}`)
      number(frames, `${path}.guidanceSummary.errorFrames.${code}`, count, true)
    }
  }
}

/** Validates a stored v2 record without the repository's default-live migration or mutation. */
export function validateWarmupRecord(raw: unknown): TrainingSessionState {
  const item = object(raw, '$')
  if (item.schemaVersion !== 2) throw new ReaderFault('UNSUPPORTED_VERSION', '$.schemaVersion', 'Only stored warm-up schema version 2 is supported.')
  text(item.id, '$.id')
  const startedAt = number(item.startedAt, '$.startedAt', MAX_EPOCH, true)
  const end = item.endedAt === undefined ? undefined : number(item.endedAt, '$.endedAt', MAX_EPOCH, true)
  if (end !== undefined && end < startedAt) corrupt('$.endedAt', 'Session ends before it starts.')
  const status = choice(item.status, ['ready', 'active', 'paused', 'completed'], '$.status')
  if ((status === 'completed') !== (end !== undefined)) corrupt('$.endedAt', 'Completed sessions require an end; unfinished sessions cannot have one.')
  if (item.source !== undefined) choice(item.source, ['live', 'demo', 'synthetic'], '$.source')
  if (item.mode !== undefined) choice(item.mode, ['normal', 'fast'], '$.mode')
  if (item.rulesVersion !== undefined) {
    const rules = object(item.rulesVersion, '$.rulesVersion')
    text(rules.spec, '$.rulesVersion.spec')
    text(rules.threshold, '$.rulesVersion.threshold')
  }
  for (const key of ['courseId', 'courseVersion']) if (item[key] !== undefined) text(item[key], `$.${key}`)
  if (item.courseStatus !== undefined) {
    const courseStatus = choice(item.courseStatus, ['in_progress', 'completed', 'incomplete'], '$.courseStatus')
    if ((status === 'completed') === (courseStatus === 'in_progress')) corrupt('$.courseStatus', 'Course and session finalization disagree.')
  }
  optionalNumber(item, 'courseOverallScore', '$', 100)
  optionalNumber(item, 'totalDurationMs', '$')
  if (end !== undefined && typeof item.totalDurationMs === 'number' && item.totalDurationMs > end - startedAt) corrupt('$.totalDurationMs', 'Duration exceeds the session time span.')
  optionalNumber(item, 'totalFeedbackCount', '$', Number.MAX_SAFE_INTEGER, true)
  if (item.topRecurringErrors !== undefined) errorCodes(item.topRecurringErrors, '$.topRecurringErrors')
  const order = array(item.exerciseOrder, '$.exerciseOrder', 6).map((id, index) => choice(id, EXERCISES, `$.exerciseOrder[${index}]`))
  if (!order.length || new Set(order).size !== order.length) corrupt('$.exerciseOrder', 'Exercise order must be nonempty and unique.')
  choice(item.activeExerciseId, EXERCISES, '$.activeExerciseId')
  if (!order.includes(item.activeExerciseId as ExerciseId)) corrupt('$.activeExerciseId', 'Active exercise is outside the session order.')
  const seen = new Set<string>()
  array(item.exercises, '$.exercises', 6).forEach((exercise, index) => {
    const path = `$.exercises[${index}]`
    validateExercise(exercise, path, startedAt, end)
    const id = (exercise as JsonRecord).exerciseId as ExerciseId
    if (seen.has(id) || !order.includes(id)) corrupt(`${path}.exerciseId`, 'Duplicate or out-of-order exercise reference.')
    seen.add(id)
  })
  if (!seen.has(item.activeExerciseId as string)) corrupt('$.activeExerciseId', 'Active exercise has no corresponding record.')
  // This view intentionally preserves missing source/mode; the mapping below represents them as unknown.
  return structuredClone(raw) as TrainingSessionState
}

function criterionProjection(criterion: EvaluationCriterion): object {
  return {
    id: criterion.id, phase: criterion.phase, sourceType: criterion.sourceType, sourceId: criterion.sourceId,
    sourceTitle: criterion.sourceTitle, additionalSourceIds: [...criterion.additionalSourceIds],
    evidenceLevel: criterion.evidenceLevel, observable: criterion.observable, scoring: criterion.scoring,
    measurement: structuredClone(criterion.measurement), target: structuredClone(criterion.target),
    thresholdSource: criterion.thresholdSource, thresholdBasis: criterion.thresholdBasis,
    limitations: [...criterion.limitations],
  }
}

function evidenceId(sessionId: string, exerciseId: ExerciseId): string {
  // A bounded local reference, not a signature or authenticity proof. Include the full original ID when it fits.
  const full = `warmup:${sessionId}:${exerciseId}`
  if (full.length <= 128) return full
  let first = 2166136261
  let second = 5381
  for (let index = 0; index < sessionId.length; index += 1) {
    first = Math.imul(first ^ sessionId.charCodeAt(index), 16777619)
    second = Math.imul(second, 33) ^ sessionId.charCodeAt(index)
  }
  return `warmup:${sessionId.slice(0,64)}:${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}:${exerciseId}`
}

function windowFor(exercise: ExerciseSessionResult, recordedAt: number, clockId: string): ScoringEvidence['window'] {
  if (exercise.repetitions.length) return {
    start: { domain: 'training-monotonic-ms', clockId, value: Math.min(...exercise.repetitions.map(item => item.rep.startedAt)) },
    end: { domain: 'training-monotonic-ms', clockId, value: Math.max(...exercise.repetitions.map(item => item.rep.completedAt)) },
  }
  return { start: { domain: 'epoch-ms', value: exercise.startedAt }, end: { domain: 'epoch-ms', value: exercise.endedAt ?? recordedAt } }
}

/** Maps verified persisted facts only; no videos, pose arrays, model claims, or stored aggregate scores escape. */
export function mapWarmupSession(raw: unknown, recordedAt: number): MappedSession {
  const session = validateWarmupRecord(raw)
  number(recordedAt, '$recordedAt', MAX_EPOCH, true)
  if (session.startedAt > recordedAt || (session.endedAt !== undefined && session.endedAt > recordedAt)
    || session.exercises.some(exercise => exercise.startedAt > recordedAt || (exercise.endedAt !== undefined && exercise.endedAt > recordedAt))) {
    corrupt('$recordedAt', 'The read time precedes stored session observations.')
  }
  const provenance: DataProvenance = { source: session.source ?? 'unknown', mode: session.mode ?? 'unknown', producer: 'repository' }
  const supported = assessRulesSupport(session) === 'SUPPORTED'
  const analysis = supported ? analyzeTraining(session, []) : null
  const limitations: string[] = []
  if (provenance.source === 'unknown') limitations.push('SOURCE_UNKNOWN: the stored record has no capture source; it is not verified as live training.')
  if (provenance.mode === 'unknown') limitations.push('MODE_UNKNOWN: the stored record has no training mode.')
  if (provenance.source === 'demo' || provenance.source === 'synthetic') limitations.push('NON_LIVE_SOURCE: demonstration and synthetic records cannot establish human training progress.')
  if (!supported) limitations.push(session.rulesVersion
    ? 'RULES_UNSUPPORTED: the original rule version has no supported explanation adapter; numeric evidence is unavailable.'
    : 'RULES_UNVERSIONED: the original rule version is missing; current scoring rules are not substituted.')
  const details: EvidenceDetail[] = []
  const evidence: ScoringEvidence[] = session.exercises.map((exercise, index) => {
    const guidance = exercise.exerciseId === 'shoulder_rotation'
    const explanation = supported ? explainWarmUpExercise(session, exercise.exerciseId) : null
    const facts = analysis?.exercises.find(item => item.exerciseId === exercise.exerciseId)
    const criteria = supported ? criteriaFor('warm-up', exercise.exerciseId) : []
    const measured = criteria.filter(item => item.scoring !== 'REFERENCE_ONLY')
    const scored = measured.filter(item => item.scoring === 'SCORED')
    const selected = guidance ? measured : scored
    const samples = guidance ? exercise.guidanceSummary?.samples ?? 0 : explanation?.analyzedReps ?? 0
    const value = explanation?.score ?? null
    const id = evidenceId(session.id, exercise.exerciseId)
    const clockId = session.id.length <= 121 ? `warmup:${session.id}` : evidenceId(session.id, 'shoulder_rotation')
    const window = windowFor(exercise, session.endedAt ?? recordedAt, clockId)
    const item: ScoringEvidence = {
      schemaVersion: 1, id, recordedAt: { domain: 'epoch-ms', value: recordedAt }, provenance: { ...provenance }, confidence: null,
      sessionId: session.id, subject: { kind: 'exercise', id: exercise.exerciseId }, recordRef: { id: session.id, version: String(session.schemaVersion) }, window,
      score: guidance
        ? { scoreKind: 'guidance', scale: 'none', status: 'guidance', value: null, scoringVersion: null, rulesVersion: null }
        : value !== null && supported && session.rulesVersion
          ? { scoreKind: 'warmup-standard', scale: '0-100', status: 'available', value, scoringVersion: SCORING_VERSION, rulesVersion: { ...session.rulesVersion } }
          : { scoreKind: 'warmup-standard', scale: '0-100', status: supported ? 'insufficient' : 'missing', value: null, scoringVersion: supported ? SCORING_VERSION : null, rulesVersion: session.rulesVersion ? { ...session.rulesVersion } : null },
      quality: {
        sampleCount: samples,
        observability: selected.some(criterion => criterion.observable === 'PROXY') ? 'PROXY' : selected.length ? 'OBSERVABLE' : 'NOT_OBSERVABLE',
        evidenceLevel: selected.some(criterion => criterion.evidenceLevel === 'C') ? 'C' : selected.some(criterion => criterion.evidenceLevel === 'B') ? 'B' : selected.length ? 'A' : null,
      },
      criterionIds: selected.map(criterion => criterion.id),
    }
    if (!guidance && item.score.status !== 'available') limitations.push(`INSUFFICIENT_SCORING_EVIDENCE:${exercise.exerciseId}`)
    if (guidance && samples === 0) limitations.push(`INSUFFICIENT_GUIDANCE_SAMPLES:${exercise.exerciseId}`)
    details.push({
      evidenceId: id,
      recordPaths: [`$.exercises[${index}].${guidance ? 'guidanceSummary' : 'repetitions'}`],
      explanation: {
        analysisVersion: supported ? ANALYSIS_VERSION : null, scoringVersion: supported ? SCORING_VERSION : null,
        exerciseId: exercise.exerciseId, evaluationMode: guidance ? 'guidance' : 'scored',
        originalStartedAt: exercise.startedAt, originalEndedAt: exercise.endedAt ?? null,
        activeDurationMs: facts?.activeDurationMs ?? null,
        sampleCounts: facts ? { ...facts.reps } : { recorded: exercise.repetitions.length, analyzed: samples },
        criteria: criteria.map(criterionProjection),
        components: explanation?.components.map(component => ({ criterionId: component.criterion.id, score: component.score, weight: component.weight, evaluatedReps: component.evaluatedReps, fullMarkReps: component.fullMarkReps, worst: component.worst.map(rep => ({ ...rep })) })) ?? [],
        advisory: explanation?.advisory.map(check => ({ criterionId: check.criterion.id, evaluatedReps: check.evaluatedReps, affectedReps: check.affectedReps, worst: check.worst.map(rep => ({ ...rep })) })) ?? [],
        guidance: explanation?.guidance.map(check => ({ criterionId: check.criterion.id, value: check.value, valueText: check.valueText, meets: check.meets })) ?? [],
        tempo: facts ? { ...facts.tempo, bandMs: [...facts.tempo.bandMs] } : null,
        thresholdsCalibrated: supported ? true : null,
      },
    })
    return item
  })
  const summary: TrainingSessionSummary = {
    schemaVersion: 1, id: session.id, recordedAt: { domain: 'epoch-ms', value: recordedAt }, provenance, confidence: null,
    sessionId: session.id, recordRef: { id: session.id, version: String(session.schemaVersion) }, kind: 'warmup',
    startedAt: { domain: 'epoch-ms', value: session.startedAt }, endedAt: session.endedAt === undefined ? null : { domain: 'epoch-ms', value: session.endedAt },
    status: session.status === 'completed' ? session.courseStatus === 'incomplete' ? 'incomplete' : 'completed' : session.status === 'paused' ? 'paused' : 'active',
    // The stored total is wall duration and cannot be relabelled as active duration.
    activeDurationMs: null, completedReps: session.exercises.reduce((count, exercise) => count + exercise.repetitions.length, 0), evidence,
  }
  const validated = validateTrainingSessionSummary(summary)
  if (!validated.ok) throw new ReaderFault('CORRUPT', validated.errors[0].path, validated.errors[0].message)
  return {
    summary: validated.value, details, limitations,
    metadata: {
      storedSchemaVersion: session.schemaVersion, originalStatus: session.status,
      courseId: session.courseId ?? null, courseVersion: session.courseVersion ?? null, courseStatus: session.courseStatus ?? null,
      rulesVersion: session.rulesVersion ? { ...session.rulesVersion } : null,
      analysisVersion: supported ? ANALYSIS_VERSION : null, scoringVersion: supported ? SCORING_VERSION : null,
      exerciseOrder: [...session.exerciseOrder], activeExerciseId: session.activeExerciseId,
      wallDurationMs: session.totalDurationMs ?? null,
    },
  }
}
