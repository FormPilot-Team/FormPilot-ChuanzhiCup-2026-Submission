import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, request as httpRequest, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createCoachAgentServer } from '../server/coachAgent/server'
import { loadCoachAgentServerConfig, resolveCoachAgentConfig, type CoachAgentServerConfig } from '../server/coachAgent/config'
import { isPublicModelAddress, type CoachAgentServerDependencies, type ModelRequest } from '../server/coachAgent/modelTransport'

const ORIGIN = 'http://127.0.0.1:5173'
const TOKEN = 'synthetic-application-capability-0123456789'
const KEY = 'synthetic-model-server-only-key'
const CONTEXT = { mode: 'explain', remainingCalls: 4,
  scope: { warmupSessionId: 's1', historyLimit: 3 }, observations: [] }
const STEP = { type: 'tools', calls: [{ tool: 'read_scoring_evidence', query: {
  kind: 'warmup', sessionId: 's1', subject: { kind: 'exercise', id: 'squat' },
} }] }
const config: CoachAgentServerConfig = { enabled: true, apiKey: KEY, accessToken: TOKEN,
  model: 'fake-test-model', modelUrl: 'https://model.example/v1/chat/completions', allowedModelHosts: ['model.example'],
  origin: ORIGIN, requestsPerMinute: 60, budgetMicroUsd: 1_000_000,
  inputPriceMicroUsdPerMillionTokens: 1_000_000, outputPriceMicroUsdPerMillionTokens: 1_000_000 }
const completion = (step: unknown = STEP) => ({ choices: [{ message: { content: JSON.stringify(step) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
const servers: Server[] = []
const sessions = new Map<string, string>()
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

async function listen(server: Server) {
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected loopback address')
  return `http://127.0.0.1:${address.port}`
}
async function start(overrides: CoachAgentServerConfig = {}, dependencies: CoachAgentServerDependencies = {}) {
  const requestModel = vi.fn(async () => completion())
  const url = await listen(createCoachAgentServer({ ...config, ...overrides }, { requestModel, ...dependencies }))
  await handshake(url)
  return { url, requestModel }
}
const headers = { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
async function handshake(url: string, body: unknown = {}, authorization = `Bearer ${TOKEN}`) {
  const response = await fetch(`${url}/v1/coach/session`, { method: 'POST', headers: { ...headers, Authorization: authorization }, body: JSON.stringify(body) })
  if (response.ok) {
    const result = await response.clone().json() as { sessionToken: string }
    sessions.set(url, result.sessionToken)
  }
  return response
}
const requestHeaders = (url: string) => ({ ...headers, Authorization: `Bearer ${sessions.get(url) ?? TOKEN}` })
function call(url: string, body: unknown = CONTEXT, options: RequestInit = {}) {
  return fetch(`${url}/v1/coach/step`, { method: 'POST', headers: requestHeaders(url), body: JSON.stringify(body), ...options })
}
async function raw(url: string, body: string, extraHeaders: Record<string, string | string[]> = {}, finish = true) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(`${url}/v1/coach/step`, { method: 'POST', headers: { ...requestHeaders(url), ...extraHeaders } }, response => {
      let value = ''
      response.on('data', chunk => { value += chunk.toString() })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: value }))
    })
    request.once('error', reject)
    request.write(body)
    if (finish) request.end()
  })
}
async function fakeModel(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return listen(createServer(handler))
}

