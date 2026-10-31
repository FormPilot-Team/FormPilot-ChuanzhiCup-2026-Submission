import { describe, expect, it, vi } from 'vitest'
import { createRemoteCoachProvider, type RemoteCoachProviderOptions } from '../src/features/coachAgent/remoteProvider'
import { parseRemoteContext, validateRemoteStep, REMOTE_STEP_MAX_BYTES, type RemoteCoachContext } from '../src/features/coachAgent/remoteProtocol'
import { createCoachOrchestrator } from '../src/features/coachAgent/orchestrator'
import { createCoachToolDispatcher } from '../src/features/coachAgent/dispatcher'
import { createCoachSessionReader } from '../src/features/coachAgent/sessionReader'
import type { ProviderContext } from '../src/features/coachAgent/provider'
import { SESSION_STORAGE_KEY } from '../src/features/training/LocalStorageTrainingSessionRepository'
import { at, makeSession } from './analysis-fixtures'

const ENDPOINT = 'http://127.0.0.1:47831/v1/coach/step'
const BOOTSTRAP = 'test_bootstrap_capability_1234567890'
const SESSION = 'test_session_capability_123456789012'
const ID = 'private-session-owner-name-123'
const EVIDENCE = `warmup:${ID}:squat`
const signal = () => new AbortController().signal
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}
function context(observations: ProviderContext['observations'] = []): ProviderContext {
  return { question: '为什么我这次深蹲评分不高？私密姓名及原始训练信息不要上传', observations, remainingCalls: 4 }
}
function observation(): ProviderContext['observations'][number] {
  return { requestId: 'private-request-id', tool: 'read_scoring_evidence', ok: true, problemCode: null, comparisonGate: null,
    evidence: [{ evidenceId: EVIDENCE, sessionId: ID, subject: { kind: 'exercise', id: 'squat' },
      scoreKind: 'warmup-standard', scoringVersion: 'private-scoring-version', source: 'synthetic' }] }
}
function transport(responder: (wire: RemoteCoachContext) => unknown = () => ({ type: 'answer', mode: 'insufficient', evidenceRefs: [] })) {
  const wire: RemoteCoachContext[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith('/session')) return json({ sessionToken: SESSION, expiresInMs: 300_000 })
    const body = parseRemoteContext(JSON.parse(String(init?.body)))
    wire.push(body)
    return json(responder(body))
  })
  return { wire, fetch: fetch as typeof globalThis.fetch }
}
function provider(fetch: typeof globalThis.fetch, overrides: Partial<RemoteCoachProviderOptions> = {}) {
  return createRemoteCoachProvider({ endpoint: ENDPOINT, accessToken: BOOTSTRAP, enabled: true, consent: true,
    warmupSessionId: ID, fetch, ...overrides })
}
function setup(fetch: typeof globalThis.fetch, authorizedIds = [ID], remoteEnabled = true) {
  const raw = JSON.stringify([makeSession({ id: ID, startedAt: at(2), source: 'synthetic',
    exercises: { squat: { raw: () => ({ maxHipDrop: 0.12, maxTorsoLean: 25 }) } } })])
  const getItem = vi.fn((key: string) => key === SESSION_STORAGE_KEY ? raw : null)
  const reader = createCoachSessionReader({ storage: { getItem }, now: () => at(30) })
  const dispatcher = createCoachToolDispatcher({ reader, now: () => at(30), authorization: {
    principalId: 'fixture-owner', tools: ['read_scoring_evidence'], sessions: { warmup: authorizedIds }, maxHistory: 3,
  } })
  const agent = createCoachOrchestrator({ provider: provider(fetch), dispatcher, remoteEnabled })
  return { agent, dispatcher, getItem }
}
function tools(wire: RemoteCoachContext) {
  return { type: 'tools', calls: [{ tool: 'read_scoring_evidence', query: {
    kind: 'warmup', sessionId: wire.scope.warmupSessionId, subject: { kind: 'exercise', id: 'squat' },
  } }] }
}
function wireContext(): RemoteCoachContext {
  return parseRemoteContext({ mode: 'explain', remainingCalls: 4, scope: { warmupSessionId: 's1', historyLimit: 3 },
    observations: [{ requestId: 'r1', tool: 'read_scoring_evidence', ok: true, problemCode: null, comparisonGate: null,
      evidence: [{ evidenceId: 'e1', sessionId: 's1', subject: { kind: 'exercise', id: 'squat' }, scoreKind: 'warmup-standard' }] }] })
}

