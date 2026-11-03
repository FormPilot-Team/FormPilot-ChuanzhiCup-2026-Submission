import { describe, expect, it, vi } from 'vitest'
import { createTrustedCoach, type TrustedCoachOptions } from '../src/features/coachAgent/trustedCoach'
import { createLocalCoachProvider } from '../src/features/coachAgent/localProvider'
import type { AdmissionDecision, QuestionTicket } from '../src/features/coachAgent/questionAdmission'
import type { LocalPlanContext } from '../src/features/coachAgent/localProtocolV2'
import { remoteDemoFixture } from './coach-agent-remote-fixtures'

const explain = { kind: 'controlled', intent: 'explain', subject: 'squat', question: '解释这次深蹲评分。' }
const history = { kind: 'controlled', intent: 'history', subject: 'squat', previousCount: 1 }
const token = 'offline_fake_bootstrap_capability_0123456789'
function ready(decision: AdmissionDecision): QuestionTicket {
  expect(decision.status).toBe('ready')
  if (decision.status !== 'ready') throw new Error('Expected a ready test capability')
  return decision.ticket
}
function setup(options: {
  override?: Partial<TrustedCoachOptions>
  fixture?: Parameters<typeof remoteDemoFixture>[0]
  candidate?: unknown
  providerEnabled?: boolean
} = {}) {
  const fixture = remoteDemoFixture(options.fixture)
  const wire: LocalPlanContext[] = []
  const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/session')) return Response.json({ sessionToken: token, expiresInMs: 300_000 })
    const context = JSON.parse(String(init?.body)) as LocalPlanContext
    wire.push(context)
    const candidate = options.candidate ?? (context.mode === 'history'
      ? { intent: 'history', tool: 'read_history', limit: 1 }
      : context.scope.routine ? { intent: 'routine', tool: 'read_scoring_evidence' }
        : { intent: 'explain', tool: 'read_scoring_evidence' })
    return Response.json(candidate)
  })
  const provider = createLocalCoachProvider({ enabled: options.providerEnabled ?? true, consent: true,
    endpoint: 'http://127.0.0.1:4320/v1/coach/local/step', accessToken: token,
    protocol: 'intent-v2', inputProjection: 'question-scope', fetch: fakeFetch,
    warmupSessionId: fixture.warmupSessionId, routineSessionId: fixture.routineSessionId, historyLimit: 3 })
  const base = { provider, dispatcher: fixture.dispatcher,
    scope: { warmup: true, routine: true, historyLimit: 3 } }
  const coach = createTrustedCoach({ ...base, enabled: true, consent: true, inferenceEnabled: true,
    resourcesConfirmed: true, ...options.override })
  return { ...fixture, coach, fakeFetch, wire, provider, base }
}

