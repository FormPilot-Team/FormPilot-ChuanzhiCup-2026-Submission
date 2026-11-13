import { QWEN3_4B_DIGEST, QWEN3_4B_MODEL } from '../local/config.ts'

/**
 * Public demo gateway configuration (Web V1.2 final round). This is a separate, stricter process from the local agent
 * bridge: it serves the AI-Coach-only demo build plus the same `fp-coach-agent/1.2` chat API to remote browsers and
 * forwards model calls to ONE upstream:
 *
 * - `ollama`: the pinned local Qwen3-4B (digest-checked), reached on loopback only;
 * - `openai`: an OpenAI-compatible chat-completions endpoint (e.g. a free cloud tier the owner opened). The API key is
 *   read from the environment by the gateway only; it never reaches the browser, a response, or a log line.
 *
 * Nothing here opens a public port by itself. Exposure (HTTPS host, tunnel, reverse proxy) is a separate, owner-approved
 * step; the gateway only accepts the exact public origins / hosts it is configured with.
 */
export interface DemoGatewayConfigInput {
  enabled?: boolean
  port?: number
  /** Listen address. Loopback by default; 0.0.0.0 only for a container host that terminates HTTPS in front. */
  bind?: string
  /** Exact browser origins of the demo page (https://… in production; http://127.0.0.1:<port> is always allowed). */
  publicOrigins?: string[]
  /** https origins allowed to show the demo in an iframe (hosting platforms that embed apps). Default: none. */
  frameAncestors?: string[]
  staticDir?: string
  upstream?: 'ollama' | 'openai'
  ollamaPort?: number
  openaiBaseUrl?: string
  openaiModel?: string
  openaiApiKey?: string
  /** Adds `enable_thinking: false` (Qwen3 hybrid models on DashScope-style APIs). */
  openaiDisableThinking?: boolean
  /** Shown to visitors next to the answer, e.g. "Qwen3-4B · 演示服务器". */
  label?: string
  /** Which request header carries the visitor address: none (socket), cloudflare (CF-Connecting-IP) or xff. */
  trustProxy?: 'none' | 'cloudflare' | 'xff'
  clientPerMinute?: number
  clientPerDay?: number
  globalPerMinute?: number
  dailyBudget?: number
  maxConcurrent?: number
  timeoutMs?: number
}

function int(value: number | undefined, fallback: number, min: number, max: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error('INVALID_DEMO_CONFIG')
  return result
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

function origin(value: string): URL {
  const parsed = new URL(value)
  if (parsed.origin !== value) throw new Error('INVALID_DEMO_CONFIG')
  if (parsed.protocol === 'https:') return parsed
  if (parsed.protocol === 'http:' && LOOPBACK.has(parsed.hostname)) return parsed
  throw new Error('INVALID_DEMO_CONFIG')
}

export function resolveDemoConfig(input: DemoGatewayConfigInput) {
  const port = int(input.port, 4330, 1024, 65535)
  const bind = input.bind ?? '127.0.0.1'
  if (!['127.0.0.1', '0.0.0.0'].includes(bind)) throw new Error('INVALID_DEMO_CONFIG')
  const local = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
  const configured = (input.publicOrigins ?? []).map((value) => origin(value).origin)
  if (configured.length > 6) throw new Error('INVALID_DEMO_CONFIG')
  const origins = Object.freeze([...new Set([...configured, ...local])])
  const hosts = Object.freeze(origins.map((value) => new URL(value).host))
  const frameAncestors = Object.freeze((input.frameAncestors ?? []).map((value) => {
    const parsed = origin(value)
    if (parsed.protocol !== 'https:') throw new Error('INVALID_DEMO_CONFIG')
    return parsed.origin
  }))
  if (frameAncestors.length > 4) throw new Error('INVALID_DEMO_CONFIG')

  const upstream = input.upstream ?? 'ollama'
  if (upstream !== 'ollama' && upstream !== 'openai') throw new Error('INVALID_DEMO_CONFIG')
  let openai: { baseUrl: string; model: string; apiKey: string; disableThinking: boolean } | null = null
  if (upstream === 'openai') {
    const base = new URL(input.openaiBaseUrl ?? '')
    const loopback = base.protocol === 'http:' && LOOPBACK.has(base.hostname)
    if (!(base.protocol === 'https:' || loopback) || base.username || base.password || base.search || base.hash) throw new Error('INVALID_DEMO_CONFIG')
    const model = input.openaiModel ?? ''
    if (!/^[A-Za-z0-9._:/-]{1,96}$/u.test(model)) throw new Error('INVALID_DEMO_CONFIG')
    const apiKey = input.openaiApiKey ?? ''
    // A remote endpoint needs a key; keys are opaque printable tokens without whitespace.
    if ((!loopback && !apiKey) || (apiKey && !/^[\x21-\x7e]{8,512}$/u.test(apiKey))) throw new Error('INVALID_DEMO_CONFIG')
    openai = { baseUrl: base.href.replace(/\/+$/u, ''), model, apiKey, disableThinking: input.openaiDisableThinking === true }
  }
  const label = (input.label ?? (upstream === 'ollama' ? 'Qwen3-4B-Instruct · 演示服务器' : `${openai!.model} · 云端推理`)).trim()
  if (!label || label.length > 40 || /[<>\n\r]/u.test(label)) throw new Error('INVALID_DEMO_CONFIG')
  const trustProxy = input.trustProxy ?? 'none'
  if (!['none', 'cloudflare', 'xff'].includes(trustProxy)) throw new Error('INVALID_DEMO_CONFIG')

  return Object.freeze({
    enabled: input.enabled === true,
    port, bind, origins, hosts, frameAncestors,
    staticDir: input.staticDir ?? 'dist-public-demo',
    upstream,
    // Ollama upstream: the same pinned identity as the local bridge (verifyInstalledModel checks the digest).
    model: upstream === 'ollama' ? QWEN3_4B_MODEL : openai!.model,
    modelDigest: upstream === 'ollama' ? QWEN3_4B_DIGEST : null,
    modelPort: int(input.ollamaPort, 11434, 1024, 65535),
    openai,
    label,
    trustProxy,
    clientPerMinute: int(input.clientPerMinute, 20, 1, 120),
    clientPerDay: int(input.clientPerDay, 150, 1, 5000),
    globalPerMinute: int(input.globalPerMinute, 60, 1, 600),
    dailyBudget: int(input.dailyBudget, 1500, 1, 100_000),
    maxConcurrent: int(input.maxConcurrent, upstream === 'ollama' ? 1 : 2, 1, 8),
    timeoutMs: int(input.timeoutMs, 60_000, 1000, 180_000),
  })
}
export type ResolvedDemoConfig = ReturnType<typeof resolveDemoConfig>
