import { pathToFileURL } from 'node:url'
import { AGENT_PROTOCOL_VERSION, validateAgentChatRequest, type AgentStreamEvent } from '../../../src/features/coachLlm/protocol.ts'
import { resolveDemoConfig } from './config.ts'
import { openAIChatBody, relayOpenAIChat } from './openaiRelay.ts'
import { DEMO_SYSTEM_PROMPT } from './server.ts'

/**
 * Upstream check before deploying the demo on an OpenAI-compatible endpoint (e.g. a free cloud tier): does this model,
 * through this endpoint, (1) choose the knowledge tool for a 功法 question and (2) answer from the tool result?
 * Uses the same env variables as the gateway; prints outcomes and timings only — never the key, never raw responses.
 *   $env:FP_DEMO_OPENAI_BASE_URL='https://…/v1'; $env:FP_DEMO_OPENAI_MODEL='…'; $env:FP_DEMO_OPENAI_API_KEY='…'
 *   node server/coachAgent/demo/upstreamSmoke.ts
 */
export async function upstreamSmoke(env: NodeJS.ProcessEnv = process.env) {
  const config = resolveDemoConfig({ upstream: 'openai', openaiBaseUrl: env.FP_DEMO_OPENAI_BASE_URL, openaiModel: env.FP_DEMO_OPENAI_MODEL,
    openaiApiKey: env.FP_DEMO_OPENAI_API_KEY || undefined, openaiDisableThinking: env.FP_DEMO_OPENAI_DISABLE_THINKING === 'true' })
  const target = config.openai!
  const round = async (messages: unknown[], allowTools: boolean) => {
    const parsed = validateAgentChatRequest({ protocol: AGENT_PROTOCOL_VERSION, messages, allowTools })
    if (!parsed) throw new Error('invalid smoke request')
    const events: AgentStreamEvent[] = []
    const started = Date.now()
    try {
      await relayOpenAIChat(target, openAIChatBody(target.model, parsed, DEMO_SYSTEM_PROMPT, target.disableThinking), AbortSignal.timeout(60_000), (event) => events.push(event))
    } catch (error) { return { ms: Date.now() - started, error: error instanceof Error ? error.message : 'MODEL_UNAVAILABLE', events } }
    return { ms: Date.now() - started, error: null, events }
  }
  const question = '八段锦第二式左右开弓似射雕有哪些常见错误？'
  const first = await round([{ role: 'user', content: question }], true)
  const calls = first.events.flatMap((event) => (event.type === 'tool_calls' ? event.calls : []))
  console.log(`round 1 (tool choice): ${first.error ?? 'ok'} in ${first.ms} ms · tool calls: ${calls.map((call) => call.name).join(', ') || 'none'}`)
  if (first.error || !calls.length) return { ok: false, reason: first.error ?? 'NO_TOOL_CALL' }
  const toolResult = JSON.stringify({ ok: true, status: 'found', chunks: [{ ref: 'K1', title: '八段锦 · 第二式 · 左右开弓似射雕', text: '常见错误：马步过低或过高、两手不同高、拉弓手向前划平弧。' }] })
  const second = await round([
    { role: 'user', content: question },
    { role: 'assistant', content: '', toolCalls: calls.slice(0, 1) },
    { role: 'tool', toolName: calls[0].name, content: toolResult },
  ], false)
  const text = second.events.flatMap((event) => (event.type === 'delta' ? [event.text] : [])).join('')
  const done = second.events.find((event) => event.type === 'done')
  console.log(`round 2 (answer): ${second.error ?? 'ok'} in ${second.ms} ms · ${text.length} chars · cites K1: ${text.includes('K1')} · tokens ${done?.type === 'done' ? `${done.metrics.promptTokens ?? '?'} in / ${done.metrics.outputTokens ?? '?'} out` : '?'}`)
  return { ok: !second.error && text.length > 0, reason: second.error ?? (text ? null : 'EMPTY_ANSWER') }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void upstreamSmoke().then((result) => { console.log(result.ok ? 'UPSTREAM OK' : `UPSTREAM NOT USABLE: ${result.reason}`); process.exitCode = result.ok ? 0 : 1 })
}