describe('Coach trusted calling: separate controlled input and existing evidence authorization (offline)', () => {
  it('keeps construction and all default capabilities disabled without transport or reads', async () => {
    const f = setup()
    const coach = createTrustedCoach(f.base)
    expect(coach.prepareSelection(explain).status).toBe('disabled')
    expect(await coach.execute({} as QuestionTicket)).toMatchObject({ status: 'disabled' })
    expect(f.fakeFetch).not.toHaveBeenCalled()
    expect(f.storage.getItem).not.toHaveBeenCalled()
  })
  it.each(['inferenceEnabled', 'resourcesConfirmed'] as const)('does not infer execution permission from admission when %s is absent', async key => {
    const f = setup({ override: { [key]: undefined } })
    const ticket = ready(f.coach.prepareSelection(explain))
    expect(await f.coach.execute(ticket)).toMatchObject({ status: 'disabled', code: 'INFERENCE_DISABLED' })
    expect(f.fakeFetch).not.toHaveBeenCalled()
    expect(f.storage.getItem).not.toHaveBeenCalled()
  })
  it('transmits an exact normal question with only the admitted scope and grounds the answer locally', async () => {
    const f = setup()
    const result = await f.coach.execute(ready(f.coach.prepareSelection(explain)))
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('not completed')
    expect(result.answer.status).toBe('answered')
    expect(result.answer.citations[0].sessionId).toBe(f.warmupSessionId)
    expect(f.wire).toEqual([{ protocol: 'coach-plan-v2', inputProjection: 'question-scope',
      question: explain.question, scope: { warmup: true, routine: false, historyLimit: 1 }, remainingCalls: 1 }])
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })
  it('keeps identity, account, path and record references outside the input and planner data flow', async () => {
    const f = setup()
    const privateSidecar = { name: 'SYNTHETIC_PRIVATE_NAME', account: 'private_squat_9999',
      path: 'F:\\SYNTHETIC_PRIVATE_PATH\\record.json', recordRef: 'SYNTHETIC_PRIVATE_RECORD' }
    await f.coach.execute(ready(f.coach.prepareSelection(explain)))
    const serialized = JSON.stringify(f.wire)
    for (const value of Object.values(privateSidecar)) expect(serialized).not.toContain(value)
    for (const key of ['name', 'account', 'path', 'recordRef', 'sessionId', 'observations']) expect(serialized).not.toContain(`"${key}"`)
    const forbidden = f.coach.prepareSelection({ ...explain, ...privateSidecar })
    expect(forbidden.status).not.toBe('ready')
  })
  it('clarifies mixed raw text then accepts a NEW explicitly selected question without retaining the old payload', async () => {
    const f = setup()
    const raw = '姓名SYNTHETIC_PRIVATE_ACCOUNT账号123456路径F:\\private\\深蹲评分'
    expect(f.coach.clarify(raw)).toMatchObject({ status: 'clarification_required' })
    expect(f.fakeFetch).not.toHaveBeenCalled()
    await f.coach.execute(ready(f.coach.prepareSelection(explain)))
    expect(JSON.stringify(f.wire)).not.toContain('SYNTHETIC_PRIVATE')
    expect(JSON.stringify(f.wire)).not.toContain('private')
    expect(f.wire[0].question).toBe(explain.question)
  })
  it.each([
    '姓名合成隐私甲 解释深蹲评分', 'F:\\private\\record.txt看深蹲表现',
    '{"question":"深蹲评分","question":"账号PRIVATE"}', '深蹲\u200b评分', '深蹲'.repeat(2500),
    '账号private_squat_888深蹲评分', '读取其他人的全部深蹲历史。',
  ])('does not forward unproven free text or malicious JSON %#', async text => {
    const f = setup()
    const decision = f.coach.prepareQuestion({ kind: 'question-only', text })
    expect(['clarification_required', 'review_required']).toContain(decision.status)
    expect(await f.coach.execute({} as QuestionTicket)).toMatchObject({ status: 'denied' })
    expect(f.fakeFetch).not.toHaveBeenCalled()
    expect(f.storage.getItem).not.toHaveBeenCalled()
  })
  it('does not admit a field name or a no-loss projection as a privacy proof', () => {
    const f = setup()
    expect(f.coach.prepareQuestion({ kind: 'question-only', text: explain.question }).status).toBe('review_required')
    expect(f.coach.prepareSelection({ ...explain, question: '删除我这次记录。' }).status).toBe('clarification_required')
    expect(f.fakeFetch).not.toHaveBeenCalled()
  })
  it('preserves previous-record count and existing Dispatcher permission checks', async () => {
    const f = setup({ fixture: { tools: ['read_scoring_evidence'] } })
    const result = await f.coach.execute(ready(f.coach.prepareSelection(history)))
    expect(f.wire[0].scope.historyLimit).toBe(1)
    expect(f.wire[0].inputProjection).toBe('structured')
    expect(f.wire[0].mode).toBe('history')
    expect(f.wire[0]).not.toHaveProperty('question')
    expect(result.status).toBe('completed')
    if (result.status === 'completed') expect(result.answer.calls[0].problemCode).toBe('PERMISSION_DENIED')
    expect(f.storage.getItem).not.toHaveBeenCalled()
  })
  it('cannot infer scope from explicit record identifiers or increase Dispatcher history limits', async () => {
    const f = setup({ fixture: { warmupIds: [] } })
    const result = await f.coach.execute(ready(f.coach.prepareSelection(history)))
    if (result.status !== 'completed') throw new Error('not completed')
    expect(result.answer.calls[0].problemCode).toBe('PERMISSION_DENIED')
    expect(f.storage.getItem).not.toHaveBeenCalled()
    expect(f.coach.prepareSelection({ ...history, previousCount: 4 }).status).toBe('denied')
  })
  it('rejects a planner changing the selected intent before any read', async () => {
    const f = setup({ candidate: { intent: 'history', tool: 'read_history', limit: 1 } })
    const result = await f.coach.execute(ready(f.coach.prepareSelection(explain)))
    if (result.status !== 'completed') throw new Error('not completed')
    expect(result.answer.problemCode).toBe('PROVIDER_FAILURE')
    expect(f.storage.getItem).not.toHaveBeenCalled()
  })
  it('rejects a planner silently reducing a selected history count before any read', async () => {
    const f = setup({ candidate: { intent: 'history', tool: 'read_history', limit: 1 } })
    const result = await f.coach.execute(ready(f.coach.prepareSelection({ ...history, previousCount: 2 })))
    if (result.status !== 'completed') throw new Error('not completed')
    expect(result.answer.problemCode).toBe('PROVIDER_FAILURE')
    expect(f.storage.getItem).not.toHaveBeenCalled()
  })
  it('keeps the existing provider disabled even when the new caller has explicit opt-ins', async () => {
    const f = setup({ providerEnabled: false })
    const result = await f.coach.execute(ready(f.coach.prepareSelection(explain)))
    if (result.status !== 'completed') throw new Error('not completed')
    expect(result.answer.problemCode).toBe('PROVIDER_FAILURE')
    expect(f.fakeFetch).not.toHaveBeenCalled()
  })
  it('rejects an admitted scope expansion before bootstrap or step transport', async () => {
    const f = setup()
    await expect(async () => f.provider.nextAdmitted({ protocol: 'coach-plan-v2', inputProjection: 'question-scope',
      question: explain.question, scope: { warmup: true, routine: true, historyLimit: 64 }, remainingCalls: 1 },
    { signal: new AbortController().signal })).rejects.toThrow('INVALID_ADMITTED_SCOPE')
    expect(f.fakeFetch).not.toHaveBeenCalled()
  })
  it('rejects repeated and copied tickets without another request', async () => {
    const f = setup(), ticket = ready(f.coach.prepareSelection(explain))
    expect((await f.coach.execute({ ...ticket })).status).toBe('denied')
    await f.coach.execute(ticket)
    expect((await f.coach.execute(ticket)).status).toBe('denied')
    expect(f.wire).toHaveLength(1)
  })
  it('disposal revokes every pending capability and future preparation', async () => {
    const f = setup(), ticket = ready(f.coach.prepareSelection(explain))
    f.coach.dispose()
    expect((await f.coach.execute(ticket)).status).toBe('denied')
    expect(f.coach.prepareSelection(explain).status).toBe('denied')
    expect(f.fakeFetch).not.toHaveBeenCalled()
  })
  it('rejects a cancelled external signal without any provider call', async () => {
    const f = setup(), ticket = ready(f.coach.prepareSelection(explain)), abort = new AbortController()
    abort.abort()
    expect((await f.coach.execute(ticket, { signal: abort.signal })).status).toBe('denied')
    expect(f.fakeFetch).not.toHaveBeenCalled()
  })
  it('times out a hanging adapter without retry or storage reads', async () => {
    const f = setup()
    const nextAdmitted = vi.fn(() => new Promise<unknown>(() => {}))
    const coach = createTrustedCoach({ ...f.base, provider: { ...f.provider, nextAdmitted },
      enabled: true, consent: true, inferenceEnabled: true, resourcesConfirmed: true, timeoutMs: 10 })
    const result = await coach.execute(ready(coach.prepareSelection(explain)))
    if (result.status !== 'completed') throw new Error('not completed')
    expect(result.answer.status).toBe('timeout')
    expect(nextAdmitted).toHaveBeenCalledTimes(1)
    expect(f.storage.getItem).not.toHaveBeenCalled()
  })
  it('a mixed new submission aborts a pending planner and a late result cannot read storage', async () => {
    const f = setup()
    let release!: (value: unknown) => void
    const nextAdmitted = vi.fn(() => new Promise<unknown>(resolve => { release = resolve }))
    const coach = createTrustedCoach({ ...f.base, provider: { ...f.provider, nextAdmitted },
      enabled: true, consent: true, inferenceEnabled: true, resourcesConfirmed: true, maxRequests: 2 })
    const pending = coach.execute(ready(coach.prepareSelection(explain)))
    expect(nextAdmitted).toHaveBeenCalledTimes(1)
    expect(coach.clarify('姓名PRIVATE深蹲评分').status).toBe('clarification_required')
    const nextTicket = ready(coach.prepareSelection(explain))
    release({ type: 'plan', mode: 'explain', calls: [{ tool: 'read_scoring_evidence', query: {
      kind: 'warmup', sessionId: f.warmupSessionId, subject: { kind: 'exercise', id: 'squat' } } }] })
    expect((await pending).status).toBe('denied')
    expect(f.storage.getItem).not.toHaveBeenCalled()
    coach.cancel()
    expect((await coach.execute(nextTicket)).status).toBe('denied')
  })
})