describe('Remote Coach application consent and local factual boundary', () => {
  it.each([
    { enabled: undefined }, { enabled: false }, { consent: undefined }, { consent: false },
  ])('makes no request without both explicit enables: %j', async override => {
    const fake = transport()
    const remote = provider(fake.fetch, override)
    await expect(remote.next(context(), { signal: signal() })).rejects.toThrow()
    expect(fake.fetch).not.toHaveBeenCalled()
  })

  it('constructs without requests and requires the separate orchestrator opt-in', async () => {
    const fake = transport()
    provider(fake.fetch)
    expect(fake.fetch).not.toHaveBeenCalled()
    const { agent, getItem } = setup(fake.fetch, [ID], false)
    const answer = await agent.run('深蹲评分为什么不高？')
    expect(answer.problemCode).toBe('PROVIDER_NOT_ALLOWED')
    expect(answer.modelPlanning).toBe('not_completed')
    expect(answer.mock).toBe(false)
    expect(answer.text).not.toContain('MOCK')
    expect(fake.fetch).not.toHaveBeenCalled()
    expect(getItem).not.toHaveBeenCalled()
  })

  it('roundtrips anonymous handles, exchanges once and preserves local IDs and immutable score facts', async () => {
    const fake = transport(wire => wire.observations.length ? { type: 'answer', mode: 'explain',
      evidenceRefs: wire.observations.flatMap(item => item.evidence.map(evidence => ({ requestId: item.requestId, evidenceId: evidence.evidenceId }))) } : tools(wire))
    const { agent } = setup(fake.fetch)
    const answer = await agent.run(context().question)
    expect(answer.status).toBe('answered')
    expect(answer.mock).toBe(false)
    expect(answer.providerKind).toBe('remote')
    expect(answer.modelPlanning).toBe('completed')
    expect(answer.text).toContain('事实由本地证据生成')
    expect(answer.text).toContain('synthetic')
    expect(answer.citations[0]).toMatchObject({ sessionId: ID, evidenceId: EVIDENCE, provenance: { source: 'synthetic' } })
    expect(answer.citations[0].score.value).not.toBe(100)
    expect(Object.isFrozen(answer.citations[0].score)).toBe(true)
    expect(fake.fetch).toHaveBeenCalledTimes(3)
    const calls = vi.mocked(fake.fetch).mock.calls
    expect(calls[0][0]).toBe(ENDPOINT.replace('/step', '/session'))
    expect(calls[0][1]?.body).toBe('{}')
    expect(new Headers(calls[0][1]?.headers).get('Authorization')).toBe(`Bearer ${BOOTSTRAP}`)
    for (const [, init] of calls.slice(1)) {
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${SESSION}`)
      expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
    }
    const serialized = JSON.stringify(fake.wire)
    for (const privateValue of [ID, EVIDENCE, '私密姓名', 'private-request-id', 'source', 'scoringVersion', 'recordPaths', 'components', 'score":']) {
      expect(serialized).not.toContain(privateValue)
    }
    expect(fake.wire[0].scope.warmupSessionId).toBe('s1')
    expect(fake.wire[1].observations[0].requestId).toBe('r1')
    expect(fake.wire[1].observations[0].evidence[0].evidenceId).toBe('e1')
  })

  it('does not grant model-selected tools access outside application authorization', async () => {
    const fake = transport(wire => wire.observations.length ? { type: 'answer', mode: 'insufficient', evidenceRefs: [] } : tools(wire))
    const { agent, getItem } = setup(fake.fetch, [])
    const answer = await agent.run('为什么深蹲评分不高？')
    expect(answer.status).toBe('insufficient')
    expect(answer.calls[0].problemCode).toBe('PERMISSION_DENIED')
    expect(answer.citations).toEqual([])
    expect(getItem).not.toHaveBeenCalled()
  })

  it('reconstructs the network projection without provenance, raw question or local IDs', async () => {
    const fake = transport(wire => ({ type: 'answer', mode: 'explain', evidenceRefs: [{
      requestId: wire.observations[0].requestId, evidenceId: wire.observations[0].evidence[0].evidenceId,
    }] }))
    const result = await provider(fake.fetch).next(context([observation()]), { signal: signal() })
    expect(result).toEqual({ type: 'answer', mode: 'explain', evidenceRefs: [{ requestId: 'private-request-id', evidenceId: EVIDENCE }] })
    expect(JSON.stringify(fake.wire)).not.toMatch(/private|synthetic|version|私密|score":/u)
  })

  it('returns a sanitized failed Remote result without running Mock when the service is unavailable', async () => {
    const fetch = vi.fn(async () => { throw new Error(`private server failure ${BOOTSTRAP}`) })
    const { agent, getItem } = setup(fetch)
    const answer = await agent.run('深蹲评分为什么不高？')
    expect(answer).toMatchObject({ status: 'failed', modelPlanning: 'not_completed', mock: false, problemCode: 'PROVIDER_FAILURE' })
    expect(answer.text).toContain('未完成可信模型规划')
    expect(JSON.stringify(answer)).not.toMatch(/private server|test_bootstrap|MOCK/u)
    expect(getItem).not.toHaveBeenCalled()
  })
})

describe('Remote Coach strict wire grammar', () => {
  it.each([
    'https://127.0.0.1:47831/v1/coach/step', 'http://localhost:47831/v1/coach/step',
    'http://192.168.1.1:47831/v1/coach/step', 'http://127.0.0.1:47831/v1/coach/step?url=evil',
    'http://user:password@127.0.0.1:47831/v1/coach/step', 'http://127.0.0.1:47831/v1/coach/step#secret',
    'http://127.0.0.1:47831/other/../v1/coach/step', 'http://127.0.0.1:47831/jev',
  ])('rejects an untrusted or noncanonical proxy endpoint: %s', endpoint => {
    expect(() => provider(transport().fetch, { endpoint })).toThrow()
  })

  it.each([
    { question: 'raw private question' }, { apiKey: 'never' }, { score: 100 }, { source: 'live' },
  ])('rejects extra context data at the server boundary: %j', extra => {
    expect(() => parseRemoteContext({ ...wireContext(), ...extra })).toThrow()
  })

  it('rejects getters and sparse arrays without evaluating them', () => {
    const getter = vi.fn(() => 'explain')
    const raw = { ...wireContext() }
    Object.defineProperty(raw, 'mode', { get: getter, enumerable: true })
    expect(() => parseRemoteContext(raw)).toThrow()
    expect(getter).not.toHaveBeenCalled()
    expect(() => parseRemoteContext({ ...wireContext(), observations: new Array(1) })).toThrow()
  })

  it.each([
    { type: 'answer', mode: 'explain', evidenceRefs: [], score: 100 },
    { type: 'answer', mode: 'explain', evidenceRefs: [], provenance: { source: 'live' } },
    { type: 'answer', mode: 'explain', evidenceRefs: [], text: '评分100' },
    { type: 'answer', mode: 'explain', evidenceRefs: [{ requestId: 'r2', evidenceId: 'e1' }] },
    { type: 'answer', mode: 'explain', evidenceRefs: [{ requestId: 'r1', evidenceId: 'e2' }] },
    { type: 'answer', mode: 'routine', evidenceRefs: [{ requestId: 'r1', evidenceId: 'e1' }] },
    { type: 'answer', mode: 'insufficient', evidenceRefs: [{ requestId: 'r1', evidenceId: 'e1' }] },
    { type: 'tools', calls: [{ tool: 'delete_session', query: { kind: 'warmup', sessionId: 's1' } }] },
    { type: 'tools', calls: [{ tool: 'read_session', query: { kind: 'warmup', sessionId: 's2', subject: { kind: 'exercise', id: 'squat' } } }] },
    { type: 'tools', calls: [{ tool: 'read_session', query: { kind: 'warmup', sessionId: 's1', subject: { kind: 'exercise', id: 'knee_raise' } } }] },
    { type: 'tools', calls: [{ tool: 'read_session', query: { kind: 'warmup', sessionId: 's1' } }] },
    { type: 'tools', calls: [{ tool: 'read_history', query: { kind: 'warmup', sessionId: 's1', subject: { kind: 'exercise', id: 'squat' }, limit: 64 } }] },
  ])('rejects fabricated facts, evidence or out-of-purpose tool planning %#', step => {
    expect(() => validateRemoteStep(step, wireContext())).toThrow()
  })

  it('requires original history-tool gate references and bounds planned calls by remaining budget', () => {
    const wire = wireContext()
    expect(() => validateRemoteStep({ type: 'answer', mode: 'history', evidenceRefs: [{ requestId: 'r1', evidenceId: 'e1' }] },
      { ...wire, mode: 'history' })).toThrow()
    expect(() => validateRemoteStep(tools(wire), { ...wire, remainingCalls: 0 })).toThrow()
  })
})

describe('Remote Coach bounded HTTP lifetime and one-time capability exchange', () => {
  it.each([
    () => json({ error: 'RATE_LIMITED' }, 429),
    () => json({ error: 'BUDGET_EXCEEDED' }, 402),
    () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('not-json', { headers: { 'Content-Type': 'text/plain' } }),
    () => json({ sessionToken: SESSION, expiresInMs: 300_001 }),
    () => json({ sessionToken: SESSION, expiresInMs: 300_000, extra: 'untrusted' }),
    () => new Response('x'.repeat(REMOTE_STEP_MAX_BYTES + 1), { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '999999999' } }),
  ])('rejects malformed/failed/over-budget handshake responses without retry %#', async response => {
    const fetch = vi.fn(async () => response())
    const remote = provider(fetch)
    await expect(remote.next(context(), { signal: signal() })).rejects.toThrow('REMOTE_PROVIDER_FAILURE')
    await expect(remote.next(context(), { signal: signal() })).rejects.toThrow('REMOTE_PROVIDER_FAILURE')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('shares a single one-time exchange across concurrent calls', async () => {
    const fake = transport()
    const remote = provider(fake.fetch)
    await Promise.all([remote.next(context(), { signal: signal() }), remote.next(context(), { signal: signal() })])
    expect(vi.mocked(fake.fetch).mock.calls.filter(([url]) => String(url).endsWith('/session'))).toHaveLength(1)
    expect(fake.wire).toHaveLength(2)
  })

  it.each([
    () => json({ error: 'RATE_LIMITED' }, 429),
    () => json({ error: 'BUDGET_EXCEEDED' }, 402),
    () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('upstream-private-information', { headers: { 'Content-Type': 'text/plain' } }),
    () => new Response('x'.repeat(REMOTE_STEP_MAX_BYTES + 1), { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '999999999' } }),
    () => {
      const response = json({ type: 'answer', mode: 'insufficient', evidenceRefs: [] })
      Object.defineProperty(response, 'redirected', { value: true })
      return response
    },
  ])('rejects step HTTP anomalies after a valid session without accepting a result %#', async response => {
    const fetch = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/session')
      ? json({ sessionToken: SESSION, expiresInMs: 300_000 }) : response())
    const { agent, getItem } = setup(fetch)
    const answer = await agent.run('为什么深蹲评分不高？')
    expect(answer).toMatchObject({ status: 'failed', modelPlanning: 'not_completed', problemCode: 'PROVIDER_FAILURE' })
    expect(JSON.stringify(answer)).not.toContain('upstream-private-information')
    expect(answer.citations).toEqual([])
    expect(getItem).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('refuses an expired in-memory session without rehandshake', async () => {
    let elapsed = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
    try {
      const fake = transport()
      const remote = provider(fake.fetch)
      await remote.next(context(), { signal: signal() })
      elapsed = 300_001
      await expect(remote.next(context(), { signal: signal() })).rejects.toThrow()
      expect(fake.fetch).toHaveBeenCalledTimes(2)
    } finally { clock.mockRestore() }
  })

  it('honors pre-cancellation before exchanging the capability', async () => {
    const fake = transport()
    const controller = new AbortController()
    controller.abort()
    await expect(provider(fake.fetch).next(context(), { signal: controller.signal })).rejects.toThrow()
    expect(fake.fetch).not.toHaveBeenCalled()
  })

  it('cancels an uncooperative handshake and never issues a late model step or retries it', async () => {
    let release!: (response: Response) => void
    let transportSignal: AbortSignal | undefined
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      transportSignal = init?.signal ?? undefined
      return new Promise<Response>(resolve => { release = resolve })
    })
    const remote = provider(fetch)
    const controller = new AbortController()
    const pending = remote.next(context(), { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(transportSignal?.aborted).toBe(true)
    release(json({ sessionToken: SESSION, expiresInMs: 300_000 }))
    await expect(remote.next(context(), { signal: signal() })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('bounds a stalled transport even when it ignores AbortSignal', async () => {
    vi.useFakeTimers()
    try {
      let transportSignal: AbortSignal | undefined
      const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        transportSignal = init?.signal ?? undefined
        return new Promise<Response>(() => undefined)
      })
      const pending = provider(fetch, { timeoutMs: 10 }).next(context(), { signal: signal() })
      const rejected = expect(pending).rejects.toThrow('REMOTE_PROVIDER_FAILURE')
      await vi.advanceTimersByTimeAsync(11)
      await rejected
      expect(transportSignal?.aborted).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('cancels an in-flight model step and discards a late tool plan before storage access', async () => {
    let release!: (response: Response) => void
    let stepSignal: AbortSignal | undefined
    let stepStarted!: () => void
    const started = new Promise<void>(resolve => { stepStarted = resolve })
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/session')) return json({ sessionToken: SESSION, expiresInMs: 300_000 })
      stepSignal = init?.signal ?? undefined
      stepStarted()
      return new Promise<Response>(resolve => { release = resolve })
    })
    const { agent, getItem } = setup(fetch)
    const controller = new AbortController()
    const pending = agent.run('为什么深蹲评分不高？', { signal: controller.signal })
    await started
    controller.abort()
    const answer = await pending
    expect(answer).toMatchObject({ status: 'cancelled', modelPlanning: 'not_completed' })
    expect(stepSignal?.aborted).toBe(true)
    release(json(tools(wireContext())))
    await Promise.resolve()
    expect(getItem).not.toHaveBeenCalled()
    expect(answer.calls).toEqual([])
  })

  it('rejects model fabrication after an otherwise valid exchange before any local read', async () => {
    const fake = transport(() => ({ type: 'tools', calls: [{ tool: 'read_session',
      query: { kind: 'warmup', sessionId: 's1', subject: { kind: 'exercise', id: 'squat' } }, result: { score: 100, source: 'live' } }] }))
    const { agent, getItem } = setup(fake.fetch)
    const answer = await agent.run('为什么深蹲评分不高？')
    expect(answer).toMatchObject({ status: 'failed', modelPlanning: 'not_completed' })
    expect(answer.citations).toEqual([])
    expect(getItem).not.toHaveBeenCalled()
  })
})
