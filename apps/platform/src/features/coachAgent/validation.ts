import { ERROR_CODES, EXERCISE_NAMES, STRATEGIES } from '../adaptiveTraining/protocol'
import type { ExerciseId } from '../exercises/types'
import type { RoutineId } from '../routines/types'
import type { RoutineFeedbackCode } from '../routines/followAlong/feedbackPolicy'
import type { TrainingRulesVersion } from '../training/types'
import { COACH_SCHEMA_VERSION } from './contracts'
import type {
  AgentToolResult, CoachEnvelope, CoachIntervention, CoachProvenance, CoachScore,
  CoachTime, DataProvenance, EpochTime, MotionEvent, MotionSubject, PlanCourseRef,
  RoutineCoachFeedback, ScoringEvidence, TrainingPlanDraft, TrainingSessionSummary,
  ValidationIssue, ValidationResult, WarmupCoachFeedback,
} from './contracts'

const ENVELOPE_KEYS = ['schemaVersion', 'id', 'recordedAt', 'provenance', 'confidence']
const ROUTINES = ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing'] as const satisfies readonly RoutineId[]
const ROUTINE_CORRECTIONS = ['BEHIND', 'AHEAD', 'MISMATCH', 'MISMATCH_ARMS', 'MISMATCH_TORSO', 'MISMATCH_LEGS'] as const satisfies readonly RoutineFeedbackCode[]
const TOOLS = ['read_session', 'read_history', 'read_scoring_evidence', 'draft_plan'] as const
const MAX_TIME = 8_640_000_000_000_000
type JsonObject = Record<string, unknown>
type IssueCode = ValidationIssue['code']

class InvalidValue {
  constructor(readonly issue: ValidationIssue) {}
}

function reject(path: string, message: string, code: IssueCode = 'INVALID_INPUT'): never {
  throw new InvalidValue({ path, code, message })
}

function validate<T>(parse: () => T): ValidationResult<T> {
  try {
    return { ok: true, value: parse() }
  } catch (error) {
    return { ok: false, errors: [error instanceof InvalidValue ? error.issue : {
      path: '$', code: 'INVALID_INPUT', message: 'Expected ordinary JSON data.',
    }] }
  }
}

function object(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reject(path, 'Expected an object.')
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) reject(path, 'Custom prototypes are not allowed.')
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      reject(path, 'Only enumerable JSON data properties are allowed.')
    }
  }
  return value as JsonObject
}

function fields(value: unknown, keys: readonly string[], path: string): JsonObject {
  const result = object(value, path)
  if (Object.keys(result).some(key => !keys.includes(key))) reject(path, 'Unknown fields are not allowed.', 'NOT_ALLOWED')
  for (const key of keys) if (!Object.hasOwn(result, key)) reject(`${path}.${key}`, 'Required field is missing.')
  return result
}

function list(value: unknown, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) reject(path, 'Expected a JSON array.')
  if (value.length > max) reject(path, 'Array exceeds the allowed capacity.', 'OUT_OF_RANGE')
  if (Reflect.ownKeys(value).length !== value.length + 1) reject(path, 'Sparse or extended arrays are not allowed.')
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(`${path}[${index}]`, 'Expected an array data item.')
  }
  return value as unknown[]
}

function text(value: unknown, path: string, max = 128): string {
  if (typeof value !== 'string' || !value.trim().length) reject(path, 'Expected nonempty text.')
  if (value.length > max) reject(path, 'Text exceeds the allowed capacity.', 'OUT_OF_RANGE')
  if (max === 128 && (value !== value.trim() || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) reject(path, 'Invalid identifier or version.')
  return value
}

function number(value: unknown, path: string, max = Number.MAX_SAFE_INTEGER, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) reject(path, 'Expected a finite number.')
  if (value < 0 || value > max || (integer && !Number.isSafeInteger(value))) reject(path, 'Number is outside the allowed range.', 'OUT_OF_RANGE')
  return value
}

function choice<const T extends readonly string[]>(value: unknown, options: T, path: string): T[number] {
  if (typeof value !== 'string' || !options.includes(value)) reject(path, 'Unknown enum value.')
  return value
}

