import { createHash, randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { AGENT_PROTOCOL_VERSION, AGENT_SYSTEM_PROMPT, validateAgentChatRequest, type AgentErrorCode, type AgentStreamEvent } from '../../../src/features/coachLlm/protocol.ts'
import { KNOWN_ERRORS, duplicate, ollamaChatBody, readBody, relayChat } from '../agent/server.ts'
import { resolveLocalConfig } from '../local/config.ts'
import { verifyInstalledModel } from '../local/transport.ts'
import { resolveDemoConfig, type DemoGatewayConfigInput } from './config.ts'
import { openAIChatBody, relayOpenAIChat } from './openaiRelay.ts'

/**
 * FormPilot public demo gateway (Web V1.2 final round).
 *
 * One process, one origin: it serves the AI-Coach-only demo build (`pnpm demo:build`) and the `fp-coach-agent/1.2`
 * chat API the browser agent already speaks, so the agent loop, tools, RAG, M1/M2 and validation run unchanged in the
 * visitor's browser — on the demo's bundled SYNTHETIC records. Only the model call crosses the network.
 *
 * Guards: exact Host and Origin allow-lists, request validation shared with the bridge, server-owned system prompt and
 * tool schemas, per-visitor and global per-minute limits, per-visitor and global daily budgets, bounded concurrency,
 * upstream timeout, no content logging, and an API key that only this process reads.
 */

/** The demo system prompt: the bridge's prompt with its first sentence made true for the hosted demo. */
const LOCAL_OPENING = '你是 FormPilot AI 教练，运行在用户电脑本机的 Qwen 模型上。'
export const DEMO_SYSTEM_PROMPT = (() => {
  if (!AGENT_SYSTEM_PROMPT.startsWith(LOCAL_OPENING)) throw new Error('DEMO_PROMPT_DRIFT')
  return `你是 FormPilot AI 教练，当前运行在 FormPilot 在线演示服务上（演示只包含 AI 教练）。本演示中的训练记录属于一位虚构的示例用户，是程序生成的合成数据，不是访问者本人的数据；回答中提到训练记录时要说明这是合成示例记录。${AGENT_SYSTEM_PROMPT.slice(LOCAL_OPENING.length)}`
})()

const MAX_BODY_BYTES = 96_000
const STATIC_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
})
const CSP_BASE = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"

/** Calendar day in China Standard Time, for daily budgets. */
const dayKey = (time: number) => new Date(time + 8 * 3600_000).toISOString().slice(0, 10)