describe('AI Coach independent loopback authorization and request boundary', () => {
  it('requires a single-use bootstrap handshake and never accepts that bootstrap for model steps', async () => {
    const requestModel = vi.fn(async () => completion())
    const url = await listen(createCoachAgentServer(config, { requestModel }))
    expect((await call(url)).status).toBe(401)
    const exchange = await handshake(url)
    expect(exchange.status).toBe(200)
    const session = await exchange.json()
    expect(session).toEqual({ sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u), expiresInMs: 300_000 })
    expect(JSON.stringify(session)).not.toContain(TOKEN)
    expect(JSON.stringify(session)).not.toContain(KEY)
    expect((await handshake(url)).status).toBe(401)
    expect((await call(url, CONTEXT, { headers })).status).toBe(401)
    expect((await call(url)).status).toBe(200)
    expect(requestModel).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed exchanges before consuming bootstrap and expires an issued session after five minutes', async () => {
    let time = 0
    const requestModel = vi.fn(async () => completion())
    const url = await listen(createCoachAgentServer(config, { requestModel, now: () => time }))
    expect((await handshake(url, { modelUrl: 'https://private.example' })).status).toBe(400)
    expect((await handshake(url, {}, 'Bearer invalid')).status).toBe(401)
    expect((await handshake(url)).status).toBe(200)
    time = 300_000
    expect((await call(url)).status).toBe(401)
    expect((await handshake(url)).status).toBe(401)
    expect(requestModel).not.toHaveBeenCalled()
  })
  it('mints at most one capability when two bootstrap exchanges race', async () => {
    const requestModel = vi.fn(async () => completion())
    const url = await listen(createCoachAgentServer({ ...config, maxConcurrent: 2 }, { requestModel }))
    const responses = await Promise.all([handshake(url), handshake(url)])
    expect(responses.map(response => response.status).sort()).toEqual([200, 401])
    expect(requestModel).not.toHaveBeenCalled()
  })
  it('keeps remote disabled, missing credentials and zero cost budget at zero upstream requests', async () => {
    for (const overrides of [{ enabled: false }, { apiKey: '' }, { budgetMicroUsd: 0 }]) {
      const server = await start(overrides)
      const response = await call(server.url)
      expect([429, 503]).toContain(response.status)
      expect(server.requestModel).not.toHaveBeenCalled()
    }
  })
  it.each(['', 'Bearer bad', `Basic ${TOKEN}`, `Bearer ${KEY}`, `Bearer ${TOKEN} `])('rejects an invalid application capability (%s)', async authorization => {
    const server = await start()
    expect((await call(server.url, CONTEXT, { headers: { ...headers, Authorization: authorization } })).status).toBe(401)
    expect(server.requestModel).not.toHaveBeenCalled()
  })
  it.each(['https://untrusted.example', 'null', 'http://localhost:5173', 'http://127.0.0.1:5174', ''])('rejects a foreign or absent Origin (%s)', async origin => {
    const server = await start()
    expect((await call(server.url, CONTEXT, { headers: { ...requestHeaders(server.url), Origin: origin } })).status).toBe(403)
    expect(server.requestModel).not.toHaveBeenCalled()
  })
  it('binds Host to the exact socket port and rejects duplicate capability/origin headers', async () => {
    const server = await start()
    expect((await raw(server.url, JSON.stringify(CONTEXT), { Host: 'untrusted.example' })).status).toBe(403)
    expect((await raw(server.url, JSON.stringify(CONTEXT), { Host: '127.0.0.1:1' })).status).toBe(403)
    expect((await raw(server.url, JSON.stringify(CONTEXT), { Authorization: [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`] })).status).toBe(401)
    expect((await raw(server.url, JSON.stringify(CONTEXT), { Origin: [ORIGIN, ORIGIN] })).status).toBe(403)
    expect(server.requestModel).not.toHaveBeenCalled()
  })
  it('returns only exact-origin CORS preflight permissions, never credentials or wildcard', async () => {
    const server = await start()
    const response = await fetch(`${server.url}/v1/coach/step`, { method: 'OPTIONS', headers: {
      Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type',
    } })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    const disallowed = await fetch(`${server.url}/v1/coach/step`, { method: 'OPTIONS', headers: {
      Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-arbitrary-header',
    } })
    expect(disallowed.status).toBe(403)
    expect(server.requestModel).not.toHaveBeenCalled()
  })
  it('rejects unsupported routes, methods, content types and compression', async () => {
    const server = await start()
    expect((await fetch(`${server.url}/v1/coach/step?modelUrl=https://other.example`, { headers })).status).toBe(404)
    expect((await fetch(`${server.url}/v1/coach/step`, { headers })).status).toBe(405)
    expect((await call(server.url, CONTEXT, { headers: { ...requestHeaders(server.url), 'Content-Type': 'text/plain' } })).status).toBe(415)
    expect((await call(server.url, CONTEXT, { headers: { ...requestHeaders(server.url), 'Content-Encoding': 'gzip' } })).status).toBe(415)
    expect(server.requestModel).not.toHaveBeenCalled()
  })
  it.each(['question', 'modelUrl', 'apiKey', 'score', 'source', 'session', 'localStorage', '__proto__'])('rejects input injection through unknown field %s', async field => {
    const server = await start()
    const body = JSON.parse(JSON.stringify(CONTEXT).slice(0, -1) + `,"${field}":"private-data"}`)
    const response = await call(server.url, body)
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"error":"INVALID_REQUEST"}')
    expect(server.requestModel).not.toHaveBeenCalled()
  })
  it('enforces declared and chunked body byte limits before an upstream request', async () => {
    const server = await start({ maxRequestBytes: 256 })
    expect((await call(server.url, { text: '字'.repeat(200) })).status).toBe(413)
    expect((await raw(server.url, 'x'.repeat(257), { 'Transfer-Encoding': 'chunked' })).status).toBe(413)
    expect((await raw(server.url, 'not-json')).status).toBe(400)
    expect(server.requestModel).not.toHaveBeenCalled()
  })
  it('applies a deadline while the client is still streaming its request', async () => {
    const server = await start({ timeoutMs: 30 })
    const response = await raw(server.url, '{', { 'Transfer-Encoding': 'chunked' }, false)
    expect(response.status).toBe(504)
    expect(response.body).toBe('{"error":"TIMEOUT"}')
    expect(server.requestModel).not.toHaveBeenCalled()
  })
})

describe('AI Coach model schema and quota boundaries', () => {
  it('returns only a validated ProviderStep, with no usage, credentials or upstream metadata', async () => {
    const server = await start({}, { requestModel: async () => ({ ...completion(), privateKey: KEY, secret: TOKEN }) })
    const response = await call(server.url)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(STEP)
  })
  it.each([
    { type: 'answer', mode: 'explain', evidenceRefs: [], score: 99 },
    { type: 'answer', mode: 'explain', evidenceRefs: [], source: 'live' },
    { type: 'answer', mode: 'explain', evidenceRefs: [{ requestId: 'r1', evidenceId: 'e1' }] },
    { type: 'tools', calls: [{ tool: 'write_session', query: { kind: 'warmup', sessionId: 's1' } }] },
    { type: 'tools', calls: [{ tool: 'read_session', query: { kind: 'warmup', sessionId: 's999' } }] },
    { type: 'tools', calls: [{ tool: 'read_session', query: { kind: 'warmup', sessionId: 's1' }, result: { score: 100 } }] },
  ])('rejects forged model facts, evidence and executable tools (%j)', async step => {
    const server = await start({}, { requestModel: async () => completion(step) })
    const response = await call(server.url)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'INVALID_MODEL_OUTPUT' })
  })
  it.each([
    {}, { choices: [] }, { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'not-json' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{}', tool_calls: [{}] } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'x'.repeat(16_385) } }] },
    { ...completion(), usage: { prompt_tokens: -1, completion_tokens: 1 } },
    { ...completion(), usage: { prompt_tokens: 1, completion_tokens: 10_000 } },
  ])('rejects abnormal completion payloads (%j)', async payload => {
    const server = await start({}, { requestModel: async () => payload })
    expect((await call(server.url)).status).toBe(502)
  })
  it('does not echo upstream exceptions or retry a failed request', async () => {
    const requestModel = vi.fn(async () => { throw new Error(`private-user-record ${KEY} ${TOKEN}`) })
    const server = await start({}, { requestModel })
    const response = await call(server.url)
    expect(await response.text()).toBe('{"error":"UPSTREAM_FAILURE"}')
    expect(requestModel).toHaveBeenCalledTimes(1)
  })
  it.each([{ maxRequests: 1 }, { totalTokenBudget: 1 }, { budgetMicroUsd: 1 }, { maxInputTokens: 512 }])('enforces request, token and cost budgets (%j)', async limits => {
    const server = await start(limits)
    const first = await call(server.url)
    if ('maxRequests' in limits) expect(first.status).toBe(200)
    else expect([413, 429]).toContain(first.status)
    expect([413, 429]).toContain((await call(server.url)).status)
    expect(server.requestModel.mock.calls.length).toBe('maxRequests' in limits ? 1 : 0)
  })
  it('retains the reservation after upstream failure rather than refunding unknown billing', async () => {
    const requestModel = vi.fn(async () => { throw new Error('unknown billing') })
    const server = await start({ maxRequests: 1 }, { requestModel })
    expect((await call(server.url)).status).toBe(502)
    expect(await (await call(server.url)).json()).toEqual({ error: 'BUDGET_EXCEEDED' })
    expect(requestModel).toHaveBeenCalledTimes(1)
  })
  it('reserves budget before concurrent upstream calls can race', async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>(resolve => { release = resolve })
    const requestModel = vi.fn(async () => { await pending; return completion() })
    const server = await start({ maxConcurrent: 2, maxRequests: 1 }, { requestModel })
    const first = call(server.url)
    await vi.waitFor(() => expect(requestModel).toHaveBeenCalledTimes(1))
    expect(await (await call(server.url)).json()).toEqual({ error: 'BUDGET_EXCEEDED' })
    release!()
    expect((await first).status).toBe(200)
    expect(requestModel).toHaveBeenCalledTimes(1)
  })
  it('limits active work independently from the total request budget', async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>(resolve => { release = resolve })
    const requestModel = vi.fn(async () => { await pending; return completion() })
    const server = await start({ maxConcurrent: 1 }, { requestModel })
    const first = call(server.url)
    await vi.waitFor(() => expect(requestModel).toHaveBeenCalledTimes(1))
    expect(await (await call(server.url)).json()).toEqual({ error: 'CONCURRENCY_LIMITED' })
    release!()
    expect((await first).status).toBe(200)
  })
  it('rate limits authenticated attempts and permits a later minute without resetting cost quotas', async () => {
    let time = 0
    const server = await start({ requestsPerMinute: 1, maxRequests: 1 }, { now: () => time })
    expect((await call(server.url)).status).toBe(200)
    expect(await (await call(server.url)).json()).toEqual({ error: 'RATE_LIMITED' })
    time = 60_001
    expect(await (await call(server.url)).json()).toEqual({ error: 'BUDGET_EXCEEDED' })
    expect(server.requestModel).toHaveBeenCalledTimes(1)
  })
  it('times out and aborts a non-cooperative injected transport, discarding late output', async () => {
    let capturedSignal: AbortSignal | undefined
    let release: (() => void) | undefined
    const pending = new Promise<void>(resolve => { release = resolve })
    const requestModel = vi.fn(async ({ signal }: ModelRequest) => { capturedSignal = signal; await pending; return completion() })
    const server = await start({ timeoutMs: 30, maxRequests: 1 }, { requestModel })
    const response = await call(server.url)
    expect(response.status).toBe(504)
    expect(await response.json()).toEqual({ error: 'TIMEOUT' })
    expect(capturedSignal?.aborted).toBe(true)
    expect(await (await call(server.url)).json()).toEqual({ error: 'BUDGET_EXCEEDED' })
    release!()
    expect(requestModel).toHaveBeenCalledTimes(1)
  })
  it('rejects output beyond the monotonic deadline even when its microtask precedes the timer', async () => {
    let time = 0
    const requestModel = vi.fn(async () => { time = 101; return completion() })
    const server = await start({ timeoutMs: 100 }, { now: () => time, requestModel })
    const response = await call(server.url)
    expect(response.status).toBe(504)
    expect(await response.json()).toEqual({ error: 'TIMEOUT' })
    expect(requestModel).toHaveBeenCalledTimes(1)
  })
  it('propagates a disconnected client cancellation to model work and keeps spent quota', async () => {
    let capturedSignal: AbortSignal | undefined
    let release: (() => void) | undefined
    const pending = new Promise<void>(resolve => { release = resolve })
    const requestModel = vi.fn(async ({ signal }: ModelRequest) => { capturedSignal = signal; await pending; return completion() })
    const server = await start({ maxRequests: 1 }, { requestModel })
    const controller = new AbortController()
    const running = call(server.url, CONTEXT, { signal: controller.signal }).catch(() => undefined)
    await vi.waitFor(() => expect(capturedSignal).toBeDefined())
    controller.abort()
    await running
    await vi.waitFor(() => expect(capturedSignal?.aborted).toBe(true))
    expect(await (await call(server.url)).json()).toEqual({ error: 'BUDGET_EXCEEDED' })
    release!()
    expect(requestModel).toHaveBeenCalledTimes(1)
  })
})

