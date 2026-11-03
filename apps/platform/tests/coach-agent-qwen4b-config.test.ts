import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { QWEN3_4B_DIGEST, QWEN3_4B_MODEL, QWEN3_4B_OLLAMA_VERSION,
  resolveLocalConfig, type LocalCoachServerConfig } from '../server/coachAgent/local/config'
import { createLocalCoachServer } from '../server/coachAgent/local/server'
import { parseRemoteContext } from '../src/features/coachAgent/remoteProtocol'

const ORIGIN = 'http://127.0.0.1:5173'
const TOKEN = 'synthetic_qwen4b_offline_bootstrap_capability_123456'
const QUESTION_CONTEXT = { protocol: 'coach-plan-v2', inputProjection: 'question-scope',
  question: '为什么这次深蹲评分不高？', scope: { warmup: true, routine: true, historyLimit: 3 }, remainingCalls: 1 }
const PLAN = { intent: 'explain', tool: 'read_scoring_evidence' }
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
  await Promise.all([...servers].map(async server => {
    server.closeAllConnections()
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
  }))
  servers.clear()
})

/** Synthetic HTTP endpoints on OS-assigned loopback ports; never runs Ollama or loads weights. */
async function setup(options: {
  config?: LocalCoachServerConfig
  version?: unknown
  tag?: Record<string, unknown>
  details?: Record<string, unknown>
  capabilities?: string[]
  failure?: 'hang' | 'oom' | 'exit'
  response?: Record<string, unknown>
} = {}) {
  const paths: string[] = []
  const bodies: Array<Record<string, unknown>> = []
  const state = { version: options.version ?? QWEN3_4B_OLLAMA_VERSION,
    digest: QWEN3_4B_DIGEST, tagName: QWEN3_4B_MODEL }
  const modelPort = await listen(createServer(async (req, res) => {
    paths.push(req.url ?? '')
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/version') { res.end(JSON.stringify({ version: state.version })); return }
    if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: [options.tag ?? {
        name: state.tagName, digest: `sha256:${state.digest}`, size: 2_497_293_803,
      }] })); return
    }
    if (req.url === '/api/show') {
      req.resume()
      res.end(JSON.stringify({ details: options.details ?? {
        format: 'gguf', family: 'qwen3', quantization_level: 'Q4_K_M',
      }, model_info: {}, capabilities: options.capabilities ?? ['completion', 'tools'] })); return
    }
    if (req.url !== '/api/chat') { res.writeHead(404); res.end('{}'); return }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    bodies.push(body)
    if (options.failure === 'hang') return
    if (options.failure === 'exit') { req.socket.destroy(); return }
    if (options.failure === 'oom') {
      res.writeHead(500); res.end(JSON.stringify({ error: 'CUDA out of memory; synthetic-private-diagnostic' })); return
    }
    res.end(JSON.stringify(options.response ?? { done: true, done_reason: 'stop',
      message: body.tools
        ? { role: 'assistant', content: '', tool_calls: [{ function: {
          name: 'read_scoring_evidence', arguments: { intent: 'explain' },
        } }] }
        : { role: 'assistant', content: JSON.stringify(PLAN) },
      prompt_eval_count: 1, eval_count: 1 }))
  }))
  const bridgePort = await listen(createLocalCoachServer({ model: QWEN3_4B_MODEL,
    modelDigest: `sha256:${QWEN3_4B_DIGEST}`, accessToken: TOKEN, enabled: true, resourcesConfirmed: true,
    origin: ORIGIN, testModelPort: modelPort, timeoutMs: 1000, requestsPerMinute: 60,
    planningProtocol: 'structured-output', ...options.config }))
  const base = `http://127.0.0.1:${bridgePort}/v1/coach/local`
  const post = (route: 'session' | 'step', body: unknown, capability: string) => fetch(`${base}/${route}`, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: `Bearer ${capability}` },
    body: JSON.stringify(body),
  })
  return { paths, bodies, state, exchange: () => post('session', {}, TOKEN),
    step: (token: string, context: unknown = QUESTION_CONTEXT) => post('step', context, token) }
}

async function session(demo: Awaited<ReturnType<typeof setup>>) {
  const response = await demo.exchange()
  expect(response.status).toBe(200)
  return (await response.json() as { sessionToken: string }).sessionToken
}

