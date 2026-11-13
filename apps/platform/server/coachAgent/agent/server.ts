import { timingSafeEqual } from 'node:crypto'
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  AGENT_LIMITS, AGENT_PROTOCOL_VERSION, AGENT_SYSTEM_PROMPT, AGENT_TOOLS, parseToolCall, toOllamaMessages, validateAgentChatRequest,
  type AgentChatRequest, type AgentErrorCode, type AgentStreamEvent, type AgentToolCall,
} from '../../../src/features/coachLlm/protocol.ts'
import { resolveLocalConfig } from '../local/config.ts'
import { verifyInstalledModel } from '../local/transport.ts'
import { resolveAgentConfig, type AgentBridgeConfigInput, type ResolvedAgentConfig } from './config.ts'

const MAX_BODY_BYTES = 96_000
const MAX_STREAM_BYTES = 1_000_000

export function duplicate(req: IncomingMessage, name: string): boolean {
  let count = 0
  for (let index = 0; index < req.rawHeaders.length; index += 2) if (req.rawHeaders[index].toLowerCase() === name) count += 1
  return count > 1
}

export function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > maxBytes) { req.destroy(); reject(new Error('TOO_LARGE')); return }
      chunks.push(chunk)
    })
    req.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.once('error', reject)
    req.once('aborted', () => reject(new Error('ABORTED')))
  })
}

/**
 * Forward one /api/chat stream from Ollama, re-emitting only validated events: text deltas, whitelisted tool calls,
 * and final usage metrics. Raw model JSON, thinking text and unknown fields never reach the browser.
 */
export function relayChat(config: Pick<ResolvedAgentConfig, 'modelPort' | 'model'>, body: string, signal: AbortSignal, emit: (event: AgentStreamEvent) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', family: 4, port: config.modelPort, path: '/api/chat', method: 'POST', agent: false, signal,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Accept: 'application/x-ndjson' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('MODEL_UNAVAILABLE')); return }
      let buffer = ''
      let bytes = 0
      let finished = false
      const handle = (line: string) => {
        if (!line.trim()) return
        let chunk: Record<string, unknown>
        try { chunk = JSON.parse(line) as Record<string, unknown> } catch { throw new Error('INVALID_MODEL_OUTPUT') }
        if (chunk.error) throw new Error('MODEL_UNAVAILABLE')
        const message = (chunk.message ?? {}) as Record<string, unknown>
        if (typeof message.content === 'string' && message.content) emit({ type: 'delta', text: message.content })
        if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
          const calls = message.tool_calls.slice(0, AGENT_LIMITS.maxToolCallsPerMessage + 1).map((item) => {
            const fn = (item as { function?: { name?: unknown; arguments?: unknown } })?.function
            return parseToolCall({ name: fn?.name, arguments: fn?.arguments ?? {} })
          })
          if (calls.length > AGENT_LIMITS.maxToolCallsPerMessage || calls.some((call) => call === null)) throw new Error('INVALID_TOOL_CALL')
          emit({ type: 'tool_calls', calls: calls as AgentToolCall[] })
        }
        if (chunk.done === true) {
          finished = true
          const ms = (value: unknown) => (typeof value === 'number' ? Math.round(value / 1e6) : null)
          const count = (value: unknown) => (typeof value === 'number' ? value : null)
          emit({ type: 'done', model: config.model, metrics: {
            promptTokens: count(chunk.prompt_eval_count), outputTokens: count(chunk.eval_count),
            promptMs: ms(chunk.prompt_eval_duration), outputMs: ms(chunk.eval_duration), loadMs: ms(chunk.load_duration), totalMs: ms(chunk.total_duration),
          } })
        }
      }
      res.setEncoding('utf8')
      res.on('data', (text: string) => {
        bytes += Buffer.byteLength(text)
        if (bytes > MAX_STREAM_BYTES) { res.destroy(new Error('INVALID_MODEL_OUTPUT')); return }
        buffer += text
        let index = buffer.indexOf('\n')
        try {
          while (index >= 0) {
            handle(buffer.slice(0, index))
            buffer = buffer.slice(index + 1)
            index = buffer.indexOf('\n')
          }
        } catch (error) { res.destroy(error as Error) }
      })
      res.once('error', (error) => reject(error))
      res.once('end', () => {
        try { if (buffer.trim()) handle(buffer) } catch (error) { reject(error); return }
        if (finished) resolve()
        else reject(new Error('INVALID_MODEL_OUTPUT'))
      })
    })
    req.once('error', (error) => reject(signal.aborted ? new Error('TIMEOUT') : error))
    req.end(body)
  })
}

/** The /api/chat body the bridge sends: server-owned system prompt, tool schemas and sampling options. */
export function ollamaChatBody(model: string, parsed: AgentChatRequest, systemPrompt: string = AGENT_SYSTEM_PROMPT): string {
  return JSON.stringify({
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...toOllamaMessages(parsed.messages)],
    ...(parsed.allowTools ? { tools: AGENT_TOOLS } : {}),
    stream: true,
    think: false,
    keep_alive: '30m',
    options: { temperature: 0.2, top_p: 0.9, num_ctx: AGENT_LIMITS.contextTokens, num_predict: AGENT_LIMITS.maxOutputTokens },
  })
}

export const KNOWN_ERRORS = new Set<AgentErrorCode>(['MODEL_UNAVAILABLE', 'TIMEOUT', 'INVALID_MODEL_OUTPUT', 'INVALID_TOOL_CALL'])

