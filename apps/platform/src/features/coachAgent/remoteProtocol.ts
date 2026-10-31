import type { MotionSubject, ScoringEvidence } from './contracts'
import type { DispatcherTool } from './dispatchTypes'
import { freezeCoachValue, parseProviderStep, type AnswerMode, type ProviderStep } from './provider.ts'
import { parseToolIntent, plainFields } from './toolQuery.ts'

/** Bounds apply before JSON parsing, independently at both HTTP boundaries. */
export const REMOTE_CONTEXT_MAX_BYTES = 32_768
export const REMOTE_STEP_MAX_BYTES = 16_384
export const REMOTE_PROBLEM_CODES = ['NOT_FOUND', 'UNAVAILABLE', 'CORRUPT', 'UNSUPPORTED_VERSION',
  'INSUFFICIENT_DATA', 'INVALID_INPUT', 'PERMISSION_DENIED', 'NOT_ALLOWED', 'CANCELLED',
  'TIMEOUT', 'DUPLICATE_CALL', 'BUDGET_EXCEEDED'] as const
export type RemoteProblemCode = typeof REMOTE_PROBLEM_CODES[number]

export interface RemoteCoachEvidence {
  evidenceId: string
  sessionId: string
  subject: MotionSubject
  scoreKind: ScoringEvidence['score']['scoreKind']
}
export interface RemoteCoachObservation {
  requestId: string
  tool: DispatcherTool | null
  ok: boolean
  problemCode: RemoteProblemCode | null
  comparisonGate: 'FULL' | 'PARTIAL' | 'NONE' | null
  evidence: RemoteCoachEvidence[]
}
/** Anonymous planning data only: no question text, score values, provenance or local IDs. */
export interface RemoteCoachContext {
  mode: AnswerMode
  remainingCalls: number
  scope: { warmupSessionId?: string; routineSessionId?: string; historyLimit: number }
  observations: RemoteCoachObservation[]
}

