import type { MotionSubject, ScoringEvidence } from './contracts'
import type { DispatcherTool } from './dispatchTypes'

/** Only an authorized, minimal projection is visible to the planner. No raw reader sidecars. */
export interface ProviderEvidence {
  evidenceId: string
  sessionId: string
  subject: MotionSubject
  scoreKind: ScoringEvidence['score']['scoreKind']
  scoringVersion: string | null
  source: ScoringEvidence['provenance']['source']
}

export interface ProviderObservation {
  requestId: string
  tool: DispatcherTool | null
  ok: boolean
  problemCode: string | null
  comparisonGate: 'FULL' | 'PARTIAL' | 'NONE' | null
  evidence: readonly ProviderEvidence[]
}

export interface ProviderContext {
  question: string
  observations: readonly ProviderObservation[]
  remainingCalls: number
}

/** Remote model calls belong in a separately authorized server process. */
export interface CoachProvider {
  readonly kind: 'mock' | 'remote'
  readonly id: string
  next(context: ProviderContext, options: { signal: AbortSignal }): Promise<unknown>
}

export type AnswerMode = 'explain' | 'history' | 'routine' | 'insufficient'
/** Current bounded Chinese question policy, shared by planning and factual rendering. */
export function classifyCoachQuestion(question: string): AnswerMode {
  if (question.includes('深蹲') && /(最近|进步|历史)/u.test(question)) return 'history'
  if (question.includes('深蹲') && /(评分|分数|不高|偏低)/u.test(question)) return 'explain'
  if (question.includes('八段锦') && /(跟练|表现)/u.test(question)) return 'routine'
  return 'insufficient'
}
export interface AnswerReference { requestId: string; evidenceId: string }
export type ProviderStep =
  | { type: 'tools'; calls: unknown[] }
  | { type: 'answer'; mode: AnswerMode; evidenceRefs: AnswerReference[] }

/** No getters, custom prototypes, symbols or extra fields may cross the untrusted boundary. */
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('INVALID_PROVIDER_OUTPUT')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const names = Reflect.ownKeys(descriptors)
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key)
    || !('value' in descriptors[key]) || !descriptors[key].enumerable)) throw new Error('INVALID_PROVIDER_OUTPUT')
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]))
}

function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) throw new Error('INVALID_PROVIDER_OUTPUT')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).length !== value.length + 1
    || Array.from({ length: value.length }, (_, index) => descriptors[String(index)])
      .some(item => !item || !('value' in item) || !item.enumerable)) throw new Error('INVALID_PROVIDER_OUTPUT')
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)].value)
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || value !== value.trim()
    || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('INVALID_PROVIDER_OUTPUT')
  return value
}

export function parseProviderStep(value: unknown): ProviderStep {
  // Inspect the discriminator without evaluating an accessor.
  if (!value || typeof value !== 'object') throw new Error('INVALID_PROVIDER_OUTPUT')
  const type = Object.getOwnPropertyDescriptor(value, 'type')?.value
  if (type === 'tools') {
    const step = fields(value, ['type', 'calls'])
    const calls = list(step.calls, 4)
    if (!calls.length) throw new Error('INVALID_PROVIDER_OUTPUT')
    // Dispatcher parses each intent; the planner cannot attach results or trusted IDs.
    for (const call of calls) fields(call, ['tool', 'query'])
    return { type: 'tools', calls }
  }
  const step = fields(value, ['type', 'mode', 'evidenceRefs'])
  if (type !== 'answer' || !['explain', 'history', 'routine', 'insufficient'].includes(step.mode as string)) throw new Error('INVALID_PROVIDER_OUTPUT')
  const evidenceRefs = list(step.evidenceRefs, 64).map(item => {
    const ref = fields(item, ['requestId', 'evidenceId'])
    return { requestId: identifier(ref.requestId), evidenceId: identifier(ref.evidenceId) }
  })
  if (new Set(evidenceRefs.map(ref => `${ref.requestId}\u0000${ref.evidenceId}`)).size !== evidenceRefs.length) throw new Error('INVALID_PROVIDER_OUTPUT')
  return { type: 'answer', mode: step.mode as AnswerMode, evidenceRefs }
}

export function freezeCoachValue<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeCoachValue(child)
    Object.freeze(value)
  }
  return value
}