describe('standard HTTP model adapter and server target isolation', () => {
  it('passes only anonymous planning data to a real Fake HTTP model using a server-only key', async () => {
    let upstreamBody = ''
    let upstreamAuthorization = ''
    const fakeUrl = await fakeModel((req, res) => {
      upstreamAuthorization = req.headers.authorization ?? ''
      req.on('data', chunk => { upstreamBody += chunk.toString() })
      req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(completion())) })
    })
    const serverUrl = await listen(createCoachAgentServer({ ...config, modelUrl: `${fakeUrl}/v1/chat/completions`,
      allowedModelHosts: ['127.0.0.1'], allowLoopbackModelForTests: true }))
    await handshake(serverUrl)
    const response = await call(serverUrl)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(STEP)
    expect(upstreamAuthorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(upstreamBody)
    expect(body).toMatchObject({ model: 'fake-test-model', stream: false, max_tokens: 1024, temperature: 0 })
    expect(JSON.parse(body.messages[1].content)).toEqual(CONTEXT)
    expect(upstreamBody).not.toContain(TOKEN)
    expect(upstreamBody).not.toContain('为什么')
    expect(body.messages[1].content).not.toMatch(/score"|source|provenance|scoringVersion|storage|question|raw|recordPaths/u)
  })
  it.each([429, 500, 301])('rejects HTTP status %i without forwarding its body or following a redirect', async status => {
    let calls = 0
    const fakeUrl = await fakeModel((_req, res) => {
      calls += 1; res.writeHead(status, { 'Content-Type': 'application/json', Location: 'http://127.0.0.1:1/never' })
      res.end(`private diagnostic ${KEY}`)
    })
    const serverUrl = await listen(createCoachAgentServer({ ...config, modelUrl: `${fakeUrl}/v1/chat/completions`,
      allowedModelHosts: ['127.0.0.1'], allowLoopbackModelForTests: true }))
    await handshake(serverUrl)
    const response = await call(serverUrl)
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain(KEY)
    expect(calls).toBe(1)
  })
  it.each(['invalid-json', 'wrong-type', 'encoded', 'declared-size', 'stream-size'])('bounds and validates an HTTP response (%s)', async problem => {
    const fakeUrl = await fakeModel((_req, res) => {
      res.setHeader('Content-Type', problem === 'wrong-type' ? 'text/plain' : 'application/json')
      if (problem === 'encoded') res.setHeader('Content-Encoding', 'gzip')
      if (problem === 'declared-size') res.setHeader('Content-Length', '99999')
      if (problem === 'stream-size') { res.write('x'.repeat(600)); res.end('x'.repeat(600)); return }
      res.end(problem === 'invalid-json' ? '{private' : JSON.stringify(completion()))
    })
    const serverUrl = await listen(createCoachAgentServer({ ...config, maxResponseBytes: 1024,
      modelUrl: `${fakeUrl}/v1/chat/completions`, allowedModelHosts: ['127.0.0.1'], allowLoopbackModelForTests: true }))
    await handshake(serverUrl)
    expect((await call(serverUrl)).status).toBe(502)
  })
  it('destroys a real pending Fake HTTP upstream after the local deadline', async () => {
    let closed = false
    const fakeUrl = await fakeModel((_req, res) => { res.once('close', () => { closed = true }) })
    const serverUrl = await listen(createCoachAgentServer({ ...config, timeoutMs: 40,
      modelUrl: `${fakeUrl}/v1/chat/completions`, allowedModelHosts: ['127.0.0.1'], allowLoopbackModelForTests: true }))
    await handshake(serverUrl)
    expect((await call(serverUrl)).status).toBe(504)
    await vi.waitFor(() => expect(closed).toBe(true))
  })
  it('cancels the real Fake HTTP request on client disconnect without retrying or refunding quota', async () => {
    let calls = 0
    let closed = false
    const fakeUrl = await fakeModel((_req, res) => {
      calls += 1
      res.once('close', () => { closed = true })
    })
    const serverUrl = await listen(createCoachAgentServer({ ...config, maxRequests: 1,
      modelUrl: `${fakeUrl}/v1/chat/completions`, allowedModelHosts: ['127.0.0.1'], allowLoopbackModelForTests: true }))
    await handshake(serverUrl)
    const controller = new AbortController()
    const running = call(serverUrl, CONTEXT, { signal: controller.signal }).catch(() => undefined)
    await vi.waitFor(() => expect(calls).toBe(1))
    controller.abort()
    await running
    await vi.waitFor(() => expect(closed).toBe(true))
    expect(await (await call(serverUrl)).json()).toEqual({ error: 'BUDGET_EXCEEDED' })
    expect(calls).toBe(1)
  })
  it.each(['http://model.example/v1/chat/completions', 'https://user:secret@model.example/v1/chat/completions',
    'https://model.example/v1/chat/completions?url=private', 'https://model.example/v1/chat/completions#private',
    'https://not-allowed.example/v1/chat/completions', 'https://model.example/v1/other'])('rejects an untrusted target config (%s)', url => {
    expect(() => createCoachAgentServer({ ...config, modelUrl: url })).toThrow('INVALID_SERVER_CONFIG')
  })
  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.2', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '198.18.1.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',
    '2001::1', '2001:db8::1', '2001:0db8::1', '2002:7f00:1::', '3fff::1'])('rejects private/special-use model address %s', address => {
    expect(isPublicModelAddress(address)).toBe(false)
  })
  it('checks every DNS result before any connection and does not resolve again', async () => {
    const resolver = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }])
    const serverUrl = await listen(createCoachAgentServer(config, { resolveHost: resolver }))
    await handshake(serverUrl)
    const response = await call(serverUrl)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'TARGET_NOT_ALLOWED' })
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(isPublicModelAddress('8.8.8.8')).toBe(true)
    expect(isPublicModelAddress('2606:4700::1111')).toBe(true)
  })
  it('does not expose the loopback-test bypass via environment configuration', () => {
    const loaded = loadCoachAgentServerConfig({ COACH_AGENT_ENABLED: 'true', COACH_AGENT_ALLOW_LOOPBACK_MODEL_FOR_TESTS: 'true',
      VITE_API_KEY: KEY, JEV_API_KEY: KEY })
    expect(loaded.apiKey).toBeUndefined()
    expect(loaded.allowLoopbackModelForTests).toBeUndefined()
    expect(() => resolveCoachAgentConfig({ ...loaded, modelUrl: 'http://127.0.0.1:1/v1/chat/completions', allowedModelHosts: ['127.0.0.1'] })).toThrow()
  })
  it('rejects invalid budgets, weak capabilities and sharing the model key as a client token', () => {
    expect(() => createCoachAgentServer({ ...config, accessToken: 'short' })).toThrow('INVALID_SERVER_CONFIG')
    expect(() => createCoachAgentServer({ ...config, apiKey: TOKEN })).toThrow('INVALID_SERVER_CONFIG')
    expect(() => createCoachAgentServer({ ...config, maxConcurrent: 0 })).toThrow('INVALID_SERVER_CONFIG')
    expect(() => createCoachAgentServer({ ...config, budgetMicroUsd: -1 })).toThrow('INVALID_SERVER_CONFIG')
    expect(() => createCoachAgentServer({ ...config, origin: 'http://0.0.0.0:5173' })).toThrow('INVALID_SERVER_CONFIG')
  })
})