function fields(value: unknown, keys: string[], required = keys): Record<string, unknown> {
  const result = plainFields(value, keys, required)
  if (Reflect.ownKeys(value as object).some(key => !Object.getOwnPropertyDescriptor(value, key)?.enumerable)) throw new Error('INVALID_REMOTE_CONTEXT')
  return result
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Reflect.ownKeys(value).length !== value.length + 1) throw new Error('INVALID_REMOTE_CONTEXT')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)]
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error('INVALID_REMOTE_CONTEXT')
    return descriptor.value
  })
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error('INVALID_REMOTE_CONTEXT')
  return value as number
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('INVALID_REMOTE_CONTEXT')
  return value as T
}
function handle(value: unknown, prefix: 's' | 'r' | 'e'): string {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}[1-9][0-9]{0,3}$`, 'u').test(value)) throw new Error('INVALID_REMOTE_CONTEXT')
  return value
}
const TOOLS: readonly DispatcherTool[] = ['read_session', 'read_history', 'read_scoring_evidence']
const SCORE_KINDS: readonly RemoteCoachEvidence['scoreKind'][] = ['warmup-standard', 'routine-technique', 'follow-along-similarity', 'guidance']
const EXERCISES = ['shoulder_rotation', 'overhead_raise', 'lateral_raise', 'step_jack', 'squat', 'knee_raise'] as const
const ROUTINES = ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing'] as const

export function parseRemoteContext(value: unknown): RemoteCoachContext {
  const raw = fields(value, ['mode', 'remainingCalls', 'scope', 'observations'])
  const scope = fields(raw.scope, ['warmupSessionId', 'routineSessionId', 'historyLimit'], ['historyLimit'])
  const sessionKinds = new Map<string, string>()
  const bind = (sessionId: string, kind: string) => {
    if (sessionKinds.has(sessionId) && sessionKinds.get(sessionId) !== kind) throw new Error('INVALID_REMOTE_CONTEXT')
    sessionKinds.set(sessionId, kind)
    return sessionId
  }
  const parsedScope: RemoteCoachContext['scope'] = { historyLimit: integer(scope.historyLimit, 1, 64) }
  if (Object.hasOwn(scope, 'warmupSessionId')) parsedScope.warmupSessionId = bind(handle(scope.warmupSessionId, 's'), 'exercise')
  if (Object.hasOwn(scope, 'routineSessionId')) parsedScope.routineSessionId = bind(handle(scope.routineSessionId, 's'), 'routine')
  const requests = new Set<string>()
  const evidenceOwners = new Map<string, string>()
  let evidenceCount = 0
  const observations = list(raw.observations, 32).map(value => {
    const observation = fields(value, ['requestId', 'tool', 'ok', 'problemCode', 'comparisonGate', 'evidence'])
    const requestId = handle(observation.requestId, 'r')
    if (requests.has(requestId) || typeof observation.ok !== 'boolean') throw new Error('INVALID_REMOTE_CONTEXT')
    requests.add(requestId)
    const tool = observation.tool === null ? null : choice(observation.tool, TOOLS)
    const problemCode = observation.problemCode === null ? null : choice(observation.problemCode, REMOTE_PROBLEM_CODES)
    const comparisonGate = observation.comparisonGate === null ? null : choice(observation.comparisonGate, ['FULL', 'PARTIAL', 'NONE'] as const)
    const evidence = list(observation.evidence, 64).map(value => {
      const item = fields(value, ['evidenceId', 'sessionId', 'subject', 'scoreKind'])
      const subject = fields(item.subject, ['kind', 'id'])
      const kind = choice(subject.kind, ['exercise', 'routine'] as const)
      const parsedSubject: MotionSubject = kind === 'exercise'
        ? { kind, id: choice(subject.id, EXERCISES) } : { kind, id: choice(subject.id, ROUTINES) }
      const evidenceId = handle(item.evidenceId, 'e')
      if (evidenceOwners.has(evidenceId)) throw new Error('INVALID_REMOTE_CONTEXT')
      evidenceOwners.set(evidenceId, requestId)
      evidenceCount += 1
      const scoreKind = choice(item.scoreKind, SCORE_KINDS)
      if ((kind === 'exercise') !== (scoreKind === 'warmup-standard')) throw new Error('INVALID_REMOTE_CONTEXT')
      return { evidenceId, sessionId: bind(handle(item.sessionId, 's'), kind), subject: parsedSubject, scoreKind }
    })
    if ((observation.ok && (!tool || problemCode !== null)) || (!observation.ok && (evidence.length || problemCode === null))
      || (comparisonGate !== null && (!observation.ok || tool !== 'read_history'))) throw new Error('INVALID_REMOTE_CONTEXT')
    return { requestId, tool, ok: observation.ok, problemCode, comparisonGate, evidence }
  })
  if (evidenceCount > 256) throw new Error('INVALID_REMOTE_CONTEXT')
  return freezeCoachValue({ mode: choice(raw.mode, ['explain', 'history', 'routine', 'insufficient'] as const),
    remainingCalls: integer(raw.remainingCalls, 0, 64), scope: parsedScope, observations })
}

/** Shared model-output validation. This does not grant permission to execute a tool. */
export function validateRemoteStep(value: unknown, context: RemoteCoachContext): ProviderStep {
  const step = parseProviderStep(value)
  if (step.type === 'answer') {
    if (step.mode !== 'insufficient' && step.mode !== context.mode) throw new Error('INVALID_PROVIDER_OUTPUT')
    if (step.mode === 'insufficient' && step.evidenceRefs.length) throw new Error('INVALID_PROVIDER_OUTPUT')
    for (const ref of step.evidenceRefs) {
      const observation = context.observations.find(item => item.requestId === ref.requestId && item.ok)
      const evidence = observation?.evidence.find(item => item.evidenceId === ref.evidenceId)
      if (!observation || !evidence
        || (step.mode === 'routine' ? evidence.subject.kind !== 'routine' || evidence.subject.id !== 'baduanjin'
          : evidence.subject.kind !== 'exercise' || evidence.subject.id !== 'squat')
        || (step.mode === 'history' && (observation.tool !== 'read_history' || observation.comparisonGate === null))) throw new Error('INVALID_PROVIDER_OUTPUT')
    }
    return step
  }
  if (context.mode === 'insufficient' || step.calls.length > context.remainingCalls) throw new Error('INVALID_PROVIDER_OUTPUT')
  const knownSessions = new Map<string, string>()
  if (context.scope.warmupSessionId) knownSessions.set(context.scope.warmupSessionId, 'warmup')
  if (context.scope.routineSessionId) knownSessions.set(context.scope.routineSessionId, 'routine')
  for (const observation of context.observations) for (const evidence of observation.evidence) {
    knownSessions.set(evidence.sessionId, evidence.subject.kind === 'exercise' ? 'warmup' : 'routine')
  }
  const calls = step.calls.map(call => {
    const intent = parseToolIntent(call)
    const currentSession = context.mode === 'routine' ? context.scope.routineSessionId : context.scope.warmupSessionId
    if (!intent || (intent.query.sessionId && knownSessions.get(intent.query.sessionId) !== intent.query.kind)
      || (intent.query.limit !== undefined && intent.query.limit > context.scope.historyLimit)
      || !currentSession || intent.query.sessionId !== currentSession
      || (context.mode === 'routine' ? intent.query.kind !== 'routine' || intent.query.subject?.kind !== 'routine' || intent.query.subject.id !== 'baduanjin'
        : intent.query.kind !== 'warmup' || intent.query.subject?.kind !== 'exercise' || intent.query.subject.id !== 'squat')
      || (context.mode === 'history' ? intent.tool !== 'read_history' : intent.tool === 'read_history')) {
      throw new Error('INVALID_PROVIDER_OUTPUT')
    }
    return intent
  })
  return { type: 'tools', calls }
}
