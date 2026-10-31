import type { AgentToolErrorCode, AgentToolResult, ScoringEvidence, TrainingSessionSummary } from './contracts'
import type { EvidenceDetail, ReaderResult, SessionSnapshot } from './readerTypes'
import type { ComparisonSnapshot } from './sessionReader'
import type {
  CoachAuthorization, CoachToolDispatcher, DispatchErrorCode, DispatchProblem, DispatchReceipt,
  DispatcherOptions, EvidenceTrace, ToolIntent, ToolQuery,
} from './dispatchTypes'
import { boundedId, parseToolIntent, plainFields } from './toolQuery'
import { ExecutionStopped, freezeOwnedData, withinLifetime } from './execution'
import { validateAgentToolResult } from './validation'

export type * from './dispatchTypes'

class DispatchFault extends Error {
  constructor(readonly problem: DispatchProblem) { super(problem.code) }
}

const MESSAGES: Record<DispatchErrorCode, string> = {
  NOT_FOUND: 'The authorized training session was not found.',
  UNAVAILABLE: 'The training data service is unavailable.',
  CORRUPT: 'The stored training data failed validation; this is not an empty history.',
  UNSUPPORTED_VERSION: 'The stored training version is unsupported.',
  INSUFFICIENT_DATA: 'There is insufficient traceable scoring evidence.',
  INVALID_INPUT: 'The tool intent is invalid.',
  PERMISSION_DENIED: 'This request is outside the application authorization.',
  NOT_ALLOWED: 'This tool result could not be trusted.',
  CANCELLED: 'The tool call was cancelled.',
  TIMEOUT: 'The tool call exceeded its deadline.',
  DUPLICATE_CALL: 'This tool intent has already been reserved in this conversation.',
  BUDGET_EXCEEDED: 'The conversation tool budget is exhausted.',
}

function problem(code: DispatchErrorCode): DispatchProblem {
  return { code, message: MESSAGES[code], retryable: code === 'UNAVAILABLE' || code === 'TIMEOUT' }
}

function authorizationCopy(value: CoachAuthorization | undefined): CoachAuthorization | null {
  try {
    const auth = plainFields(value, ['principalId', 'tools', 'sessions', 'maxHistory'])
    if (!boundedId(auth.principalId) || !Array.isArray(auth.tools) || auth.tools.length > 3
      || auth.tools.some(tool => !['read_session', 'read_history', 'read_scoring_evidence'].includes(tool))
      || new Set(auth.tools).size !== auth.tools.length
      || !Number.isSafeInteger(auth.maxHistory) || (auth.maxHistory as number) < 1 || (auth.maxHistory as number) > 64) return null
    const sessions = plainFields(auth.sessions, ['warmup', 'routine'], [])
    for (const ids of Object.values(sessions)) {
      if (!Array.isArray(ids) || ids.length > 64 || ids.some(id => !boundedId(id)) || new Set(ids).size !== ids.length) return null
    }
    return freezeOwnedData({ principalId: auth.principalId, tools: [...auth.tools],
      sessions: Object.fromEntries(Object.entries(sessions).map(([kind, ids]) => [kind, [...ids as string[]]])),
      maxHistory: auth.maxHistory as number })
  } catch { return null }
}

function selected(snapshot: SessionSnapshot, query: ToolQuery): SessionSnapshot {
  if (!query.subject) return snapshot
  const evidence = snapshot.summary.evidence.filter(item => item.subject.kind === query.subject!.kind && item.subject.id === query.subject!.id)
  const ids = new Set(evidence.map(item => item.id))
  return { ...snapshot, summary: { ...snapshot.summary, evidence }, details: snapshot.details.filter(item => ids.has(item.evidenceId)) }
}

function matches(snapshot: SessionSnapshot, query: ToolQuery) {
  if (!query.subject) return true
  return snapshot.summary.evidence.some(item => item.subject.kind === query.subject!.kind && item.subject.id === query.subject!.id)
}

function fingerprint(sessions: SessionSnapshot[]): string {
  return JSON.stringify(sessions, (key, value: unknown) => key === 'recordedAt' ? undefined : value)
}

