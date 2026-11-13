import {
  AGENT_LIMITS, AGENT_TOOLS, parseToolCall,
  type AgentChatRequest, type AgentMessage, type AgentStreamEvent, type AgentToolCall,
} from '../../../src/features/coachLlm/protocol.ts'

/**
 * OpenAI-compatible chat-completions adapter for the demo gateway. It translates the agent protocol to
 * `/chat/completions` (streamed SSE) and back to the same NDJSON events the local bridge emits: text deltas, whitelisted
 * tool calls and usage. Raw provider JSON, reasoning text and unknown fields never reach the browser.
 */

const MAX_STREAM_BYTES = 1_000_000

/** Agent messages → OpenAI messages. Tool results are matched to the preceding assistant's calls by order and name. */
export function toOpenAIMessages(messages: readonly AgentMessage[]) {
  const out: Array<Record<string, unknown>> = []
  let pending: Array<{ id: string; name: string }> = []
  messages.forEach((message, index) => {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      pending = message.toolCalls.map((call, j) => ({ id: `call_${index}_${j}`, name: call.name }))
      out.push({ role: 'assistant', content: message.content || null, tool_calls: message.toolCalls.map((call, j) => ({
        id: pending[j].id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })) })
      return
    }
    if (message.role === 'tool') {
      const slot = pending.findIndex((item) => item.name === message.toolName)
      const id = slot >= 0 ? pending.splice(slot, 1)[0].id : `call_${index}_orphan`
      out.push({ role: 'tool', tool_call_id: id, content: message.content })
      return
    }
    pending = []
    out.push({ role: message.role, content: message.content })
  })
  return out
}

export function openAIChatBody(model: string, parsed: AgentChatRequest, systemPrompt: string, disableThinking: boolean): string {
  return JSON.stringify({
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...toOpenAIMessages(parsed.messages)],
    ...(parsed.allowTools ? { tools: AGENT_TOOLS, tool_choice: 'auto' } : {}),
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: AGENT_LIMITS.maxOutputTokens,
    ...(disableThinking ? { enable_thinking: false } : {}),
  })
}

interface PartialCall { name: string; args: string }

/**
 * POST the body and relay the SSE stream. Errors are thrown as agent error codes (MODEL_UNAVAILABLE, RATE_LIMITED,
 * TIMEOUT, INVALID_MODEL_OUTPUT, INVALID_TOOL_CALL); the HTTP status of the provider is returned for the gateway log.
 */
export async function relayOpenAIChat(
  target: { baseUrl: string; apiKey: string; model: string },
  body: string,
  signal: AbortSignal,
  emit: (event: AgentStreamEvent) => void,
  now: () => number = () => Date.now(),
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST', signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}) },
      body,
    })
  } catch {
    throw new Error(signal.aborted ? 'TIMEOUT' : 'MODEL_UNAVAILABLE')
  }
  if (response.status === 429) { await response.body?.cancel(); const error = new Error('RATE_LIMITED'); (error as Error & { status?: number }).status = 429; throw error }
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    const error = new Error('MODEL_UNAVAILABLE');
    (error as Error & { status?: number }).status = response.status
    throw error
  }

  const calls = new Map<number, PartialCall>()
  let promptTokens: number | null = null
  let outputTokens: number | null = null
  let firstOutput: number | null = null
  let finished = false
  let bytes = 0
  let buffer = ''
  const started = now()

  const flushCalls = () => {
    if (!calls.size) return
    const parsed = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => {
      let args: unknown
      try { args = call.args.trim() ? JSON.parse(call.args) : {} } catch { return null }
      return parseToolCall({ name: call.name, arguments: args })
    })
    calls.clear()
    if (parsed.length > AGENT_LIMITS.maxToolCallsPerMessage || parsed.some((call) => call === null)) throw new Error('INVALID_TOOL_CALL')
    emit({ type: 'tool_calls', calls: parsed as AgentToolCall[] })
  }

  const handle = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (data === '[DONE]') { finished = true; return }
    let chunk: Record<string, unknown>
    try { chunk = JSON.parse(data) as Record<string, unknown> } catch { throw new Error('INVALID_MODEL_OUTPUT') }
    if (chunk.error) throw new Error('MODEL_UNAVAILABLE')
    const usage = chunk.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | null | undefined
    if (usage && typeof usage === 'object') {
      if (typeof usage.prompt_tokens === 'number') promptTokens = usage.prompt_tokens
      if (typeof usage.completion_tokens === 'number') outputTokens = usage.completion_tokens
    }
    const choice = Array.isArray(chunk.choices) ? (chunk.choices[0] as Record<string, unknown> | undefined) : undefined
    if (!choice) return
    const delta = (choice.delta ?? {}) as Record<string, unknown>
    if (typeof delta.content === 'string' && delta.content) {
      if (firstOutput === null) firstOutput = now()
      emit({ type: 'delta', text: delta.content })
    }
    if (Array.isArray(delta.tool_calls)) {
      if (firstOutput === null) firstOutput = now()
      for (const raw of delta.tool_calls as Array<Record<string, unknown>>) {
        const index = typeof raw.index === 'number' ? raw.index : 0
        if (index < 0 || index > AGENT_LIMITS.maxToolCallsPerMessage) throw new Error('INVALID_TOOL_CALL')
        const fn = (raw.function ?? {}) as { name?: unknown; arguments?: unknown }
        const current = calls.get(index) ?? { name: '', args: '' }
        if (typeof fn.name === 'string' && fn.name) current.name = fn.name
        if (typeof fn.arguments === 'string') current.args += fn.arguments
        else if (fn.arguments && typeof fn.arguments === 'object') current.args = JSON.stringify(fn.arguments)
        if (current.args.length > AGENT_LIMITS.maxArgumentChars * 2) throw new Error('INVALID_TOOL_CALL')
        calls.set(index, current)
      }
    }
    if (choice.finish_reason) flushCalls()
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_STREAM_BYTES) throw new Error('INVALID_MODEL_OUTPUT')
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        handle(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) handle(buffer)
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (signal.aborted) throw new Error('TIMEOUT')
    throw error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error : new Error('MODEL_UNAVAILABLE')
  }
  if (!finished && !calls.size && outputTokens === null) throw new Error('INVALID_MODEL_OUTPUT')
  flushCalls()
  const end = now()
  emit({ type: 'done', model: target.model, metrics: {
    promptTokens, outputTokens, promptMs: firstOutput === null ? null : firstOutput - started,
    outputMs: firstOutput === null ? null : Math.max(1, end - firstOutput), loadMs: null, totalMs: end - started,
  } })
}