describe('retained Qwen3 4B exact configuration, default OFF', () => {
  it.each([QWEN3_4B_DIGEST, `sha256:${QWEN3_4B_DIGEST}`])('accepts only the official digest form %s', modelDigest => {
    expect(resolveLocalConfig({ model: QWEN3_4B_MODEL, modelDigest })).toMatchObject({
      enabled: false, configured: false, model: QWEN3_4B_MODEL, modelDigest: QWEN3_4B_DIGEST,
    })
  })

  it.each(['', 'a'.repeat(64),
    '6214d088d3846e16c9fe00adcbabdbfddc61ce4a70daacc46cb2310c38603054',
    '85e4a5b7b8ef0e48af0e8658f5aaab9c2324c76c1641493f4d1e25fce54b18b9',
  ])('rejects a missing, wrong, legacy-manifest or weight digest %s', modelDigest => {
    expect(() => resolveLocalConfig({ model: QWEN3_4B_MODEL, modelDigest })).toThrow('INVALID_LOCAL_CONFIG')
  })

  it.each(['qwen3:latest', 'qwen3:4b', 'qwen3:4b-instruct-2507-q8_0',
    'qwen3:4b-instruct-2507-fp16', 'qwen3.5:4b', 'qwen3:4b-instruct-2507-q4_k_m',
  ])('does not widen the allowlist for %s', model => {
    expect(() => resolveLocalConfig({ model, modelDigest: QWEN3_4B_DIGEST })).toThrow('INVALID_LOCAL_CONFIG')
  })

  it.each([{}, { enabled: true }, { resourcesConfirmed: true }, { enabled: true, resourcesConfirmed: false }])(
    'keeps metadata and planning requests at zero without both trusted enable gates %j', async gates => {
      const config = resolveLocalConfig({ model: QWEN3_4B_MODEL, modelDigest: QWEN3_4B_DIGEST, ...gates })
      expect(config.enabled).toBe(false)
      const demo = await setup({ config: { enabled: false, resourcesConfirmed: false, ...gates } })
      expect((await demo.exchange()).status).toBe(503)
      expect(demo.paths).toEqual([])
    })
})

describe('Qwen3 4B version and identity gate: synthetic HTTP only', () => {
  it.each(['simple-json', 'native-tools', 'structured-output'] as const)(
    '%s checks runtime and identity at exchange and each attempt, retaining bounded request parameters', async planningProtocol => {
      const demo = await setup({ config: { planningProtocol } })
      const token = await session(demo)
      const response = await demo.step(token)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(PLAN)
      expect(demo.paths).toEqual(['/api/version', '/api/tags', '/api/show', '/api/version', '/api/tags', '/api/show', '/api/chat'])
      expect(demo.bodies).toHaveLength(1)
      expect(demo.bodies[0]).toMatchObject({ model: QWEN3_4B_MODEL,
        options: { num_ctx: 8192, num_predict: 512, temperature: 0 }, think: false, stream: false, keep_alive: 0 })
      if (planningProtocol === 'native-tools') {
        expect(demo.bodies[0].tools).toBeInstanceOf(Array)
        expect(demo.bodies[0]).not.toHaveProperty('format')
      } else expect(demo.bodies[0].format).toEqual(planningProtocol === 'simple-json' ? 'json' : expect.any(Object))
    })

  it.each(['0.40.12', '0.40.14', '0.40.13-cloud', '', { version: '0.40.13' }])(
    'rejects unaccepted runtime metadata %j before tags or chat', async version => {
      const demo = await setup({ version })
      const response = await demo.exchange()
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: 'LOCAL_RUNTIME_VERSION_MISMATCH' })
      expect(demo.paths).toEqual(['/api/version'])
      expect(demo.bodies).toEqual([])
    })

  it('rechecks the runtime after a previously valid session without a model request', async () => {
    const demo = await setup()
    const token = await session(demo)
    demo.state.version = '0.40.14'
    expect(await (await demo.step(token)).json()).toEqual({ error: 'LOCAL_RUNTIME_VERSION_MISMATCH' })
    expect(demo.bodies).toEqual([])
  })

  it('rechecks an installed digest after a previously valid session', async () => {
    const demo = await setup()
    const token = await session(demo)
    demo.state.digest = 'b'.repeat(64)
    expect(await (await demo.step(token)).json()).toEqual({ error: 'LOCAL_MODEL_IDENTITY_MISMATCH' })
    expect(demo.bodies).toEqual([])
  })

  it.each([
    { name: QWEN3_4B_MODEL, digest: 'a'.repeat(64), size: 2_497_293_803 },
    { name: 'qwen3:latest', digest: QWEN3_4B_DIGEST, size: 2_497_293_803 },
    { name: QWEN3_4B_MODEL, digest: QWEN3_4B_DIGEST, size: 2_497_293_803, remote_host: 'https://paid.invalid' },
  ])('rejects mismatched or cloud identity %# without chat', async tag => {
    const demo = await setup({ tag })
    expect((await demo.exchange()).status).toBe(502)
    expect(demo.bodies).toEqual([])
  })

  it.each([
    { format: 'gguf', family: 'qwen2', quantization_level: 'Q4_K_M' },
    { format: 'gguf', family: 'qwen3', quantization_level: 'Q4_0' },
    { format: 'gguf', family: 'qwen3', quantization_level: 'Q8_0' },
  ])('requires the accepted qwen3/Q4_K_M metadata %#', async details => {
    const demo = await setup({ details })
    expect((await demo.exchange()).status).toBe(502)
    expect(demo.bodies).toEqual([])
  })

  it('keeps legacy models on their existing tags/show path without a new version dependency', async () => {
    const legacy = 'qwen2.5:0.5b-instruct-q4_K_M'
    const demo = await setup({ config: { model: legacy, modelDigest: 'a'.repeat(64) }, version: 'unavailable',
      tag: { name: legacy, digest: 'a'.repeat(64), size: 398_000_000 } })
    await session(demo)
    expect(demo.paths).toEqual(['/api/tags', '/api/show'])
  })
})