/**
 * The V1.2 agent bridge: loopback only, exact Origin allow-list, Host check, optional bearer token, one generation at
 * a time, per-minute and lifetime request budgets. It holds no training data, reads no files and calls no network
 * service other than the pinned local Ollama model.
 */
export function createAgentBridge(input: AgentBridgeConfigInput = {}) {
  const config = resolveAgentConfig(input)
  const modelConfig = resolveLocalConfig({ model: config.model, modelDigest: config.modelDigest, planningProtocol: 'native-tools', testModelPort: config.modelPort })
  let verifiedAt = 0
  let active = false
  let total = 0
  let windowStart = Date.now()
  let windowCount = 0
  /** Whether the model is known to be resident in VRAM (preloaded or answered recently). Informational only. */
  let warm: 'unknown' | 'loading' | 'warm' | 'failed' = 'unknown'

  async function verify(force = false): Promise<boolean> {
    if (!force && Date.now() - verifiedAt < 60_000) return true
    try {
      await verifyInstalledModel(modelConfig, AbortSignal.timeout(5000))
      verifiedAt = Date.now()
      return true
    } catch { verifiedAt = 0; return false }
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }

  const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const origin = req.headers.origin
    const hostOk = !duplicate(req, 'host') && [`127.0.0.1:${config.port}`, `localhost:${config.port}`].includes(req.headers.host ?? '')
    const originOk = typeof origin === 'string' && !duplicate(req, 'origin') && config.origins.includes(origin)
    if (!hostOk) { json(res, 421, { error: 'FORBIDDEN_ORIGIN' }); return }
    if (originOk) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${config.port}`)
    if (req.method === 'OPTIONS') {
      if (!originOk) { json(res, 403, { error: 'FORBIDDEN_ORIGIN' }); return }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      res.setHeader('Access-Control-Max-Age', '600')
      res.statusCode = 204
      res.end()
      return
    }
    if (!originOk) { json(res, 403, { error: 'FORBIDDEN_ORIGIN' }); return }
    if (!config.enabled) { json(res, 503, { error: 'BRIDGE_DISABLED' }); return }

    if (req.method === 'GET' && url.pathname === '/v1/coach/agent/health') {
      const ready = await verify(url.searchParams.has('refresh'))
      json(res, 200, { protocol: AGENT_PROTOCOL_VERSION, status: ready ? 'ready' : 'model_unavailable', model: config.model, digest: `sha256:${config.modelDigest.slice(0, 12)}…`,
        runtime: 'ollama-local', paid: false, tokenRequired: !!config.accessToken, warm })
      return
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/coach/agent/chat') { json(res, 404, { error: 'NOT_FOUND' }); return }
    if (config.accessToken) {
      const expected = Buffer.from(`Bearer ${config.accessToken}`)
      const supplied = Buffer.from(req.headers.authorization ?? '')
      if (duplicate(req, 'authorization') || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { json(res, 401, { error: 'FORBIDDEN_ORIGIN' }); return }
    }
    if (!/^application\/json(?:\s*;.*)?$/iu.test(req.headers['content-type'] ?? '')) { json(res, 415, { error: 'INVALID_REQUEST' }); return }
    const now = Date.now()
    if (now - windowStart > 60_000) { windowStart = now; windowCount = 0 }
    if (total >= config.maxRequests) { json(res, 429, { error: 'BUDGET_EXCEEDED' }); return }
    if (windowCount >= config.requestsPerMinute) { json(res, 429, { error: 'RATE_LIMITED' }); return }
    if (active) { json(res, 429, { error: 'BUSY' }); return }
    let parsed
    try { parsed = validateAgentChatRequest(JSON.parse(await readBody(req))) } catch { parsed = null }
    if (!parsed) { json(res, 400, { error: 'INVALID_REQUEST' }); return }
    if (!(await verify())) { json(res, 503, { error: 'MODEL_UNAVAILABLE' }); return }

    active = true
    total += 1
    windowCount += 1
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    const emit = (event: AgentStreamEvent) => { if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`) }
    const body = ollamaChatBody(config.model, parsed)
    try {
      await relayChat(config, body, controller.signal, emit)
      warm = 'warm'
    } catch (error) {
      const code = (error instanceof Error && KNOWN_ERRORS.has(error.message as AgentErrorCode) ? error.message : controller.signal.aborted ? 'TIMEOUT' : 'MODEL_UNAVAILABLE') as AgentErrorCode
      emit({ type: 'error', code })
    } finally {
      clearTimeout(timer)
      active = false
      res.end()
    }
  })
  /**
   * Optional warm-up (FP_AGENT_PRELOAD=true): ask Ollama to load the pinned model with an empty prompt so the first
   * user question does not pay the cold load (measured 36.5 s from the USB F: drive). Generates no text.
   */
  async function preload(timeoutMs = 180_000): Promise<boolean> {
    if (!config.enabled || !(await verify(true))) { warm = 'failed'; return false }
    warm = 'loading'
    const body = JSON.stringify({ model: config.model, prompt: '', stream: false, keep_alive: '30m' })
    const ok = await new Promise<boolean>((resolve) => {
      const req = request({ hostname: '127.0.0.1', family: 4, port: config.modelPort, path: '/api/generate', method: 'POST', agent: false, timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => { res.resume(); res.once('end', () => resolve(res.statusCode === 200)) })
      req.once('error', () => resolve(false))
      req.once('timeout', () => { req.destroy(); resolve(false) })
      req.end(body)
    })
    warm = ok ? 'warm' : 'failed'
    return ok
  }

  return { server, config, verify, preload }
}
