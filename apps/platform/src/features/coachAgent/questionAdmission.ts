import { minimizeCoachQuestion, parseLocalPlanContext, type LocalPlanContext } from './localProtocolV2.ts'

declare const captureBrand: unique symbol
declare const ticketBrand: unique symbol
declare const leaseBrand: unique symbol
export type QuestionCapture = Readonly<{ [captureBrand]: true }>
export type QuestionTicket = Readonly<{ [ticketBrand]: true }>
export type QuestionLease = Readonly<{ [leaseBrand]: true }>

/** User-selected bounded requests, not an intent classifier or a raw-text extraction format.
 * previousCount means previous records EXCLUDING the current record; never recent N minus one. */
type ControlledChoice =
  | { kind: 'controlled'; intent: 'explain'; subject: 'squat' }
  | { kind: 'controlled'; intent: 'routine'; subject: 'baduanjin' }
  | { kind: 'controlled'; intent: 'history'; subject: 'squat'; previousCount: number }
/** Optional visible question must match the selected canonical template byte for byte.
 * This bounded template path does not establish general natural-language/privacy support. */
export type ControlledQuestionSelection = ControlledChoice & { question?: string }

export interface QuestionAdmissionOptions {
  /** Trusted composition configuration. Do not deserialize these fields from a user request. */
  enabled?: boolean
  consent?: boolean
  scope?: LocalPlanContext['scope']
  remainingCalls?: number
  policyVersion?: number
  approvalVersion?: number
  ttlMs?: number
  /** Monotonic application clock. No wall-clock timestamps, hashes or identifiers enter the wire. */
  now?: () => number
}

export type AdmissionClosed = Readonly<{
  status: 'disabled' | 'clarification_required' | 'review_required' | 'denied'
  code: string
}>
export type CaptureResult = AdmissionClosed | Readonly<{ status: 'captured'; capture: QuestionCapture }>
export type AdmissionDecision = AdmissionClosed | Readonly<{ status: 'ready'; ticket: QuestionTicket }>
export type AdmittedQuestionConstraint = Readonly<{
  intent: 'explain' | 'history' | 'routine'
  historyPreviousCount?: number
}>
export type AdmissionConsumption = AdmissionClosed | Readonly<{
  status: 'admitted'; wire: LocalPlanContext; localQuestion: string
  constraint: AdmittedQuestionConstraint; lease: QuestionLease; signal: AbortSignal
}>

type Selection = ControlledChoice
type Stamp = { epoch: number; policyVersion: number; approvalVersion: number; expires: number }
type SavedCapture = Stamp & ({ kind: 'selection'; selection: Selection } | { kind: 'text'; text: string })
type SavedTicket = Stamp & { wire: LocalPlanContext; localQuestion: string; constraint: AdmittedQuestionConstraint }
type SavedLease = Stamp & { controller: AbortController; timer: ReturnType<typeof setTimeout> }

const CONFIG_KEYS = ['enabled', 'consent', 'scope', 'remainingCalls', 'policyVersion', 'approvalVersion', 'ttlMs', 'now'] as const
const UPDATE_KEYS = CONFIG_KEYS.filter(key => key !== 'now' && key !== 'ttlMs')
const closed = (status: AdmissionClosed['status'], code: string): AdmissionClosed => Object.freeze({ status, code })
const token = <T>() => Object.freeze({}) as T
const integer = (value: unknown, minimum: number, maximum: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum

/** Snapshot descriptors once. No property getter, extra/symbol/hidden key or caller reread. */
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key)
      || !('value' in descriptors[key]) || !descriptors[key].enumerable)
      || required.some(key => !Object.hasOwn(descriptors, key))) return null
    return Object.fromEntries(keys.map(key => [key, descriptors[key as string].value]))
  } catch { return null }
}

function scopeSnapshot(value: unknown): LocalPlanContext['scope'] | null {
  // The shared wire parser independently enforces booleans and history bounds.
  try {
    return parseLocalPlanContext({ protocol: 'coach-plan-v2', inputProjection: 'question-scope',
      question: '深蹲评分', scope: value, remainingCalls: 1 }).scope
  } catch { return null }
}

