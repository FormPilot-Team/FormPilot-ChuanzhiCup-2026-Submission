import { describe, expect, it, vi } from 'vitest'
import { createCoachToolDispatcher } from '../src/features/coachAgent/dispatcher'
import type { CoachAuthorization, DispatcherOptions, ToolIntent } from '../src/features/coachAgent/dispatchTypes'
import { withinLifetime } from '../src/features/coachAgent/execution'
import { createCoachSessionReader } from '../src/features/coachAgent/sessionReader'
import type { ReaderResult, SessionSnapshot } from '../src/features/coachAgent/readerTypes'
import { SESSION_STORAGE_KEY } from '../src/features/training/LocalStorageTrainingSessionRepository'
import { at, makeSession } from './analysis-fixtures'

const NOW = at(30)
const squat = { kind: 'exercise' as const, id: 'squat' as const }
function intent(tool: ToolIntent['tool'] = 'read_session', sessionId: string | null = 'current'): ToolIntent {
  return { tool, query: { kind: 'warmup', ...(sessionId ? { sessionId } : {}) } }
}
function setup(raw: string | null = JSON.stringify([makeSession({ id: 'current', source: 'synthetic', startedAt: at(2) })]), overrides: Partial<DispatcherOptions> = {}) {
  const storage = { getItem: vi.fn((key: string) => key === SESSION_STORAGE_KEY ? raw : null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() }
  const reader = createCoachSessionReader({ storage, now: () => NOW })
  const authorization: CoachAuthorization = { principalId: 'user-a', tools: ['read_session', 'read_history', 'read_scoring_evidence'], sessions: { warmup: ['current', 'before'] }, maxHistory: 5 }
  const dispatcher = createCoachToolDispatcher({ reader, authorization, now: () => NOW, ...overrides })
  return { reader, dispatcher, storage, raw, authorization }
}

describe('coach dispatcher application authorization and intent binding', () => {
  it('fails without explicit authorization before touching storage', async () => {
    const { dispatcher, storage } = setup(undefined, { authorization: undefined })
    expect((await dispatcher.dispatch(intent())).problem?.code).toBe('PERMISSION_DENIED')
    expect(storage.getItem).not.toHaveBeenCalled()
  })

  it.each([
    { principalId: '', tools: ['read_session'], sessions: { warmup: ['current'] }, maxHistory: 5 },
    { principalId: 'user-a', tools: ['draft_plan'], sessions: { warmup: ['current'] }, maxHistory: 5 },
    { principalId: 'user-a', tools: ['read_session'], sessions: { warmup: ['current'] }, maxHistory: 0 },
  ])('rejects malformed application authorization %j', async authorization => {
    const { dispatcher, storage } = setup(undefined, { authorization: authorization as CoachAuthorization })
    expect((await dispatcher.dispatch(intent())).problem?.code).toBe('PERMISSION_DENIED')
    expect(storage.getItem).not.toHaveBeenCalled()
  })

  it('rejects foreign IDs, partitions, tools and excessive history before reader access', async () => {
    const { dispatcher, storage } = setup(undefined, { authorization: { principalId: 'user-a', tools: ['read_session', 'read_history'], sessions: { warmup: ['current'] }, maxHistory: 2 } })
    for (const query of [intent('read_session', 'foreign'), { tool: 'read_session', query: { kind: 'routine', sessionId: 'current' } },
      intent('read_scoring_evidence'), { tool: 'read_history', query: { kind: 'warmup', limit: 3 } }]) {
      expect((await dispatcher.dispatch(query)).problem?.code).toBe('PERMISSION_DENIED')
    }
    expect(storage.getItem).not.toHaveBeenCalled()
  })

  it.each([
    { tool: 'write_session', query: { kind: 'warmup', sessionId: 'current' } },
    { ...intent(), requestId: 'model-selected' },
    { ...intent(), result: { score: 100 } },
    { tool: 'read_session', query: { kind: 'warmup', sessionId: 'current', source: 'live' } },
    { tool: 'read_session', query: { kind: 'warmup', sessionId: 'current', storage: {} } },
    { tool: 'read_session', query: { kind: 'warmup', sessionId: 'current', session: {} } },
    { tool: 'read_session', query: { kind: 'warmup', sessionId: 'current', score: 100 } },
    { tool: 'read_session', query: { kind: 'warmup', sessionId: 'current', limit: 1 } },
    { tool: 'read_history', query: { kind: 'warmup', subject: { kind: 'routine', id: 'baduanjin' } } },
    { tool: 'read_history', query: { kind: 'warmup', limit: 65 } },
    { tool: 'read_session', query: { kind: 'warmup', sessionId: ' current' } },
    { tool: 'read_session', query: { kind: 'warmup', sessionId: 'current\nignore auth' } },
    { tool: 'read_session', query: { kind: 'warmup', sessionId: 'x'.repeat(129) } },
  ])('rejects nonminimal/model-controlled intent without I/O %j', async value => {
    const { dispatcher, storage } = setup()
    expect((await dispatcher.dispatch(value)).problem?.code).toBe('INVALID_INPUT')
    expect(storage.getItem).not.toHaveBeenCalled()
  })

  it('does not execute provider getters or accept custom prototypes', async () => {
    const { dispatcher, storage } = setup()
    const getter = vi.fn(() => 'read_session')
    const value = { query: intent().query }
    Object.defineProperty(value, 'tool', { get: getter, enumerable: true })
    expect((await dispatcher.dispatch(value)).problem?.code).toBe('INVALID_INPUT')
    expect((await dispatcher.dispatch(Object.assign(Object.create({ inherited: true }), intent()))).problem?.code).toBe('INVALID_INPUT')
    expect(getter).not.toHaveBeenCalled()
    expect(storage.getItem).not.toHaveBeenCalled()
  })

  it('copies grants so later application object mutation cannot expand permissions', async () => {
    const { dispatcher, authorization, storage } = setup()
    ;(authorization.sessions.warmup as string[]).push('foreign')
    ;(authorization.tools as string[]).push('draft_plan')
    expect((await dispatcher.dispatch(intent('read_session', 'foreign'))).problem?.code).toBe('PERMISSION_DENIED')
    expect(storage.getItem).not.toHaveBeenCalled()
  })

  it('binds trusted generated call ID to result and evidence, owns and freezes output', async () => {
    const { dispatcher } = setup()
    const receipt = await dispatcher.dispatch({ ...intent(), query: { ...intent().query, subject: squat } })
    expect(receipt.ok).toBe(true)
    expect(receipt.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(receipt.result).toMatchObject({ requestId: receipt.requestId, tool: 'read_session', ok: true })
    expect(receipt.evidence).toHaveLength(1)
    expect(receipt.evidence[0]).toMatchObject({ requestId: receipt.requestId, sessionId: 'current', scoreKind: 'warmup-standard', provenance: { source: 'synthetic' } })
    expect(receipt.evidence[0].recordPaths[0]).toMatch(/^\$\.exercises\[/)
    expect(dispatcher.owns(receipt)).toBe(true)
    expect(dispatcher.owns(structuredClone(receipt))).toBe(false)
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.result)).toBe(true)
    expect(Object.isFrozen(receipt.details)).toBe(true)
  })
})

describe('coach dispatcher reader trust and failure semantics', () => {
  it.each(['{broken', '[null]', JSON.stringify([{ schemaVersion: 2, id: 'broken' }])])('preserves CORRUPT internally and never claims empty history: %s', async raw => {
    const { dispatcher } = setup(raw)
    const receipt = await dispatcher.dispatch(intent('read_history', null))
    expect(receipt.ok).toBe(false)
    expect(receipt.problem).toMatchObject({ code: 'CORRUPT', readerProblem: { code: 'CORRUPT' } })
    expect(receipt.result).toMatchObject({ ok: false, data: null, error: { code: 'UNAVAILABLE' } })
    expect(receipt.evidence).toEqual([])
  })

  it('keeps absent session and legitimate empty authorized history distinct', async () => {
    const { dispatcher } = setup(null)
    const missing = await dispatcher.dispatch(intent())
    expect(missing.problem?.code).toBe('NOT_FOUND')
    const empty = await dispatcher.dispatch(intent('read_history', null))
    expect(empty.ok).toBe(true)
    expect(empty.result).toMatchObject({ ok: true, tool: 'read_history', data: [] })
  })

  it('retains the reader corruption cause even if the tool envelope clock fails', async () => {
    const { dispatcher } = setup('{broken', { now: () => { throw new Error('private clock error') } })
    const receipt = await dispatcher.dispatch(intent())
    expect(receipt.problem).toMatchObject({ code: 'CORRUPT', readerProblem: { code: 'CORRUPT' } })
    expect(receipt.result).toBeNull()
    expect(JSON.stringify(receipt)).not.toContain('private clock error')
  })

  it('returns no history only when explicit empty ID authorization permits an empty result', async () => {
    const { dispatcher, storage } = setup('{corrupt', { authorization: { principalId: 'new-user', tools: ['read_history'], sessions: { warmup: [] }, maxHistory: 5 } })
    expect((await dispatcher.dispatch(intent('read_history', null))).result).toMatchObject({ ok: true, data: [] })
    expect(storage.getItem).not.toHaveBeenCalled()
  })

  it('distinguishes unsupported persisted version and insufficient samples', async () => {
    const badVersion = setup(JSON.stringify([{ ...makeSession({ id: 'current', startedAt: at(2) }), schemaVersion: 99 }]))
    expect((await badVersion.dispatcher.dispatch(intent())).problem?.code).toBe('UNSUPPORTED_VERSION')
    const short = makeSession({ id: 'current', startedAt: at(2), source: 'synthetic', include: ['squat'], exerciseOrder: ['squat'], exercises: { squat: { reps: 0 } } })
    const insufficient = setup(JSON.stringify([short]))
    expect((await insufficient.dispatcher.dispatch(intent('read_scoring_evidence'))).problem?.code).toBe('INSUFFICIENT_DATA')
  })

  it('does not leak storage exceptions or report them as empty', async () => {
    const { dispatcher, storage } = setup()
    storage.getItem.mockImplementation(() => { throw new Error('secret raw file path') })
    const receipt = await dispatcher.dispatch(intent())
    expect(receipt.problem?.code).toBe('UNAVAILABLE')
    expect(JSON.stringify(receipt)).not.toContain('secret raw file path')
  })

  it('fails closed on an unknown reader exception', async () => {
    const { reader } = setup()
    vi.spyOn(reader, 'readSession').mockImplementation(() => { throw 'secret reader error' })
    const { dispatcher } = setup(undefined, { reader })
    const receipt = await dispatcher.dispatch(intent())
    expect(receipt.problem?.code).toBe('UNAVAILABLE')
    expect(JSON.stringify(receipt)).not.toContain('secret reader error')
  })

  it('normalizes unknown returned reader error codes without exposing their payload', async () => {
    const { reader } = setup()
    vi.spyOn(reader, 'readSession').mockReturnValue({ ok: false,
      error: { code: 'PRIVATE_RAW_RECORD_CONTENT', path: '$secret', message: 'private reader payload' },
    } as unknown as ReaderResult<SessionSnapshot>)
    const { dispatcher } = setup(undefined, { reader })
    const receipt = await dispatcher.dispatch(intent())
    expect(receipt.problem).toMatchObject({ code: 'UNAVAILABLE' })
    expect(receipt.problem?.readerProblem).toBeUndefined()
    expect(JSON.stringify(receipt)).not.toContain('PRIVATE_RAW_RECORD_CONTENT')
    expect(JSON.stringify(receipt)).not.toContain('private reader payload')
    expect(JSON.stringify(receipt)).not.toContain('$secret')
  })

  it('rejects a JSON-cloned snapshot despite a forged trust label', async () => {
    const { reader } = setup()
    const valid = reader.readSession('warmup', 'current')
    vi.spyOn(reader, 'readSession').mockReturnValue(structuredClone(valid))
    const { dispatcher } = setup(undefined, { reader })
    expect((await dispatcher.dispatch(intent())).problem?.code).toBe('NOT_ALLOWED')
  })

  it('rejects genuine owned data returned for the wrong authorized query ID', async () => {
    const raw = JSON.stringify([makeSession({ id: 'current', startedAt: at(2) }), makeSession({ id: 'before', startedAt: at(1) })])
    const { reader } = setup(raw)
    const wrongSession = reader.readSession('warmup', 'before')
    const wrongEvidence = reader.readScoringEvidence('warmup', 'before')
    vi.spyOn(reader, 'readSession').mockReturnValue(wrongSession)
    vi.spyOn(reader, 'readScoringEvidence').mockReturnValue(wrongEvidence)
    const { dispatcher } = setup(raw, { reader })
    expect((await dispatcher.dispatch(intent())).problem?.code).toBe('NOT_ALLOWED')
    expect((await dispatcher.dispatch(intent('read_scoring_evidence'))).problem?.code).toBe('NOT_ALLOWED')
  })

  it('projects requested evidence and retains real zero rather than fabricating results', async () => {
    const record = makeSession({ id: 'current', startedAt: at(2), source: 'synthetic' })
    record.exercises.find(item => item.exerciseId === 'squat')!.repetitions.forEach(item => { item.score = 0 })
    const { dispatcher } = setup(JSON.stringify([record]))
    const receipt = await dispatcher.dispatch({ tool: 'read_scoring_evidence', query: { kind: 'warmup', sessionId: 'current', subject: squat } })
    expect(receipt.ok).toBe(true)
    expect(receipt.result).toMatchObject({ data: [{ subject: squat, score: { value: 0, scoreKind: 'warmup-standard' } }] })
    expect(receipt.details).toHaveLength(1)
  })

  it('leaves raw source data and storage write methods unchanged', async () => {
    const record = makeSession({ id: 'current', startedAt: at(2), source: 'synthetic' })
    const before = structuredClone(record)
    const raw = JSON.stringify([record])
    const { dispatcher, storage } = setup(raw)
    await dispatcher.dispatch(intent()); await dispatcher.dispatch(intent('read_history', null)); await dispatcher.dispatch(intent('read_scoring_evidence'))
    expect(record).toEqual(before)
    expect(JSON.stringify([record])).toBe(raw)
    expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled(); expect(storage.clear).not.toHaveBeenCalled()
  })
})

describe('coach dispatcher authorized history and native comparison gate', () => {
  it('lists authorized history even when newer foreign records precede it', async () => {
    const raw = JSON.stringify([makeSession({ id: 'current', startedAt: at(2) }), makeSession({ id: 'foreign', startedAt: at(3) })])
    const { dispatcher } = setup(raw)
    const receipt = await dispatcher.dispatch({ tool: 'read_history', query: { kind: 'warmup', subject: squat, limit: 1 } })
    expect(receipt.ok).toBe(true)
    expect(receipt.result).toMatchObject({ data: [{ sessionId: 'current', evidence: [{ subject: squat }] }] })
    expect(JSON.stringify(receipt)).not.toContain('foreign')
  })

  it('does not invoke comparison when the complete partition includes foreign sessions', async () => {
    const raw = JSON.stringify([makeSession({ id: 'current', startedAt: at(2) }), makeSession({ id: 'foreign', startedAt: at(1) })])
    const { reader } = setup(raw)
    const compare = vi.spyOn(reader, 'compareHistory')
    const { dispatcher } = setup(raw, { reader })
    const receipt = await dispatcher.dispatch(intent('read_history'))
    expect(receipt.problem?.code).toBe('PERMISSION_DENIED')
    expect(compare).not.toHaveBeenCalled()
    expect(JSON.stringify(receipt)).not.toContain('foreign')
  })

  it('preserves NONE for clearly synthetic demonstration data', async () => {
    const { dispatcher } = setup()
    const receipt = await dispatcher.dispatch({ tool: 'read_history', query: { kind: 'warmup', sessionId: 'current', subject: squat, limit: 2 } })
    expect(receipt.ok).toBe(true)
    expect(receipt.comparison).toMatchObject({ gate: 'NONE', reason: 'CURRENT_PROVENANCE_NOT_VERIFIED_LIVE_NORMAL', previous: [] })
    expect(receipt.limitations.some(item => item.startsWith('HISTORY_NOT_COMPARABLE:'))).toBe(true)
  })

  it('retains original native FULL gate without recomputing a cross-kind score', async () => {
    const raw = JSON.stringify([makeSession({ id: 'before', startedAt: at(1) }), makeSession({ id: 'current', startedAt: at(2) })])
    const { dispatcher, reader } = setup(raw)
    const native = reader.compareHistory({ kind: 'warmup', sessionId: 'current', subject: squat, limit: 2 })
    const receipt = await dispatcher.dispatch({ tool: 'read_history', query: { kind: 'warmup', sessionId: 'current', subject: squat, limit: 2 } })
    expect(receipt.ok).toBe(true)
    expect(receipt.comparison).toEqual(native.ok ? native.data : null)
    expect(receipt.comparison?.gate).toBe('FULL')
    expect(receipt.evidence.every(item => item.scoreKind === 'warmup-standard')).toBe(true)
  })

  it('detects foreign records introduced between preflight and native comparison', async () => {
    const original = [makeSession({ id: 'before', startedAt: at(1) }), makeSession({ id: 'current', startedAt: at(2) })]
    const changed = [...original, makeSession({ id: 'foreign-secret', startedAt: at(1.5), mode: 'fast' })]
    let reads = 0
    const storage = { getItem: () => JSON.stringify(++reads === 1 ? original : changed) }
    const reader = createCoachSessionReader({ storage, now: () => NOW })
    const { dispatcher } = setup(undefined, { reader })
    const receipt = await dispatcher.dispatch(intent('read_history'))
    expect(receipt.ok).toBe(false)
    expect(receipt.problem?.code).toBe('PERMISSION_DENIED')
    expect(JSON.stringify(receipt)).not.toContain('foreign-secret')
    expect(receipt.comparison).toBeNull()
  })

  it('rejects transient changed comparison observations even when the store reverts afterward', async () => {
    const original = [makeSession({ id: 'before', startedAt: at(1) }), makeSession({ id: 'current', startedAt: at(2) })]
    const changed = structuredClone(original)
    changed[1].exercises.find(item => item.exerciseId === 'squat')!.repetitions.forEach(item => { item.score = 0 })
    let reads = 0
    const reader = createCoachSessionReader({ storage: { getItem: () => JSON.stringify(++reads === 2 ? changed : original) }, now: () => NOW })
    const { dispatcher } = setup(undefined, { reader })
    const receipt = await dispatcher.dispatch(intent('read_history'))
    expect(receipt.problem?.code).toBe('UNAVAILABLE')
    expect(receipt.comparison).toBeNull()
    expect(receipt.evidence).toEqual([])
  })
})

describe('coach dispatcher bounded call lifetime and replay protection', () => {
  it('reserves simultaneous duplicates once and binds request IDs independently', async () => {
    const { dispatcher, storage } = setup()
    const [first, second] = await Promise.all([dispatcher.dispatch(intent()), dispatcher.dispatch(intent())])
    expect(first.ok).toBe(true)
    expect(second.problem?.code).toBe('DUPLICATE_CALL')
    expect(first.requestId).not.toBe(second.requestId)
    expect(storage.getItem).toHaveBeenCalledTimes(1)
    expect(dispatcher.remainingCalls()).toBe(7)
  })

  it('normalizes property order and default history limit for duplicate detection', async () => {
    const { dispatcher } = setup()
    await dispatcher.dispatch({ tool: 'read_history', query: { kind: 'warmup', subject: squat } })
    const replay = await dispatcher.dispatch({ query: { limit: 5, subject: { id: 'squat', kind: 'exercise' }, kind: 'warmup' }, tool: 'read_history' })
    expect(replay.problem?.code).toBe('DUPLICATE_CALL')
  })

  it('exhausts tool budget without additional storage reads', async () => {
    const { dispatcher, storage } = setup(undefined, { maxCalls: 1 })
    await dispatcher.dispatch(intent())
    expect((await dispatcher.dispatch(intent('read_scoring_evidence'))).problem?.code).toBe('BUDGET_EXCEEDED')
    expect(storage.getItem).toHaveBeenCalledTimes(1)
  })

  it('cancels before read while preserving reservation and budget', async () => {
    const { dispatcher, storage } = setup()
    const controller = new AbortController(); controller.abort()
    expect((await dispatcher.dispatch(intent(), { signal: controller.signal })).problem?.code).toBe('CANCELLED')
    expect(storage.getItem).not.toHaveBeenCalled()
    expect((await dispatcher.dispatch(intent())).problem?.code).toBe('DUPLICATE_CALL')
    expect(dispatcher.remainingCalls()).toBe(7)
  })

  it('discards evidence when cancellation happens during a synchronous reader', async () => {
    const controller = new AbortController()
    const { reader, storage } = setup()
    const original = storage.getItem.getMockImplementation()!
    storage.getItem.mockImplementation(key => { const value = original(key); controller.abort(); return value })
    const { dispatcher } = setup(undefined, { reader })
    const receipt = await dispatcher.dispatch(intent(), { signal: controller.signal })
    expect(receipt.problem?.code).toBe('CANCELLED')
    expect(receipt.evidence).toEqual([])
    expect(receipt.result).toMatchObject({ ok: false, data: null })
  })

  it('discards results when cancellation occurs during final envelope construction', async () => {
    const controller = new AbortController()
    const { dispatcher } = setup(undefined, { now: () => { controller.abort(); return NOW } })
    const receipt = await dispatcher.dispatch(intent(), { signal: controller.signal })
    expect(receipt.problem?.code).toBe('CANCELLED')
    expect(receipt.result).toMatchObject({ ok: false, data: null })
    expect(receipt.evidence).toEqual([])
  })

  it('detects elapsed synchronous execution and rejects a late result without claiming preemption', async () => {
    const { reader, storage } = setup()
    const original = storage.getItem.getMockImplementation()!
    const clock = vi.spyOn(performance, 'now')
    let elapsed = 0
    clock.mockImplementation(() => elapsed)
    storage.getItem.mockImplementation(key => { const value = original(key); elapsed = 20; return value })
    try {
      const { dispatcher } = setup(undefined, { reader, timeoutMs: 10 })
      const receipt = await dispatcher.dispatch(intent())
      expect(receipt.problem?.code).toBe('TIMEOUT')
      expect(receipt.evidence).toEqual([])
      expect(dispatcher.remainingCalls()).toBe(7)
    } finally { clock.mockRestore() }
  })

  it('cooperatively times out an asynchronous operation and rejects stale completion', async () => {
    let complete: (() => void) | undefined
    const delayed = new Promise<string>(resolve => { complete = () => resolve('late secret evidence') })
    await expect(withinLifetime(() => delayed, { timeoutMs: 5, now: () => performance.now() })).rejects.toMatchObject({ code: 'TIMEOUT' })
    complete!()
  })

  it('rejects an envelope that finishes after the deadline', async () => {
    const clock = vi.spyOn(performance, 'now')
    let elapsed = 0
    clock.mockImplementation(() => elapsed)
    try {
      const { dispatcher } = setup(undefined, { timeoutMs: 10, now: () => { elapsed = 20; return NOW } })
      const receipt = await dispatcher.dispatch(intent())
      expect(receipt.problem?.code).toBe('TIMEOUT')
      expect(receipt.result).toMatchObject({ ok: false, data: null })
      expect(receipt.evidence).toEqual([])
    } finally { clock.mockRestore() }
  })

  it('cooperatively cancels an asynchronous operation', async () => {
    const controller = new AbortController()
    const pending = withinLifetime(() => new Promise<never>(() => {}), { signal: controller.signal, timeoutMs: 100, now: () => performance.now() })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
  })
})
