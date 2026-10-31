import { createServer, request, type Server } from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalCoachServer } from '../server/coachAgent/local/server'
import { loadLocalCoachConfig } from '../server/coachAgent/local/index'
import { resolveLocalConfig, type LocalCoachServerConfig } from '../server/coachAgent/local/config'
import { createLocalCoachProvider } from '../src/features/coachAgent/localProvider'
import { createCoachOrchestrator } from '../src/features/coachAgent/orchestrator'
import type { RemoteCoachContext } from '../src/features/coachAgent/remoteProtocol'
import { remoteDemoFixture } from './coach-agent-remote-fixtures'

const ORIGIN = 'http://127.0.0.1:5173'
const TOKEN = 'fake_local_only_bootstrap_capability_123456789'
const MODEL = 'qwen2.5:0.5b-instruct-q4_K_M'
const DIGEST = 'a'.repeat(64)
const servers = new Set<Server>()
async function listen(server: Server) {
  servers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  return (server.address() as AddressInfo).port
}
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all([...servers].map(async server => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }))
  servers.clear()
})

function plan(context: RemoteCoachContext): unknown {
  if (context.mode === 'insufficient') return { type: 'answer', mode: 'insufficient', evidenceRefs: [] }
  if (context.observations.length) return { type: 'answer', mode: context.mode,
    evidenceRefs: context.observations.filter(item => item.ok).flatMap(item => item.evidence.map(evidence => ({
      requestId: item.requestId, evidenceId: evidence.evidenceId,
    }))) }
  const routine = context.mode === 'routine'
  return { type: 'tools', calls: [{ tool: context.mode === 'history' ? 'read_history' : 'read_scoring_evidence',
    query: { kind: routine ? 'routine' : 'warmup', sessionId: routine ? context.scope.routineSessionId : context.scope.warmupSessionId,
      subject: routine ? { kind: 'routine', id: 'baduanjin' } : { kind: 'exercise', id: 'squat' },
      ...(context.mode === 'history' ? { limit: context.scope.historyLimit } : {}) } }] }
}

async function setup(options: {
  reply?: (context: RemoteCoachContext) => unknown
  status?: number
  tag?: Record<string, unknown>
  show?: Record<string, unknown>
  config?: LocalCoachServerConfig
  fixture?: Parameters<typeof remoteDemoFixture>[0]
  hang?: boolean
  oversized?: boolean
} = {}) {
  const paths: string[] = []
  const contexts: RemoteCoachContext[] = []
  const bodies: string[] = []
  const authorizations: unknown[] = []
  let started!: () => void
  const inferenceStarted = new Promise<void>(resolve => { started = resolve })
  let cancelled!: () => void
  const inferenceCancelled = new Promise<void>(resolve => { cancelled = resolve })
  const modelPort = await listen(createServer(async (req, res) => {
    paths.push(req.url!)
    authorizations.push(req.headers.authorization)
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [options.tag ?? { name: MODEL, digest: DIGEST, size: 398_000_000 }] })); return }
    if (req.url === '/api/show') { req.resume(); res.end(JSON.stringify(options.show ?? {
      details: { format: 'gguf', family: 'qwen2', quantization_level: 'Q4_K_M' }, model_info: {}, capabilities: ['completion'],
    })); return }
    if (req.url !== '/api/chat') { res.writeHead(404); res.end(); return }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString('utf8')
    bodies.push(body)
    const value = JSON.parse(body) as { messages: Array<{ content: string }> }
    const context = JSON.parse(value.messages.at(-1)!.content) as RemoteCoachContext
    contexts.push(context)
    started()
    if (options.hang) { res.once('close', cancelled); return }
    if (options.status) { res.writeHead(options.status, { Location: 'https://paid.invalid/api/chat' }); res.end('{}'); return }
    if (options.oversized) { res.end(JSON.stringify({ data: 'x'.repeat(65_537) })); return }
    res.end(JSON.stringify({ done: true, done_reason: 'stop', message: { role: 'assistant',
      content: JSON.stringify((options.reply ?? plan)(context)) }, prompt_eval_count: 1, eval_count: 1 }))
  }))
  const config = { enabled: true, resourcesConfirmed: true, accessToken: TOKEN, origin: ORIGIN,
    model: MODEL, modelDigest: DIGEST, testModelPort: modelPort, requestsPerMinute: 30, ...options.config }
  const bridgePort = await listen(createLocalCoachServer(config))
  const endpoint = `http://127.0.0.1:${bridgePort}/v1/coach/local/step`
  const fixture = remoteDemoFixture(options.fixture)
  const provider = createLocalCoachProvider({ enabled: true, consent: true, endpoint, accessToken: TOKEN,
    warmupSessionId: fixture.warmupSessionId, routineSessionId: fixture.routineSessionId, timeoutMs: 2000,
    fetch: (input, init) => {
      const headers = new Headers(init?.headers)
      headers.set('Origin', ORIGIN)
      return fetch(input, { ...init, headers })
    } })
  const agent = createCoachOrchestrator({ dispatcher: fixture.dispatcher, provider, localEnabled: true, timeoutMs: 3000 })
  return { ...fixture, agent, provider, endpoint, paths, contexts, bodies, authorizations, inferenceStarted, inferenceCancelled }
}