function selectionSnapshot(raw: Record<string, unknown>): Selection | null {
  if (raw.kind !== 'controlled') return null
  if (raw.intent === 'history' && raw.subject === 'squat' && integer(raw.previousCount, 1, 64)) {
    return Object.freeze({ kind: 'controlled', intent: 'history', subject: 'squat', previousCount: raw.previousCount })
  }
  if (Object.hasOwn(raw, 'previousCount')) return null
  if (raw.intent === 'explain' && raw.subject === 'squat') return Object.freeze({ kind: 'controlled', intent: 'explain', subject: 'squat' })
  if (raw.intent === 'routine' && raw.subject === 'baduanjin') return Object.freeze({ kind: 'controlled', intent: 'routine', subject: 'baduanjin' })
  return null
}

function canonicalQuestion(selection: Selection): string {
  if (selection.intent === 'explain') return '解释这次深蹲评分。'
  if (selection.intent === 'routine') return '解释这次八段锦跟练表现。'
  return `比较这次深蹲评分和之前历史，只看${selection.previousCount}次。`
}

/** Default-off, in-memory admission boundary. No IO, logging, model calls or tool permissions.
 * Keep the returned host capture/update methods PRIVATE to a trusted composition layer.
 * A field name, serialized object or TypeScript brand never proves UI/IPC provenance.
 * Free text is NEVER admitted: a no-loss projection is not proof of privacy or policy safety.
 * Controlled history uses the existing STRUCTURED protocol: its exact previous-record count
 * stays in authorized scope/constraint. The local display text is never projected or sent.
 * This is controlled-option planning, not natural-language number recovery or a privacy fix.
 * JSON strings are rejected rather than parsed (including objects with duplicate JSON keys).
 * Controlled selections require a real independent user selection, not automatic extraction.
 */