interface LocalData {
  data: TrainingSessionSummary | TrainingSessionSummary[] | ScoringEvidence[]
  evidence: ScoringEvidence[]
  details: EvidenceDetail[]
  limitations: string[]
  comparison: ComparisonSnapshot | null
}

/** One immutable application principal and bounded conversation lifetime per instance. */
export function createCoachToolDispatcher(options: DispatcherOptions): CoachToolDispatcher {
  const auth = authorizationCopy(options.authorization)
  const maxCalls = options.maxCalls ?? 8
  const timeoutMs = options.timeoutMs ?? 1000
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 64
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new RangeError('Invalid dispatcher budget.')
  const reader = options.reader
  const now = options.now
  const owned = new WeakSet<object>()
  const reserved = new Set<string>()
  let calls = 0
  function own(receipt: DispatchReceipt) { freezeOwnedData(receipt); owned.add(receipt); return receipt }
  function unwrap<T>(value: ReaderResult<T>): T {
    if (!value.ok) {
      if (!['NOT_FOUND', 'UNAVAILABLE', 'CORRUPT', 'UNSUPPORTED_VERSION', 'INSUFFICIENT_DATA', 'INVALID_INPUT', 'PERMISSION_DENIED'].includes(value.error.code)) throw new DispatchFault(problem('UNAVAILABLE'))
      throw new DispatchFault({ ...problem(value.error.code), readerProblem: { ...value.error } })
    }
    if (!reader.owns(value.data)) throw new DispatchFault(problem('NOT_ALLOWED'))
    return value.data
  }
  function checkSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
    if (!reader.owns(snapshot) || !auth?.sessions[snapshot.summary.kind]?.includes(snapshot.summary.sessionId)) throw new DispatchFault(problem('NOT_ALLOWED'))
    return snapshot
  }
  function localRead(intent: ToolIntent, check: () => void): LocalData {
    const { tool, query } = intent
    const ids = auth!.sessions[query.kind]!
    const limit = query.limit ?? auth!.maxHistory
    const captured: SessionSnapshot[] = []
    let comparison: ComparisonSnapshot | null = null
    let evidence: ScoringEvidence[]
    let details: EvidenceDetail[]
    let limitations: string[]
    let data: LocalData['data']
    if (tool === 'read_session') {
      const returned = checkSnapshot(unwrap(reader.readSession(query.kind, query.sessionId!)))
      if (returned.summary.kind !== query.kind || returned.summary.sessionId !== query.sessionId) throw new DispatchFault(problem('NOT_ALLOWED'))
      const current = selected(returned, query)
      data = current.summary; evidence = current.summary.evidence; details = current.details; limitations = current.limitations
    } else if (tool === 'read_scoring_evidence') {
      const value = unwrap(reader.readScoringEvidence(query.kind, query.sessionId!))
      if (value.evidence.some(item => item.sessionId !== query.sessionId
        || item.subject.kind !== (query.kind === 'warmup' ? 'exercise' : 'routine'))) throw new DispatchFault(problem('NOT_ALLOWED'))
      evidence = value.evidence.filter(item => !query.subject || (item.subject.kind === query.subject.kind && item.subject.id === query.subject.id))
      if (!evidence.some(item => item.score.status === 'available' || (item.score.scoreKind === 'guidance' && item.quality.sampleCount > 0))) throw new DispatchFault(problem('INSUFFICIENT_DATA'))
      const evidenceIds = new Set(evidence.map(item => item.id))
      details = value.details.filter(item => evidenceIds.has(item.evidenceId)); limitations = value.limitations; data = evidence
    } else if (query.sessionId) {
      // Native gates consider all candidates. Prove the entire partition is authorized BEFORE comparison.
      // A full 64-item page cannot prove completeness, so it fails closed as well.
      const whole = unwrap(reader.readHistory({ kind: query.kind, limit: 64 }))
      check()
      if (whole.sessions.length >= 64 || whole.sessions.some(item => !ids.includes(item.summary.sessionId))) throw new DispatchFault(problem('PERMISSION_DENIED'))
      whole.sessions.forEach(checkSnapshot)
      comparison = unwrap(reader.compareHistory({ ...query, sessionId: query.sessionId, limit }))
      check()
      checkSnapshot(comparison.current); comparison.previous.forEach(checkSnapshot)
      if (comparison.current.summary.sessionId !== query.sessionId || comparison.current.summary.kind !== query.kind
        || comparison.previous.some(item => item.summary.kind !== query.kind)
        || comparison.excluded.some(item => !ids.includes(item.sessionId))
        || comparison.gates.some(gate => 'excluded' in gate && gate.excluded.some(item => !ids.includes(item.sessionId)))
        || comparison.gates.some(gate => 'previousSessionId' in gate ? gate.previousSessionId !== null && !ids.includes(gate.previousSessionId)
          : gate.previousId !== null && !ids.includes(gate.previousId))) throw new DispatchFault(problem('PERMISSION_DENIED'))
      if ([comparison.current, ...comparison.previous].some(snapshot => {
        const original = whole.sessions.find(item => item.summary.sessionId === snapshot.summary.sessionId)
        return !original || fingerprint([snapshot]) !== fingerprint([selected(original, query)])
      })) throw new DispatchFault(problem('UNAVAILABLE'))
      // Reader methods capture independently. Detect changes across the comparison window.
      const after = unwrap(reader.readHistory({ kind: query.kind, limit: 64 }))
      check()
      if (after.sessions.length >= 64 || after.sessions.some(item => !ids.includes(item.summary.sessionId))
        || fingerprint(whole.sessions) !== fingerprint(after.sessions)) throw new DispatchFault(problem('UNAVAILABLE'))
      captured.push(comparison.current, ...comparison.previous)
      data = captured.map(item => item.summary)
      evidence = captured.flatMap(item => item.summary.evidence); details = captured.flatMap(item => item.details)
      limitations = captured.flatMap(item => item.limitations)
      if (comparison.gate === 'NONE') limitations.push(`HISTORY_NOT_COMPARABLE:${comparison.reason ?? 'UNSPECIFIED'}`)
      else if (comparison.gate === 'PARTIAL') limitations.push(`HISTORY_PARTIALLY_COMPARABLE:${comparison.reason ?? 'UNSPECIFIED'}`)
    } else {
      // Do not scan foreign history into a provider result or apply a global limit before authorization.
      for (const id of ids) {
        check()
        const value = reader.readSession(query.kind, id)
        if (!value.ok && value.error.code === 'NOT_FOUND') continue
        const snapshot = checkSnapshot(unwrap(value))
        if (snapshot.summary.kind !== query.kind || snapshot.summary.sessionId !== id) throw new DispatchFault(problem('NOT_ALLOWED'))
        if (matches(snapshot, query)) captured.push(selected(snapshot, query))
      }
      captured.sort((a, b) => b.summary.startedAt.value - a.summary.startedAt.value
        || (a.summary.sessionId < b.summary.sessionId ? 1 : -1))
      captured.splice(limit)
      data = captured.map(item => item.summary)
      evidence = captured.flatMap(item => item.summary.evidence); details = captured.flatMap(item => item.details)
      limitations = captured.flatMap(item => item.limitations)
    }
    check()
    if (evidence.length > 256 || (tool === 'read_history' && Array.isArray(data) && data.length > 64)) throw new DispatchFault(problem('INSUFFICIENT_DATA'))
    if (evidence.some(item => !ids.includes(item.sessionId))
      || new Set(evidence.map(item => item.id)).size !== evidence.length
      || details.length !== evidence.length || details.some(item => !evidence.some(entry => entry.id === item.evidenceId))
      || new Set(details.map(item => item.evidenceId)).size !== details.length) throw new DispatchFault(problem('NOT_ALLOWED'))
    return { data, evidence, details, limitations: [...new Set(limitations)], comparison }
  }

  function envelope(requestId: string, intent: ToolIntent, local: LocalData | null, fault: DispatchProblem | null): AgentToolResult | null {
    const recordedAt = now()
    const base = { schemaVersion: 1, id: `result:${requestId}`, requestId,
      recordedAt: { domain: 'epoch-ms', value: recordedAt },
      provenance: { source: 'unknown', mode: 'unknown', producer: 'repository' }, confidence: null, tool: intent.tool }
    const code: AgentToolErrorCode | undefined = fault ? fault.code === 'CORRUPT' ? 'UNAVAILABLE'
      : ['CANCELLED', 'DUPLICATE_CALL', 'BUDGET_EXCEEDED'].includes(fault.code) ? 'NOT_ALLOWED'
        : fault.code as AgentToolErrorCode : undefined
    const value = fault ? { ...base, ok: false, data: null, error: { code, message: fault.message, retryable: fault.retryable } }
      : { ...base, ok: true, data: local!.data, error: null }
    const checked = validateAgentToolResult(value, { requestId, tool: intent.tool }, { evidence: local?.evidence ?? [], catalogue: [] })
    return checked.ok ? checked.value : null
  }

  return {
    owns(value: unknown): value is DispatchReceipt { return !!value && typeof value === 'object' && owned.has(value) },
    remainingCalls() { return maxCalls - calls },
    async dispatch(input: unknown, lifetime = {}) {
      const requestId = globalThis.crypto.randomUUID()
      const intent = parseToolIntent(input)
      let fault: DispatchProblem | null = null
      let local: LocalData | null = null
      let executionStarted: number | null = null
      if (!intent) fault = problem('INVALID_INPUT')
      else if (!auth || !auth.tools.includes(intent.tool) || !Object.hasOwn(auth.sessions, intent.query.kind)
        || (intent.query.sessionId && !auth.sessions[intent.query.kind]!.includes(intent.query.sessionId))
        || (intent.query.limit !== undefined && intent.query.limit > auth.maxHistory)) fault = problem('PERMISSION_DENIED')
      else {
        const key = JSON.stringify({ tool: intent.tool, query: { kind: intent.query.kind, sessionId: intent.query.sessionId ?? null,
          subject: intent.query.subject ?? null, limit: intent.tool === 'read_history' ? intent.query.limit ?? auth.maxHistory : null } })
        if (reserved.has(key)) fault = problem('DUPLICATE_CALL')
        else if (calls >= maxCalls) fault = problem('BUDGET_EXCEEDED')
        else {
          // Reservation is synchronous and persists on failure, timeout and cancellation.
          reserved.add(key); calls += 1
          try {
            executionStarted = performance.now()
            local = await withinLifetime(check => localRead(intent, check), { signal: lifetime.signal, timeoutMs, now: () => performance.now() })
          } catch (error) {
            fault = error instanceof DispatchFault ? error.problem : error instanceof ExecutionStopped ? problem(error.code) : problem('UNAVAILABLE')
          }
        }
      }
      let result: AgentToolResult | null = null
      if (intent) {
        try { result = envelope(requestId, intent, local, fault) } catch { /* Clock/contract failure is closed below. */ }
        if (!result) { fault ??= problem('UNAVAILABLE'); local = null }
        if (!fault && lifetime.signal?.aborted) {
          fault = problem('CANCELLED'); local = null
          try { result = envelope(requestId, intent, null, fault) } catch { result = null }
        }
        if (!fault && executionStarted !== null && performance.now() - executionStarted >= timeoutMs) {
          fault = problem('TIMEOUT'); local = null
          try { result = envelope(requestId, intent, null, fault) } catch { result = null }
        }
      }
      if (fault) local = null
      const evidence: EvidenceTrace[] = local?.evidence.map(item => ({ requestId, evidenceId: item.id, sessionId: item.sessionId,
        scoreKind: item.score.scoreKind, scoringVersion: item.score.scoringVersion,
        recordRef: { ...item.recordRef }, provenance: { ...item.provenance },
        recordPaths: [...local!.details.find(detail => detail.evidenceId === item.id)!.recordPaths] })) ?? []
      return own({ ok: !fault, requestId, tool: intent?.tool ?? null, query: intent?.query ?? null, result, problem: fault,
        evidence, limitations: local?.limitations ?? [], comparison: local?.comparison ?? null, details: local?.details ?? [] })
    },
  }
}