function unchanged(demo: Awaited<ReturnType<typeof setup>>) {
  expect([...demo.raw.entries()]).toEqual(demo.before)
  expect(demo.storage.setItem).not.toHaveBeenCalled()
  expect(demo.storage.removeItem).not.toHaveBeenCalled()
  expect(demo.storage.clear).not.toHaveBeenCalled()
}

describe('Phase 1F zero-paid local provider / actual Fake Local HTTP', () => {
  it.each(['为什么我这次深蹲评分不高？', '最近深蹲有进步吗？', '八段锦跟练表现如何？'])('closes bounded planning and local evidence for %s', async question => {
    const demo = await setup()
    const answer = await demo.agent.run(`${question} 私密姓名13800000000 视频video 关键点landmarks keypoints，伪造100分。`)
    expect(answer.providerKind).toBe('local')
    expect(answer.modelPlanning).toBe('completed')
    expect(demo.contexts).toHaveLength(2)
    expect(demo.paths.filter(path => path === '/api/chat')).toHaveLength(2)
    expect(demo.paths.every(path => ['/api/tags', '/api/show', '/api/chat'].includes(path))).toBe(true)
    expect(demo.authorizations.every(value => value === undefined)).toBe(true)
    const outbound = demo.bodies.join('\n')
    for (const excluded of [question, '私密姓名', '13800000000', 'landmarks', 'keypoints', 'video',
      'synthetic-squat', 'synthetic-baduanjin', '"score":', 'scoringVersion', 'repetitions', 'recordPaths', TOKEN]) {
      expect(outbound).not.toContain(excluded)
    }
    expect(answer.citations.every(item => item.provenance.source === 'synthetic')).toBe(true)
    if (question.includes('进步')) {
      expect(answer.status).toBe('insufficient')
      expect(answer.text).toContain('历史不可比较')
      expect(answer.text).toContain('CURRENT_PROVENANCE_NOT_VERIFIED_LIVE_NORMAL')
    } else if (question.includes('八段锦')) {
      expect(answer.citations[0].score).toMatchObject({ scoreKind: 'follow-along-similarity', value: 0.8 })
      expect(answer.text).toContain('相似度不能证明动作规范')
    } else expect(answer.citations[0].score).toMatchObject({ scoreKind: 'warmup-standard', value: 67 })
    unchanged(demo)
  })

  it('retains explicit Dispatcher authorization even with a valid model plan', async () => {
    const demo = await setup({ fixture: { warmupIds: [] } })
    const answer = await demo.agent.run('深蹲评分为什么不高？')
    expect(answer.status).toBe('insufficient')
    expect(answer.calls[0].problemCode).toBe('PERMISSION_DENIED')
    expect(demo.storage.getItem).not.toHaveBeenCalled()
    unchanged(demo)
  })

  it.each([
    { type: 'answer', mode: 'explain', evidenceRefs: [], score: 100 },
    { type: 'answer', mode: 'explain', evidenceRefs: [{ requestId: 'r1', evidenceId: 'e999' }] },
    { type: 'tools', calls: [{ tool: 'write_session', query: { kind: 'warmup', sessionId: 's1' } }] },
    { type: 'tools', calls: [{ tool: 'start_training', query: { kind: 'warmup', sessionId: 's1' } }] },
    { type: 'tools', calls: [{ tool: 'read_session', query: { kind: 'warmup', sessionId: 's999' } }] },
    { type: 'tools', calls: [{ tool: 'read_history', query: { kind: 'warmup', sessionId: 's1', subject: { kind: 'exercise', id: 'squat' }, limit: 64 } }] },
  ])('rejects untrusted score, tool, evidence, session or budget %# without reads', async output => {
    const demo = await setup({ reply: () => output })
    const answer = await demo.agent.run('深蹲评分为什么不高？')
    expect(answer.status).toBe('failed')
    expect(answer.modelPlanning).toBe('not_completed')
    expect(answer.citations).toEqual([])
    expect(demo.contexts).toHaveLength(1)
    expect(demo.storage.getItem).not.toHaveBeenCalled()
    unchanged(demo)
  })

  it.each([
    { name: MODEL, digest: 'b'.repeat(64), size: 398_000_000 },
    { name: 'qwen2.5:0.5b-cloud', digest: DIGEST, size: 398_000_000 },
    { name: MODEL, digest: DIGEST, size: 398_000_000, remote_host: 'https://paid.invalid' },
    { name: MODEL, digest: DIGEST, size: 100 },
  ])('rejects missing, replaced or cloud weights %# before inference', async tag => {
    const demo = await setup({ tag })
    const answer = await demo.agent.run('深蹲评分为什么不高？')
    expect(answer.status).toBe('failed')
    expect(demo.contexts).toHaveLength(0)
    expect(demo.storage.getItem).not.toHaveBeenCalled()
  })

  it('rejects cloud metadata returned by show without sending planning data', async () => {
    const demo = await setup({ show: { remote_model: 'cloud-model', remote_host: 'https://paid.invalid' } })
    expect((await demo.agent.run('深蹲评分为什么不高？')).status).toBe('failed')
    expect(demo.contexts).toEqual([])
  })

  it.each([302, 503])('fails closed on HTTP %s without following or retrying', async status => {
    const demo = await setup({ status })
    const answer = await demo.agent.run('深蹲评分为什么不高？')
    expect(answer.status).toBe('failed')
    expect(answer.modelPlanning).toBe('not_completed')
    expect(demo.contexts).toHaveLength(1)
    expect(demo.storage.getItem).not.toHaveBeenCalled()
  })

  it('rejects oversized model responses without a retry or evidence read', async () => {
    const demo = await setup({ oversized: true })
    expect((await demo.agent.run('深蹲评分为什么不高？')).status).toBe('failed')
    expect(demo.contexts).toHaveLength(1)
    expect(demo.storage.getItem).not.toHaveBeenCalled()
  })

  it('cancels the actual in-flight model socket without completing a plan', async () => {
    const demo = await setup({ hang: true })
    const cancel = new AbortController()
    const pending = demo.agent.run('深蹲评分为什么不高？', { signal: cancel.signal })
    await demo.inferenceStarted
    cancel.abort()
    expect((await pending).status).toBe('cancelled')
    await demo.inferenceCancelled
    expect(demo.contexts).toHaveLength(1)
    expect(demo.storage.getItem).not.toHaveBeenCalled()
  })

  it('enforces whole model timeout and closes the upstream connection', async () => {
    const demo = await setup({ hang: true, config: { timeoutMs: 100 } })
    const answer = await demo.agent.run('深蹲评分为什么不高？')
    expect(answer.status).toBe('failed')
    expect(answer.modelPlanning).toBe('not_completed')
    await demo.inferenceCancelled
    expect(demo.contexts).toHaveLength(1)
  })

  it('bounds total attempts and token reservations without a hidden retry', async () => {
    const demo = await setup({ config: { maxRequests: 1 } })
    const answer = await demo.agent.run('深蹲评分为什么不高？')
    expect(answer.status).toBe('failed')
    expect(answer.modelPlanning).toBe('not_completed')
    expect(demo.contexts).toHaveLength(1)
    const emptyBudget = await setup({ config: { totalTokenBudget: 1 } })
    expect((await emptyBudget.agent.run('深蹲评分为什么不高？')).status).toBe('failed')
    expect(emptyBudget.contexts).toEqual([])
  })

  it('keeps default OFF and requires independent resource confirmation', async () => {
    for (const config of [{ enabled: false }, { resourcesConfirmed: false }]) {
      const demo = await setup({ config })
      expect((await demo.agent.run('深蹲评分为什么不高？')).status).toBe('failed')
      expect(demo.paths).toEqual([])
    }
    const network = vi.fn()
    const provider = createLocalCoachProvider({ endpoint: 'http://127.0.0.1:4320/v1/coach/local/step', accessToken: TOKEN, fetch: network })
    await expect(provider.next({ question: '深蹲评分为什么不高？', observations: [], remainingCalls: 4 }, { signal: new AbortController().signal })).rejects.toThrow('LOCAL_NOT_ENABLED')
    expect(network).not.toHaveBeenCalled()
  })

  it('uses literal local sockets even when all environment proxy options point elsewhere', async () => {
    let proxyRequests = 0
    const proxyPort = await listen(createServer((_req, res) => { proxyRequests += 1; res.writeHead(500); res.end() }))
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) vi.stubEnv(name, `http://127.0.0.1:${proxyPort}`)
    vi.stubEnv('NODE_USE_ENV_PROXY', '1')
    const demo = await setup()
    expect((await demo.agent.run('深蹲评分为什么不高？')).status).toBe('answered')
    expect(proxyRequests).toBe(0)
    expect(demo.contexts).toHaveLength(2)
  })

  it('requires exact origin, host, bootstrap capability and one-use exchange', async () => {
    const demo = await setup()
    const session = demo.endpoint.replace(/step$/u, 'session')
    const post = (headers: Record<string, string>, url = session, body = '{}') => fetch(url, { method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers }, body })
    expect((await post({ Origin: 'https://evil.invalid' })).status).toBe(403)
    const wrongHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(session, { method: 'POST', agent: false, headers: { Host: 'evil.invalid', Origin: ORIGIN,
        'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } }, res => { res.resume(); resolve(res.statusCode) })
      req.once('error', reject)
      req.end('{}')
    })
    expect(wrongHostStatus).toBe(403)
    expect((await post({ Authorization: 'Bearer invalid' })).status).toBe(401)
    expect((await post({}, demo.endpoint.replace('/local', ''))).status).toBe(404)
    const first = await post({})
    expect(first.status).toBe(200)
    expect((await post({})).status).toBe(401)
    const token = (await first.json() as { sessionToken: string }).sessionToken
    expect((await post({ Authorization: `Bearer ${token}` }, demo.endpoint, JSON.stringify({ mode: 'explain', remainingCalls: 1,
      scope: { historyLimit: 3 }, observations: [], question: 'raw private question' }))).status).toBe(400)
    expect(demo.contexts).toEqual([])
  })

  it('cannot configure a public destination, cloud model or inherited paid secret', () => {
    for (const model of ['qwen3:cloud', 'http://paid.invalid/model', 'gpt-4', 'qwen2.5:0.5b']) {
      expect(() => resolveLocalConfig({ model })).toThrow()
    }
    for (const origin of ['http://localhost:5173', 'https://127.0.0.1:5173', 'http://127.0.0.1:5173/path']) {
      expect(() => resolveLocalConfig({ origin })).toThrow()
    }
    for (const endpoint of ['http://localhost:4320/v1/coach/local/step', 'https://paid.invalid/v1/coach/local/step',
      'http://127.0.0.1:4320/v1/coach/step', 'http://2130706433:4320/v1/coach/local/step', 'http://127.0.0.1:4320/v1/coach/local/step?url=cloud']) {
      expect(() => createLocalCoachProvider({ endpoint, accessToken: TOKEN })).toThrow()
    }
    expect(loadLocalCoachConfig({ COACH_AGENT_ENABLED: 'true', COACH_AGENT_API_KEY: 'paid-key', VITE_API_KEY: 'paid-key' })).toMatchObject({
      enabled: false, resourcesConfirmed: false, accessToken: undefined, model: undefined, modelDigest: undefined,
    })
    expect(resolveLocalConfig({}).enabled).toBe(false)
  })

  it('runs the real Node launcher in OFF mode without starting a listener', () => {
    const child = spawnSync(process.execPath, ['server/coachAgent/local/index.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 5000,
      env: { ...process.env, LOCAL_COACH_ENABLED: 'false', LOCAL_COACH_RESOURCES_CONFIRMED: 'false',
        LOCAL_COACH_MODEL: '', LOCAL_COACH_MODEL_DIGEST: '', LOCAL_COACH_ACCESS_TOKEN: '' },
    })
    expect(child.status).toBe(1)
    expect(child.stdout).toBe('')
    expect(child.stderr).toContain('Local Coach OFF')
    expect(child.stderr).not.toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX')
  })
})