function literal<T extends string | number | boolean>(value: unknown, expected: T, path: string): T {
  if (value !== expected) reject(path, 'Unexpected fixed value.', 'NOT_ALLOWED')
  return expected
}

function unique<T>(items: T[], key: (item: T) => string, path: string): T[] {
  const seen = new Set<string>()
  for (const item of items) {
    const id = key(item)
    if (seen.has(id)) reject(path, 'Duplicate identifiers are not allowed.')
    seen.add(id)
  }
  return items
}

function ids(value: unknown, path: string): string[] {
  return unique(list(value, 64, path).map((item, index) => text(item, `${path}[${index}]`)), item => item, path)
}

function epoch(value: unknown, path: string): EpochTime {
  const v = fields(value, ['domain', 'value'], path)
  literal(v.domain, 'epoch-ms', `${path}.domain`)
  return { domain: 'epoch-ms', value: number(v.value, `${path}.value`, MAX_TIME, true) }
}

function time(value: unknown, path: string): CoachTime {
  const v = object(value, path)
  if (v.domain === 'epoch-ms') return epoch(value, path)
  fields(value, ['domain', 'clockId', 'value'], path)
  return {
    domain: choice(v.domain, ['training-monotonic-ms', 'video-seconds'], `${path}.domain`),
    clockId: text(v.clockId, `${path}.clockId`), value: number(v.value, `${path}.value`),
  }
}

function sameClock(left: CoachTime, right: CoachTime, path: string): void {
  if (left.domain !== right.domain || (left.domain !== 'epoch-ms' && right.domain !== 'epoch-ms' && left.clockId !== right.clockId)) {
    reject(path, 'Times must use the same domain and clock identifier.', 'TIME_DOMAIN_CONFLICT')
  }
}

function provenance(value: unknown, path: string): CoachProvenance {
  const v = fields(value, ['source', 'mode', 'producer'], path)
  return {
    source: choice(v.source, ['live', 'demo', 'synthetic', 'unknown'], `${path}.source`),
    mode: choice(v.mode, ['normal', 'fast', 'unknown'], `${path}.mode`),
    producer: choice(v.producer, ['rules', 'repository', 'model', 'simulation'], `${path}.producer`),
  }
}

function dataProvenance(value: unknown, path: string): DataProvenance {
  const result = provenance(value, path)
  if (result.producer === 'model') reject(`${path}.producer`, 'A model cannot produce recorded observations or tool results.', 'NOT_ALLOWED')
  return { ...result, producer: result.producer }
}

function envelope(v: JsonObject, path: string): CoachEnvelope {
  if (v.schemaVersion !== COACH_SCHEMA_VERSION) reject(`${path}.schemaVersion`, 'Unsupported coach schema version.', 'UNSUPPORTED_VERSION')
  return {
    schemaVersion: COACH_SCHEMA_VERSION, id: text(v.id, `${path}.id`),
    recordedAt: epoch(v.recordedAt, `${path}.recordedAt`), provenance: provenance(v.provenance, `${path}.provenance`),
    confidence: v.confidence === null ? null : number(v.confidence, `${path}.confidence`, 1),
  }
}

function subject(value: unknown, path: string): MotionSubject {
  const v = fields(value, ['kind', 'id'], path)
  if (v.kind === 'exercise') {
    if (typeof v.id !== 'string' || !Object.hasOwn(EXERCISE_NAMES, v.id)) reject(`${path}.id`, 'Unknown exercise.')
    return { kind: 'exercise', id: v.id as ExerciseId }
  }
  literal(v.kind, 'routine', `${path}.kind`)
  return { kind: 'routine', id: choice(v.id, ROUTINES, `${path}.id`) }
}

function recordRef(value: unknown, sessionId: string, path: string): ScoringEvidence['recordRef'] {
  const v = fields(value, ['id', 'version'], path)
  const id = text(v.id, `${path}.id`)
  if (id !== sessionId) reject(`${path}.id`, 'The persisted record must identify this session.')
  return { id, version: text(v.version, `${path}.version`) }
}

function rulesVersion(value: unknown, path: string): TrainingRulesVersion | null {
  if (value === null) return null
  const v = fields(value, ['spec', 'threshold'], path)
  return { spec: text(v.spec, `${path}.spec`), threshold: text(v.threshold, `${path}.threshold`) }
}