export function createQuestionAdmission(options: QuestionAdmissionOptions = {}) {
  const input = fields(options, [], CONFIG_KEYS)
  if (!input) throw new Error('INVALID_ADMISSION_CONFIGURATION')
  const enabled = input.enabled === undefined ? false : input.enabled, consent = input.consent === undefined ? false : input.consent
  const remainingCalls = input.remainingCalls === undefined ? 0 : input.remainingCalls
  const policyVersion = input.policyVersion === undefined ? 1 : input.policyVersion
  const approvalVersion = input.approvalVersion === undefined ? 1 : input.approvalVersion
  const ttlMs = input.ttlMs === undefined ? 60_000 : input.ttlMs
  const clock = input.now === undefined ? (() => performance.now()) : input.now
  const scope = scopeSnapshot(input.scope === undefined ? { warmup: false, routine: false, historyLimit: 1 } : input.scope)
  if (typeof enabled !== 'boolean' || typeof consent !== 'boolean' || !integer(remainingCalls, 0, 64)
    || !integer(policyVersion, 1, Number.MAX_SAFE_INTEGER) || !integer(approvalVersion, 1, Number.MAX_SAFE_INTEGER)
    || !integer(ttlMs, 1, 60_000) || typeof clock !== 'function' || !scope) throw new Error('INVALID_ADMISSION_CONFIGURATION')
  // Narrow once; host updates validate before replacing these typed values.
  let hostEnabled: boolean = enabled, hostConsent: boolean = consent
  let budget: number = remainingCalls, hostPolicy: number = policyVersion, hostApproval: number = approvalVersion
  let authorizedScope: LocalPlanContext['scope'] = scope
  const lifetime: number = ttlMs, readClock = clock as () => number
  let epoch = 0, lastTime = -Infinity, invalidating = false
  let captures = new WeakMap<object, SavedCapture>(), tickets = new WeakMap<object, SavedTicket>()
  let leases = new WeakMap<object, SavedLease>()
  const active = new Map<AbortController, ReturnType<typeof setTimeout>>()
  const invalidate = () => {
    const wasInvalidating = invalidating
    invalidating = true
    epoch += 1
    captures = new WeakMap(); tickets = new WeakMap(); leases = new WeakMap()
    const pending = [...active]; active.clear()
    for (const [, timer] of pending) clearTimeout(timer)
    // Abort observers cannot revive any old capability; maps/epoch are cleared first.
    try { for (const [controller] of pending) controller.abort() }
    finally { invalidating = wasInvalidating }
  }
  const time = (): number | null => {
    let value: unknown
    try { value = readClock() } catch { value = NaN }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lastTime) {
      hostEnabled = false; hostConsent = false; budget = 0; invalidate(); return null
    }
    lastTime = value
    return value
  }
  const stamp = (): Stamp | null => {
    const currentEpoch = epoch, current = time()
    if (current === null || epoch !== currentEpoch) return null
    return { epoch, policyVersion: hostPolicy, approvalVersion: hostApproval, expires: current + lifetime }
  }
  const valid = (saved: Stamp | undefined): saved is Stamp => {
    const current = time()
    return current !== null && !!saved && hostEnabled && hostConsent && saved.epoch === epoch
      && saved.policyVersion === hostPolicy && saved.approvalVersion === hostApproval && current < saved.expires
  }
  const captureStart = () => { invalidate(); return epoch }
  const unavailable = (): AdmissionClosed | null => invalidating ? closed('denied', 'ADMISSION_INVALIDATING')
    : !hostEnabled ? closed('disabled', 'ADMISSION_DISABLED')
    : !hostConsent ? closed('denied', 'CONSENT_REQUIRED') : null
  const api = {
    mixed(..._input: unknown[]): AdmissionClosed {
      // Deliberately never inspect the mixed payload, even if it is a hostile proxy.
      void _input
      invalidate()
      return closed('clarification_required', 'REENTER_QUESTION_ONLY')
    },
    hostCaptureSelection(value: unknown): CaptureResult {
      const captureEpoch = captureStart(), raw = fields(value, ['kind', 'intent', 'subject'], ['previousCount', 'question'])
      const selection = raw && selectionSnapshot(raw)
      if (!selection || epoch !== captureEpoch) return closed('denied', 'INVALID_OR_REENTRANT_SELECTION')
      const blocked = unavailable(); if (blocked) return blocked
      if (raw && Object.hasOwn(raw, 'question') && (typeof raw.question !== 'string'
        || raw.question !== canonicalQuestion(selection)
        || (selection.intent !== 'history' && minimizeCoachQuestion(raw.question) !== raw.question)))
        return closed('clarification_required', 'QUESTION_DOES_NOT_MATCH_CONTROLLED_SELECTION')
      const saved = stamp()
      if (!saved || epoch !== captureEpoch) return closed('denied', 'INVALID_LIFETIME')
      const capture = token<QuestionCapture>()
      captures.set(capture, { ...saved, kind: 'selection', selection })
      return Object.freeze({ status: 'captured', capture })
    },
    hostCaptureQuestion(value: unknown): CaptureResult {
      const captureEpoch = captureStart(), raw = fields(value, ['kind', 'text'])
      if (!raw || raw.kind !== 'question-only' || typeof raw.text !== 'string' || epoch !== captureEpoch)
        return closed('denied', 'INVALID_OR_REENTRANT_QUESTION')
      const blocked = unavailable(); if (blocked) return blocked
      if (raw.text.length > 4096) return closed('clarification_required', 'INVALID_OR_OVERSIZE_QUESTION')
      const saved = stamp()
      if (!saved || epoch !== captureEpoch) return closed('denied', 'INVALID_LIFETIME')
      const capture = token<QuestionCapture>()
      captures.set(capture, { ...saved, kind: 'text', text: raw.text })
      return Object.freeze({ status: 'captured', capture })
    },
    assess(value: unknown): AdmissionDecision {
      const saved = value && typeof value === 'object' ? captures.get(value) : undefined
      if (!valid(saved) || captures.get(value as object) !== saved) return closed('denied', 'UNTRUSTED_OR_STALE_CAPTURE')
      captures.delete(value as object)
      if (saved.kind === 'text') {
        const question = saved.text
        if (question.length > 4096 || !question.trim() || question !== question.normalize('NFC')
          || /[\p{Cc}\p{Cf}]/u.test(question)) return closed('clarification_required', 'INVALID_OR_OVERSIZE_QUESTION')
        const projected = minimizeCoachQuestion(question)
        if (question.length > 512 || projected !== question || projected.includes('[已隐去]'))
          return closed('clarification_required', 'CONTENT_LOSS_OR_UNPROVEN_BOUNDARY')
        return closed('review_required', 'FREE_TEXT_NOT_ADMITTED')
      }
      const selection = saved.selection
      if ((selection.intent === 'routine' ? !authorizedScope.routine : !authorizedScope.warmup)
        || (selection.intent === 'history' && selection.previousCount > authorizedScope.historyLimit))
        return closed('denied', 'SELECTION_OUTSIDE_AUTHORIZED_SCOPE')
      if (budget < 1) return closed('denied', 'BUDGET_EXHAUSTED')
      const question = canonicalQuestion(selection)
      if (selection.intent !== 'history' && minimizeCoachQuestion(question) !== question)
        return closed('denied', 'INVALID_CANONICAL_QUESTION')
      const wire = parseLocalPlanContext({ protocol: 'coach-plan-v2',
        ...(selection.intent === 'history' ? { inputProjection: 'structured', mode: 'history' }
          : { inputProjection: 'question-scope', question }),
        scope: { warmup: selection.intent !== 'routine', routine: selection.intent === 'routine',
          historyLimit: selection.intent === 'history' ? selection.previousCount : 1 }, remainingCalls: 1 })
      if (!valid(saved)) return closed('denied', 'STALE_AFTER_VALIDATION')
      const ticket = token<QuestionTicket>()
      const constraint: AdmittedQuestionConstraint = Object.freeze({ intent: selection.intent,
        ...(selection.intent === 'history' ? { historyPreviousCount: selection.previousCount } : {}) })
      tickets.set(ticket, { ...saved, wire, localQuestion: question, constraint })
      return Object.freeze({ status: 'ready', ticket })
    },
    consume(value: unknown): AdmissionConsumption {
      const saved = value && typeof value === 'object' ? tickets.get(value) : undefined
      if (!valid(saved) || budget < 1 || tickets.get(value as object) !== saved) return closed('denied', 'INVALID_TICKET_OR_BUDGET')
      // No await, external callback or observer between the final validity check and debit.
      tickets.delete(value as object); budget -= 1
      const lease = token<QuestionLease>(), controller = new AbortController()
      // Preserve the capture's deadline, rather than restarting TTL at consumption.
      const timer = setTimeout(() => {
        const pending = leases.get(lease)
        if (!pending || pending.controller !== controller) return
        leases.delete(lease); active.delete(controller)
        controller.abort()
      }, Math.max(0, saved.expires - lastTime))
      leases.set(lease, { ...saved, controller, timer }); active.set(controller, timer)
      return Object.freeze({ status: 'admitted', wire: saved.wire, localQuestion: saved.localQuestion,
        constraint: saved.constraint, lease, signal: controller.signal })
    },
    isCurrent(value: unknown): boolean {
      const saved = value && typeof value === 'object' ? leases.get(value) : undefined
      if (valid(saved) && leases.get(value as object) === saved) return true
      if (saved) {
        leases.delete(value as object); active.delete(saved.controller); clearTimeout(saved.timer); saved.controller.abort()
      }
      return false
    },
    acceptResult(value: unknown): boolean {
      const saved = value && typeof value === 'object' ? leases.get(value) : undefined
      const accepted = valid(saved) && leases.get(value as object) === saved
      if (saved) {
        leases.delete(value as object); active.delete(saved.controller); clearTimeout(saved.timer)
        if (!accepted) saved.controller.abort()
      }
      return accepted
    },
    invalidate,
    hostUpdate(value: unknown): void {
      const updateEpoch = captureStart(), raw = fields(value, [], UPDATE_KEYS)
      const nextScope = raw && Object.hasOwn(raw, 'scope') ? scopeSnapshot(raw.scope) : authorizedScope
      if (!raw || epoch !== updateEpoch || !nextScope
        || (Object.hasOwn(raw, 'enabled') && typeof raw.enabled !== 'boolean')
        || (Object.hasOwn(raw, 'consent') && typeof raw.consent !== 'boolean')
        || (Object.hasOwn(raw, 'remainingCalls') && !integer(raw.remainingCalls, 0, 64))
        || (Object.hasOwn(raw, 'policyVersion') && !integer(raw.policyVersion, hostPolicy, Number.MAX_SAFE_INTEGER))
        || (Object.hasOwn(raw, 'approvalVersion') && !integer(raw.approvalVersion, hostApproval, Number.MAX_SAFE_INTEGER))) {
        hostEnabled = false; hostConsent = false; budget = 0; invalidate()
        throw new Error('INVALID_ADMISSION_CONFIGURATION')
      }
      if (Object.hasOwn(raw, 'enabled')) hostEnabled = raw.enabled as boolean
      if (Object.hasOwn(raw, 'consent')) hostConsent = raw.consent as boolean
      if (Object.hasOwn(raw, 'remainingCalls')) budget = raw.remainingCalls as number
      if (Object.hasOwn(raw, 'policyVersion')) hostPolicy = raw.policyVersion as number
      if (Object.hasOwn(raw, 'approvalVersion')) hostApproval = raw.approvalVersion as number
      authorizedScope = nextScope
    },
  }
  return Object.freeze(api)
}

export type QuestionAdmission = ReturnType<typeof createQuestionAdmission>
