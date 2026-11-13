import type { AgentTransport } from './agent'
import { AGENT_PROTOCOL_VERSION, type AgentChatRequest, type AgentStreamEvent } from './protocol'

/** Where the local agent bridge listens (server/coachAgent/agent). Build-time setting; loopback only. */
export function agentBridgeUrl(env: { VITE_COACH_AGENT_URL?: string } = (import.meta.env ?? {}) as { VITE_COACH_AGENT_URL?: string }): string {
  const value = env.VITE_COACH_AGENT_URL || 'http://127.0.0.1:4321'
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return url.origin
  } catch { /* fall through */ }
  return 'http://127.0.0.1:4321'
}

/** Build switch: VITE_COACH_AGENT=off removes the free-text agent (no loopback probe at all). Default: on. */
export function agentFeatureEnabled(env: { VITE_COACH_AGENT?: string } = (import.meta.env ?? {}) as { VITE_COACH_AGENT?: string }): boolean {
  return env.VITE_COACH_AGENT !== 'off'
}

export interface AgentHealth {
  status: 'ready' | 'model_unavailable' | 'bridge_unavailable' | 'disabled'
  model: string | null
  /** Bridge's knowledge of VRAM residency: 'loading' while a preload runs; informational only. */
  warm?: 'unknown' | 'loading' | 'warm' | 'failed'
}

export async function checkAgentHealth(base = agentBridgeUrl(), fetcher: typeof fetch = fetch, timeoutMs = 2500): Promise<AgentHealth> {
  try {
    const response = await fetcher(`${base}/v1/coach/agent/health`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
    if (!response.ok) return { status: 'bridge_unavailable', model: null }
    const body = await response.json() as { protocol?: string; status?: string; model?: string; warm?: string }
    if (body.protocol !== AGENT_PROTOCOL_VERSION) return { status: 'bridge_unavailable', model: null }
    const warm = (['unknown', 'loading', 'warm', 'failed'] as const).find((value) => value === body.warm)
    return { status: body.status === 'ready' ? 'ready' : 'model_unavailable', model: typeof body.model === 'string' ? body.model : null, ...(warm ? { warm } : {}) }
  } catch {
    return { status: 'bridge_unavailable', model: null }
  }
}

const EVENT_TYPES = new Set(['delta', 'tool_calls', 'done', 'error'])

/** NDJSON streaming transport to the local bridge. */
export function createBridgeTransport(base = agentBridgeUrl(), fetcher: typeof fetch = fetch): AgentTransport {
  return {
    async chat(request: AgentChatRequest, onEvent: (event: AgentStreamEvent) => void, signal: AbortSignal) {
      const response = await fetcher(`${base}/v1/coach/agent/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal })
      if (!response.ok || !response.body) {
        let code = 'MODEL_UNAVAILABLE'
        try { code = ((await response.json()) as { error?: string }).error ?? code } catch { /* not JSON */ }
        onEvent({ type: 'error', code: code as Extract<AgentStreamEvent, { type: 'error' }>['code'] })
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const flush = (line: string) => {
        if (!line.trim()) return
        const event = JSON.parse(line) as AgentStreamEvent
        if (!event || !EVENT_TYPES.has(event.type)) throw new Error('INVALID_STREAM')
        onEvent(event)
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index = buffer.indexOf('\n')
        while (index >= 0) {
          flush(buffer.slice(0, index))
          buffer = buffer.slice(index + 1)
          index = buffer.indexOf('\n')
        }
      }
      flush(buffer)
    },
  }
}