function score(value: unknown, path: string): CoachScore {
  const v = fields(value, ['scoreKind', 'scale', 'status', 'value', 'scoringVersion', 'rulesVersion'], path)
  if (v.scoreKind === 'guidance') {
    literal(v.scale, 'none', `${path}.scale`)
    literal(v.status, 'guidance', `${path}.status`)
    if (v.value !== null || v.scoringVersion !== null || v.rulesVersion !== null) reject(path, 'Guidance cannot contain a numeric score or scoring versions.')
    return { scoreKind: 'guidance', scale: 'none', status: 'guidance', value: null, scoringVersion: null, rulesVersion: null }
  }
  const scoreKind = choice(v.scoreKind, ['warmup-standard', 'routine-technique', 'follow-along-similarity'], `${path}.scoreKind`)
  const status = choice(v.status, ['available', 'missing', 'insufficient', 'not_observable'], `${path}.status`)
  const scoringVersion = v.scoringVersion === null ? null : text(v.scoringVersion, `${path}.scoringVersion`)
  const rules = rulesVersion(v.rulesVersion, `${path}.rulesVersion`)
  const similarity = scoreKind === 'follow-along-similarity'
  literal(v.scale, similarity ? '0-1' : '0-100', `${path}.scale`)
  if (similarity && rules !== null) reject(`${path}.rulesVersion`, 'Similarity does not use standard-score rules.')
  if (status === 'available') {
    if (scoringVersion === null) reject(path, 'Available scores require a scoring version.')
    const measured = number(v.value, `${path}.value`, similarity ? 1 : 100)
    if (scoreKind === 'follow-along-similarity') return { scoreKind, scale: '0-1', status, value: measured, scoringVersion, rulesVersion: null }
    if (scoreKind === 'warmup-standard') {
      if (rules === null) reject(path, 'Available warm-up standard scores require rule versions.')
      return { scoreKind, scale: '0-100', status, value: measured, scoringVersion, rulesVersion: rules }
    }
    return { scoreKind, scale: '0-100', status, value: measured, scoringVersion, rulesVersion: rules }
  }
  if (v.value !== null) reject(`${path}.value`, 'Unavailable scores must remain null.')
  return similarity
    ? { scoreKind, scale: '0-1', status, value: null, scoringVersion, rulesVersion: null }
    : { scoreKind, scale: '0-100', status, value: null, scoringVersion, rulesVersion: rules }
}

function parseEvidence(value: unknown, path: string): ScoringEvidence {
  const v = fields(value, [...ENVELOPE_KEYS, 'sessionId', 'subject', 'recordRef', 'window', 'score', 'quality', 'criterionIds'], path)
  const base = envelope(v, path)
  const capture = dataProvenance(v.provenance, `${path}.provenance`)
  const sessionId = text(v.sessionId, `${path}.sessionId`)
  const observed = subject(v.subject, `${path}.subject`)
  const window = fields(v.window, ['start', 'end'], `${path}.window`)
  const start = time(window.start, `${path}.window.start`)
  const end = time(window.end, `${path}.window.end`)
  sameClock(start, end, `${path}.window`)
  if (end.value < start.value) reject(`${path}.window`, 'Window end precedes its start.', 'OUT_OF_RANGE')
  if (end.domain === 'epoch-ms' && end.value > base.recordedAt.value) reject(`${path}.window.end`, 'Evidence cannot observe an epoch time after it was recorded.', 'OUT_OF_RANGE')
  const measured = score(v.score, `${path}.score`)
  const q = fields(v.quality, ['sampleCount', 'observability', 'evidenceLevel'], `${path}.quality`)
  const quality: ScoringEvidence['quality'] = {
    sampleCount: number(q.sampleCount, `${path}.quality.sampleCount`, Number.MAX_SAFE_INTEGER, true),
    observability: choice(q.observability, ['OBSERVABLE', 'PROXY', 'NOT_OBSERVABLE'], `${path}.quality.observability`),
    evidenceLevel: q.evidenceLevel === null ? null : choice(q.evidenceLevel, ['A', 'B', 'C'], `${path}.quality.evidenceLevel`),
  }
  const criterionIds = ids(v.criterionIds, `${path}.criterionIds`)
  if ((observed.kind === 'exercise' && !['warmup-standard', 'guidance'].includes(measured.scoreKind))
    || (observed.kind === 'routine' && measured.scoreKind === 'warmup-standard')
    || (observed.kind === 'exercise' && observed.id === 'shoulder_rotation' && measured.scoreKind !== 'guidance')) {
    reject(`${path}.score.scoreKind`, 'Score kind does not belong to this motion subject.')
  }
  if (measured.status === 'available') {
    if (quality.sampleCount === 0 || quality.observability === 'NOT_OBSERVABLE') reject(`${path}.quality`, 'Numeric scores require observable samples.')
    if (measured.scoreKind !== 'follow-along-similarity' && criterionIds.length === 0) reject(`${path}.criterionIds`, 'Standard scores require criterion references.')
  }
  if (measured.status === 'not_observable' && quality.observability !== 'NOT_OBSERVABLE') reject(`${path}.quality.observability`, 'Unobservable status requires an unobservable measurement.')
  return {
    ...base, provenance: capture, sessionId, subject: observed,
    recordRef: recordRef(v.recordRef, sessionId, `${path}.recordRef`), window: { start, end },
    score: measured, quality, criterionIds,
  }
}