describe('Qwen3 4B failure and complete context boundary: synthetic HTTP only', () => {
  it.each(['hang', 'oom', 'exit'] as const)('fails closed on %s, retains its attempt and never retries or switches targets', async failure => {
    const demo = await setup({ failure, config: { timeoutMs: failure === 'hang' ? 150 : 1000, maxRequests: 1 } })
    const token = await session(demo)
    const response = await demo.step(token)
    expect(response.status).toBe(failure === 'hang' ? 504 : 502)
    expect(await response.json()).toEqual({ error: failure === 'hang' ? 'TIMEOUT' : 'LOCAL_MODEL_UNAVAILABLE' })
    expect(await (await demo.step(token)).json()).toEqual({ error: 'BUDGET_EXCEEDED' })
    expect(demo.bodies).toHaveLength(1)
    expect(demo.paths.filter(path => path === '/api/chat')).toHaveLength(1)
    expect(demo.paths.every(path => ['/api/version', '/api/tags', '/api/show', '/api/chat'].includes(path))).toBe(true)
  })

  it('rejects an oversized complete legacy context before identity recheck or chat', async () => {
    const demo = await setup({ config: { planningProtocol: 'provider-step-v1', maxOutputTokens: 2048 } })
    const token = await session(demo)
    const context = parseRemoteContext({ mode: 'explain', remainingCalls: 1,
      scope: { warmupSessionId: 's1', historyLimit: 3 }, observations: [{ requestId: 'r1',
        tool: 'read_scoring_evidence', ok: true, problemCode: null, comparisonGate: null,
        evidence: Array.from({ length: 40 }, (_, index) => ({ evidenceId: `e${index + 1}`, sessionId: 's1',
          subject: { kind: 'exercise', id: 'squat' }, scoreKind: 'warmup-standard' })) }] })
    const pathsBefore = demo.paths.slice()
    const response = await demo.step(token, context)
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'INPUT_TOKEN_LIMIT' })
    expect(demo.paths).toEqual(pathsBefore)
    expect(demo.bodies).toEqual([])
  })

  it.each(['simple-json', 'native-tools', 'structured-output', 'provider-step-v1'] as const)(
    '%s rejects reported real usage outside its reservation', async planningProtocol => {
      const demo = await setup({ config: { planningProtocol }, response: {
        done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(PLAN) },
        prompt_eval_count: 8192, eval_count: 512,
      } })
      const token = await session(demo)
      const context = planningProtocol === 'provider-step-v1'
        ? { mode: 'explain', remainingCalls: 1, scope: { warmupSessionId: 's1', historyLimit: 3 }, observations: [] }
        : QUESTION_CONTEXT
      const response = await demo.step(token, context)
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: 'INVALID_MODEL_RESPONSE' })
      expect(demo.bodies).toHaveLength(1)
    })
})