export function createDemoGateway(input: DemoGatewayConfigInput, options: { now?: () => number; log?: (line: string) => void } = {}) {
  const config = resolveDemoConfig(input)
  const now = options.now ?? (() => Date.now())
  const log = options.log ?? ((line: string) => console.log(line))
  const root = resolve(config.staticDir)
  const csp = `${CSP_BASE}; frame-ancestors ${config.frameAncestors.length ? config.frameAncestors.join(' ') : "'none'"}`
  const localModel = config.upstream === 'ollama'
    ? resolveLocalConfig({ model: config.model, modelDigest: config.modelDigest!, planningProtocol: 'native-tools', testModelPort: config.modelPort })
    : null

  // Visitor keys are salted hashes (salt rotates with the process); addresses are never stored or logged.
  const salt = randomBytes(16).toString('hex')
  let day = dayKey(now())
  let dayTotal = 0
  const perDay = new Map<string, number>()
  const perMinute = new Map<string, number[]>()
  const globalMinute: number[] = []
  let active = 0
  let verifiedAt = 0
  let upstreamFailures = 0
  let failingSince = 0

  const visitor = (req: IncomingMessage) => {
    const header = config.trustProxy === 'cloudflare' ? req.headers['cf-connecting-ip']
      : config.trustProxy === 'xff' ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0] : undefined
    const address = (typeof header === 'string' && header.trim()) || req.socket.remoteAddress || 'unknown'
    return createHash('sha256').update(`${salt}:${address.trim()}`).digest('hex').slice(0, 16)
  }

  async function upstreamReady(force = false): Promise<boolean> {
    if (upstreamFailures >= 3 && now() - failingSince < 60_000) return false
    if (!localModel) return true
    if (!force && now() - verifiedAt < 60_000) return true
    try { await verifyInstalledModel(localModel, AbortSignal.timeout(5000)); verifiedAt = now(); return true } catch { verifiedAt = 0; return false }
  }

  /** Counts one model call against every budget, or names the limit that refuses it. */
  function admit(key: string): AgentErrorCode | null {
    const time = now()
    const today = dayKey(time)
    if (today !== day) { day = today; dayTotal = 0; perDay.clear() }
    while (globalMinute.length && time - globalMinute[0] > 60_000) globalMinute.shift()
    const mine = (perMinute.get(key) ?? []).filter((at) => time - at <= 60_000)
    if (dayTotal >= config.dailyBudget || (perDay.get(key) ?? 0) >= config.clientPerDay) return 'BUDGET_EXCEEDED'
    if (mine.length >= config.clientPerMinute || globalMinute.length >= config.globalPerMinute) return 'RATE_LIMITED'
    if (active >= config.maxConcurrent) return 'BUSY'
    mine.push(time)
    perMinute.set(key, mine)
    globalMinute.push(time)
    perDay.set(key, (perDay.get(key) ?? 0) + 1)
    dayTotal += 1
    if (perMinute.size > 5000) for (const [k, list] of perMinute) if (!list.some((at) => time - at <= 60_000)) perMinute.delete(k)
    return null
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(body))
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
    let decoded: string
    try { decoded = decodeURIComponent(pathname) } catch { json(res, 400, { error: 'INVALID_REQUEST' }); return }
    if (decoded.includes('\0') || decoded.split('/').some((part) => part.startsWith('.'))) { json(res, 404, { error: 'NOT_FOUND' }); return }
    const ext = extname(decoded).toLowerCase()
    // Extension-less paths are app routes (SPA): every route renders the demo page.
    const target = ext ? resolve(root, `.${decoded}`) : resolve(root, 'index.html')
    const rel = relative(root, target)
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) { json(res, 404, { error: 'NOT_FOUND' }); return }
    const type = STATIC_TYPES[extname(target).toLowerCase()]
    if (!type) { json(res, 404, { error: 'NOT_FOUND' }); return }
    let body: Buffer
    try {
      const info = await stat(target)
      if (!info.isFile() || info.size > 8_000_000) throw new Error('NOT_FILE')
      body = await readFile(target)
    } catch { json(res, 404, { error: 'NOT_FOUND' }); return }
    res.statusCode = 200
    res.setHeader('Content-Type', type)
    res.setHeader('Content-Length', body.length)
    res.setHeader('Cache-Control', /[-.][A-Za-z0-9_-]{8,}\.(js|css)$/u.test(target) ? 'public, max-age=31536000, immutable' : 'no-cache')
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 120_000 }, async (req, res) => {
    const started = now()
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (!config.frameAncestors.length) res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('Content-Security-Policy', csp)
    if (duplicate(req, 'host') || !config.hosts.includes(req.headers.host ?? '')) { json(res, 421, { error: 'FORBIDDEN_ORIGIN' }); return }
    const origin = req.headers.origin
    if (origin !== undefined && (duplicate(req, 'origin') || !config.origins.includes(origin))) { json(res, 403, { error: 'FORBIDDEN_ORIGIN' }); return }
    if (!config.enabled) { json(res, 503, { error: 'BRIDGE_DISABLED' }); return }
    const url = new URL(req.url ?? '/', 'http://demo.invalid')

    if (url.pathname === '/v1/coach/agent/health' && req.method === 'GET') {
      const ready = await upstreamReady(url.searchParams.has('refresh'))
      json(res, 200, { protocol: AGENT_PROTOCOL_VERSION, status: ready ? 'ready' : 'model_unavailable', model: config.model, label: config.label,
        runtime: 'remote-demo', upstream: config.upstream === 'ollama' ? 'ollama' : 'openai-compatible', paid: false, tokenRequired: false,
        warm: 'unknown', data: 'synthetic-demo' })
      return
    }
    if (url.pathname === '/v1/coach/agent/chat') {
      if (req.method !== 'POST') { json(res, 405, { error: 'NOT_FOUND' }); return }
      // Browsers always send Origin on POST; a missing one is a non-browser client.
      if (origin === undefined) { json(res, 403, { error: 'FORBIDDEN_ORIGIN' }); return }
      if (!/^application\/json(?:\s*;.*)?$/iu.test(req.headers['content-type'] ?? '')) { json(res, 415, { error: 'INVALID_REQUEST' }); return }
      const key = visitor(req)
      let parsed
      try { parsed = validateAgentChatRequest(JSON.parse(await readBody(req, MAX_BODY_BYTES))) } catch { parsed = null }
      if (!parsed) { json(res, 400, { error: 'INVALID_REQUEST' }); return }
      if (!(await upstreamReady())) { json(res, 503, { error: 'MODEL_UNAVAILABLE' }); return }
      const refused = admit(key)
      if (refused) { log(`${new Date(started).toISOString()} chat ${refused} visitor=${key}`); json(res, 429, { error: refused }); return }

      active += 1
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.timeoutMs)
      res.on('close', () => { if (!res.writableEnded) controller.abort() })
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      const emit = (event: AgentStreamEvent) => { if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`) }
      let outcome = 'ok'
      try {
        if (config.upstream === 'ollama') await relayChat({ modelPort: config.modelPort, model: config.model }, ollamaChatBody(config.model, parsed, DEMO_SYSTEM_PROMPT), controller.signal, emit)
        else await relayOpenAIChat(config.openai!, openAIChatBody(config.openai!.model, parsed, DEMO_SYSTEM_PROMPT, config.openai!.disableThinking), controller.signal, emit, now)
        upstreamFailures = 0
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        const code = (KNOWN_ERRORS.has(message as AgentErrorCode) || message === 'RATE_LIMITED' ? message : controller.signal.aborted ? 'TIMEOUT' : 'MODEL_UNAVAILABLE') as AgentErrorCode
        const status = (error as { status?: number }).status
        outcome = `${code}${status ? ` upstream=${status}` : ''}`
        if (code === 'MODEL_UNAVAILABLE') { upstreamFailures += 1; if (upstreamFailures === 3) failingSince = now() }
        emit({ type: 'error', code })
      } finally {
        clearTimeout(timer)
        active -= 1
        res.end()
        // One line per model call: no question, no tool data, no answer text, no address.
        log(`${new Date(started).toISOString()} chat ${outcome} ${now() - started}ms tools=${parsed.allowTools} visitor=${key} today=${dayTotal}/${config.dailyBudget}`)
      }
      return
    }
    if (url.pathname.startsWith('/v1/')) { json(res, 404, { error: 'NOT_FOUND' }); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { error: 'NOT_FOUND' }); return }
    await serveStatic(req, res, url.pathname)
  })

  return { server, config, upstreamReady }
}