function course(value: unknown, path: string): PlanCourseRef {
  const v = fields(value, ['kind', 'id', 'version'], path)
  const version = text(v.version, `${path}.version`)
  if (v.kind === 'warmup-course') return { kind: 'warmup-course', id: text(v.id, `${path}.id`), version }
  literal(v.kind, 'routine-program', `${path}.kind`)
  return { kind: 'routine-program', id: choice(v.id, ROUTINES, `${path}.id`), version }
}

function courseKey(value: PlanCourseRef): string {
  return JSON.stringify([value.kind, value.id, value.version])
}

interface ParsedContext {
  evidence: Map<string, ScoringEvidence>
  catalogue: Set<string>
}

function context(value: unknown): ParsedContext {
  const v = fields(value, ['evidence', 'catalogue'], '$context')
  const evidence = unique(list(v.evidence, 256, '$context.evidence').map((item, index) => parseEvidence(item, `$context.evidence[${index}]`)), item => item.id, '$context.evidence')
  const catalogue = unique(list(v.catalogue, 256, '$context.catalogue').map((item, index) => course(item, `$context.catalogue[${index}]`)), courseKey, '$context.catalogue')
  return { evidence: new Map(evidence.map(item => [item.id, item])), catalogue: new Set(catalogue.map(courseKey)) }
}

function referenced(value: unknown, ctx: ParsedContext, owner: CoachProvenance, path: string, sessionId?: string): { refs: string[]; evidence: ScoringEvidence[] } {
  const refs = ids(value, path)
  const evidence = refs.map((id, index) => {
    const item = ctx.evidence.get(id)
    if (!item) reject(`${path}[${index}]`, 'Evidence reference cannot be resolved.', 'MISSING_EVIDENCE')
    if ((sessionId !== undefined && item.sessionId !== sessionId) || item.provenance.source !== owner.source || item.provenance.mode !== owner.mode) {
      reject(`${path}[${index}]`, 'Evidence session or capture provenance does not match.', 'NOT_ALLOWED')
    }
    return item
  })
  return { refs, evidence }
}

function parseMotion(value: unknown, ctx: ParsedContext, path: string): MotionEvent {
  const v = fields(value, [...ENVELOPE_KEYS, 'sessionId', 'subject', 'occurredAt', 'eventKind', 'repetitionIndex', 'feedback', 'evidenceRefs'], path)
  const base = envelope(v, path)
  const capture = dataProvenance(v.provenance, `${path}.provenance`)
  const sessionId = text(v.sessionId, `${path}.sessionId`)
  const observed = subject(v.subject, `${path}.subject`)
  const occurredAt = time(v.occurredAt, `${path}.occurredAt`)
  if (occurredAt.domain === 'epoch-ms' && occurredAt.value > base.recordedAt.value) reject(`${path}.occurredAt`, 'Event occurrence is after its recording time.', 'OUT_OF_RANGE')
  const eventKind = choice(v.eventKind, ['observation', 'repetition', 'feedback'], `${path}.eventKind`)
  let repetitionIndex: number | null = null
  let warmupFeedback: WarmupCoachFeedback | null = null
  let routineFeedback: RoutineCoachFeedback | null = null
  if (eventKind === 'repetition') {
    repetitionIndex = number(v.repetitionIndex, `${path}.repetitionIndex`, Number.MAX_SAFE_INTEGER, true)
    if (repetitionIndex < 1 || observed.kind !== 'exercise' || observed.id === 'shoulder_rotation') reject(`${path}.repetitionIndex`, 'Repetition requires a scored exercise and a positive index.')
  } else if (v.repetitionIndex !== null) reject(`${path}.repetitionIndex`, 'This event cannot contain a repetition index.')
  if (eventKind === 'feedback') {
    const f = fields(v.feedback, ['kind', 'code'], `${path}.feedback`)
    const kind = choice(f.kind, ['correction', 'recovery'], `${path}.feedback.kind`)
    if (observed.kind === 'exercise') {
      warmupFeedback = { kind, code: f.code === null ? null : choice(f.code, ERROR_CODES, `${path}.feedback.code`) }
    } else {
      routineFeedback = kind === 'recovery'
        ? { kind, code: literal(f.code, 'RECOVERED', `${path}.feedback.code`) }
        : { kind, code: choice(f.code, ROUTINE_CORRECTIONS, `${path}.feedback.code`) }
    }
  } else if (v.feedback !== null) reject(`${path}.feedback`, 'This event cannot contain feedback.')
  const linked = referenced(v.evidenceRefs, ctx, capture, `${path}.evidenceRefs`, sessionId)
  for (const item of linked.evidence) {
    if (item.recordedAt.value > base.recordedAt.value) reject(`${path}.evidenceRefs`, 'Referenced evidence was recorded after this event.', 'OUT_OF_RANGE')
    if (item.subject.kind !== observed.kind || item.subject.id !== observed.id) reject(`${path}.evidenceRefs`, 'Evidence belongs to a different motion subject.', 'NOT_ALLOWED')
    sameClock(occurredAt, item.window.start, `${path}.occurredAt`)
    if (occurredAt.value < item.window.start.value || occurredAt.value > item.window.end.value) reject(`${path}.occurredAt`, 'Event time is outside its evidence window.', 'OUT_OF_RANGE')
  }
  const result = { ...base, provenance: capture, sessionId, occurredAt, eventKind, repetitionIndex, evidenceRefs: linked.refs }
  return observed.kind === 'exercise'
    ? { ...result, subject: observed, feedback: warmupFeedback }
    : { ...result, subject: observed, feedback: routineFeedback }
}

function parseSummary(value: unknown, path: string): TrainingSessionSummary {
  const v = fields(value, [...ENVELOPE_KEYS, 'sessionId', 'recordRef', 'kind', 'startedAt', 'endedAt', 'status', 'activeDurationMs', 'completedReps', 'evidence'], path)
  const base = envelope(v, path)
  const capture = dataProvenance(v.provenance, `${path}.provenance`)
  const sessionId = text(v.sessionId, `${path}.sessionId`)
  const kind = choice(v.kind, ['warmup', 'routine'], `${path}.kind`)
  const startedAt = epoch(v.startedAt, `${path}.startedAt`)
  const endedAt = v.endedAt === null ? null : epoch(v.endedAt, `${path}.endedAt`)
  const status = choice(v.status, ['active', 'paused', 'completed', 'incomplete'], `${path}.status`)
  const finished = status === 'completed' || status === 'incomplete'
  if (finished !== (endedAt !== null)) reject(`${path}.endedAt`, 'Finalized sessions require an end; active sessions cannot have one.')
  if (startedAt.value > base.recordedAt.value || (endedAt !== null && (endedAt.value < startedAt.value || endedAt.value > base.recordedAt.value))) reject(path, 'Session epoch times are inconsistent.', 'OUT_OF_RANGE')
  const activeDurationMs = v.activeDurationMs === null ? null : number(v.activeDurationMs, `${path}.activeDurationMs`)
  if (activeDurationMs !== null && activeDurationMs > (endedAt ?? base.recordedAt).value - startedAt.value) reject(`${path}.activeDurationMs`, 'Active duration exceeds the session time span.', 'OUT_OF_RANGE')
  const completedReps = v.completedReps === null ? null : number(v.completedReps, `${path}.completedReps`, Number.MAX_SAFE_INTEGER, true)
  if (kind === 'routine' && completedReps !== null) reject(`${path}.completedReps`, 'Routine sessions do not supply warm-up repetition counts.')
  const evidence = unique(list(v.evidence, 256, `${path}.evidence`).map((item, index) => parseEvidence(item, `${path}.evidence[${index}]`)), item => item.id, `${path}.evidence`)
  for (const item of evidence) {
    if (item.sessionId !== sessionId || item.provenance.source !== capture.source || item.provenance.mode !== capture.mode || item.subject.kind !== (kind === 'warmup' ? 'exercise' : 'routine')) reject(`${path}.evidence`, 'Embedded evidence does not match the session kind or capture provenance.', 'NOT_ALLOWED')
    if (item.recordedAt.value > base.recordedAt.value) reject(`${path}.evidence`, 'Evidence was recorded after this summary.', 'OUT_OF_RANGE')
    if (item.window.start.domain === 'epoch-ms' && (item.window.start.value < startedAt.value || item.window.end.value > (endedAt ?? base.recordedAt).value)) reject(`${path}.evidence`, 'Epoch evidence lies outside this session.', 'OUT_OF_RANGE')
  }
  return { ...base, provenance: capture, sessionId, recordRef: recordRef(v.recordRef, sessionId, `${path}.recordRef`), kind, startedAt, endedAt, status, activeDurationMs, completedReps, evidence }
}

function parseIntervention(value: unknown, ctx: ParsedContext, path: string): CoachIntervention {
  const v = fields(value, [...ENVELOPE_KEYS, 'sessionId', 'status', 'confirmation', 'executed', 'strategy', 'explanation', 'evidenceRefs'], path)
  const base = envelope(v, path)
  const sessionId = text(v.sessionId, `${path}.sessionId`)
  return {
    ...base, sessionId, status: literal(v.status, 'proposed', `${path}.status`),
    confirmation: literal(v.confirmation, 'required', `${path}.confirmation`), executed: literal(v.executed, false, `${path}.executed`),
    strategy: choice(v.strategy, STRATEGIES, `${path}.strategy`), explanation: text(v.explanation, `${path}.explanation`, 2048),
    evidenceRefs: referenced(v.evidenceRefs, ctx, base.provenance, `${path}.evidenceRefs`, sessionId).refs,
  }
}

function parsePlan(value: unknown, ctx: ParsedContext, path: string): TrainingPlanDraft {
  const v = fields(value, [...ENVELOPE_KEYS, 'status', 'confirmation', 'executed', 'courses', 'rationale', 'evidenceRefs'], path)
  const base = envelope(v, path)
  const courses = unique(list(v.courses, 16, `${path}.courses`).map((item, index) => course(item, `${path}.courses[${index}]`)), courseKey, `${path}.courses`)
  if (!courses.length) reject(`${path}.courses`, 'A draft must reference at least one catalogue course.')
  for (const item of courses) if (!ctx.catalogue.has(courseKey(item))) reject(`${path}.courses`, 'Course version is not present in the supplied catalogue.', 'NOT_ALLOWED')
  return {
    ...base, status: literal(v.status, 'draft', `${path}.status`), confirmation: literal(v.confirmation, 'required', `${path}.confirmation`),
    executed: literal(v.executed, false, `${path}.executed`), courses, rationale: text(v.rationale, `${path}.rationale`, 2048),
    evidenceRefs: referenced(v.evidenceRefs, ctx, base.provenance, `${path}.evidenceRefs`).refs,
  }
}

function parseTool(value: unknown, invocation: unknown, ctx: ParsedContext, path: string): AgentToolResult {
  const call = fields(invocation, ['requestId', 'tool'], '$invocation')
  const expectedId = text(call.requestId, '$invocation.requestId')
  const expectedTool = choice(call.tool, TOOLS, '$invocation.tool')
  const v = fields(value, [...ENVELOPE_KEYS, 'requestId', 'ok', 'tool', 'data', 'error'], path)
  const base = { ...envelope(v, path), provenance: dataProvenance(v.provenance, `${path}.provenance`), requestId: text(v.requestId, `${path}.requestId`) }
  const tool = choice(v.tool, TOOLS, `${path}.tool`)
  if (base.requestId !== expectedId || tool !== expectedTool) reject(path, 'Tool result does not match the external invocation.', 'NOT_ALLOWED')
  if (v.ok === false) {
    if (v.data !== null) reject(`${path}.data`, 'Failed tool results cannot contain success data.')
    const e = fields(v.error, ['code', 'message', 'retryable'], `${path}.error`)
    if (typeof e.retryable !== 'boolean') reject(`${path}.error.retryable`, 'Expected a boolean.')
    return { ...base, ok: false, tool, data: null, error: {
      code: choice(e.code, ['NOT_FOUND', 'INSUFFICIENT_DATA', 'INVALID_INPUT', 'UNSUPPORTED_VERSION', 'PERMISSION_DENIED', 'NOT_ALLOWED', 'TIMEOUT', 'UNAVAILABLE'], `${path}.error.code`),
      message: text(e.message, `${path}.error.message`, 2048), retryable: e.retryable,
    } }
  }
  literal(v.ok, true, `${path}.ok`)
  if (v.error !== null) reject(`${path}.error`, 'Successful tool results must have a null error.')
  function payload<T extends CoachEnvelope>(item: T, itemPath: string): T {
    // An unknown wrapper is honest for mixed results. A known source/mode cannot relabel its data.
    if ((base.provenance.source !== 'unknown' && base.provenance.source !== item.provenance.source)
      || (base.provenance.mode !== 'unknown' && base.provenance.mode !== item.provenance.mode)) {
      reject(`${itemPath}.provenance`, 'Tool metadata must preserve the payload capture provenance.', 'NOT_ALLOWED')
    }
    if (item.recordedAt.value > base.recordedAt.value) reject(`${itemPath}.recordedAt`, 'Payload was recorded after this tool result.', 'OUT_OF_RANGE')
    return item
  }
  switch (tool) {
    case 'read_session': return { ...base, ok: true, tool, data: payload(parseSummary(v.data, `${path}.data`), `${path}.data`), error: null }
    case 'read_history': return { ...base, ok: true, tool, data: unique(list(v.data, 64, `${path}.data`).map((item, index) => payload(parseSummary(item, `${path}.data[${index}]`), `${path}.data[${index}]`)), item => item.sessionId, `${path}.data`), error: null }
    case 'read_scoring_evidence': return { ...base, ok: true, tool, data: unique(list(v.data, 256, `${path}.data`).map((item, index) => payload(parseEvidence(item, `${path}.data[${index}]`), `${path}.data[${index}]`)), item => item.id, `${path}.data`), error: null }
    case 'draft_plan': return { ...base, ok: true, tool, data: payload(parsePlan(v.data, ctx, `${path}.data`), `${path}.data`), error: null }
  }
}

export function validateScoringEvidence(value: unknown): ValidationResult<ScoringEvidence> {
  return validate(() => parseEvidence(value, '$'))
}

export function validateMotionEvent(value: unknown, snapshot: unknown): ValidationResult<MotionEvent> {
  return validate(() => parseMotion(value, context(snapshot), '$'))
}

export function validateTrainingSessionSummary(value: unknown): ValidationResult<TrainingSessionSummary> {
  return validate(() => parseSummary(value, '$'))
}

export function validateCoachIntervention(value: unknown, snapshot: unknown): ValidationResult<CoachIntervention> {
  return validate(() => parseIntervention(value, context(snapshot), '$'))
}

export function validateTrainingPlanDraft(value: unknown, snapshot: unknown): ValidationResult<TrainingPlanDraft> {
  return validate(() => parsePlan(value, context(snapshot), '$'))
}

export function validateAgentToolResult(value: unknown, invocation: unknown, snapshot: unknown): ValidationResult<AgentToolResult> {
  return validate(() => parseTool(value, invocation, context(snapshot), '$'))
}
