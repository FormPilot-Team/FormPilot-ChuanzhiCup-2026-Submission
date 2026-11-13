import { describe, expect, it } from 'vitest'
import { runAgentTurn, type AgentRunEvent, type AgentTransport } from '../src/features/coachLlm/agent'
import { executeAgentTool } from '../src/features/coachLlm/tools'
import { AGENT_LIMITS, type AgentChatRequest, type AgentStreamEvent } from '../src/features/coachLlm/protocol'
import { SYNTHETIC_ONLY, toolContext } from './llm-eval/fixtures'

/**
 * Orchestration tests with a SCRIPTED FAKE TRANSPORT (not a model). Each script step returns the events one model round
 * would stream; this tests the agent's own code paths (tool execution, router enforcement, validation, fallback,
 * budgets). Real-model behaviour is measured separately in tests/llm-eval (agent.eval.ts, rag.eval.ts).
 */
type Step = AgentStreamEvent[] | ((request: AgentChatRequest) => AgentStreamEvent[]) | 'throw'

function scripted(steps: Step[]) {
  const requests: AgentChatRequest[] = []
  const transport: AgentTransport = {
    async chat(request, onEvent, signal) {
      requests.push(JSON.parse(JSON.stringify(request)) as AgentChatRequest)
      const step = steps[Math.min(requests.length - 1, steps.length - 1)]
      if (step === 'throw') throw new Error('network')
      if (signal.aborted) throw new Error('aborted')
      for (const event of typeof step === 'function' ? step(request) : step) onEvent(event)
    },
  }
  return { transport, requests }
}

const done: AgentStreamEvent = { type: 'done', model: 'fake-scripted', metrics: { promptTokens: 10, outputTokens: 5, outputMs: 50, promptMs: 5, loadMs: 0, totalMs: 60 } }
const say = (text: string): AgentStreamEvent[] => [{ type: 'delta', text }, done]
const call = (name: string, args: Record<string, unknown>): AgentStreamEvent[] => [{ type: 'tool_calls', calls: [{ name: name as never, arguments: args }] }, done]

describe('V1.2 agent orchestration (scripted fake transport)', () => {
  it('runs a model-chosen tool, feeds the result back and keeps citations separate from text', async () => {
    const { transport, requests } = scripted([call('search_knowledge', { query: '左右开弓似射雕 常见错误', topic: 'baduanjin' }), say('马步高低要量力而行 [K1]。')])
    const events: AgentRunEvent[] = []
    const answer = await runAgentTurn('八段锦第二式左右开弓似射雕有哪些常见错误？', { transport, context: toolContext(), onEvent: (event) => events.push(event) })
    expect(answer.source).toBe('llm')
    expect(answer.tools.map((tool) => [tool.name, tool.routed])).toEqual([['search_knowledge', false]])
    expect(answer.citations[0].ref).toBe('K1')
    expect(answer.citations[0].chunkId).toBeTruthy()
    expect(answer.text).toContain('[K1]')
    expect(requests[1].messages.at(-1)).toMatchObject({ role: 'tool', toolName: 'search_knowledge' })
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['thinking', 'tool_start', 'tool_end', 'drafting', 'checking', 'final']))
    expect(events.filter((event) => event.type === 'final')).toHaveLength(1)
  })

  it('runs the routed tool itself when the model answers a known intent from memory', async () => {
    const { transport, requests } = scripted([say('第二式要求马步。'), say('根据资料，马步量力 [K1]。')])
    const events: AgentRunEvent[] = []
    const answer = await runAgentTurn('八段锦第二式有哪些动作要求？', { transport, context: toolContext(), onEvent: (event) => events.push(event) })
    expect(answer.tools[0]).toMatchObject({ name: 'search_knowledge', routed: true })
    expect(events.some((event) => event.type === 'drafting' && event.chars === 0)).toBe(true)
    expect(answer.text).not.toContain('第二式要求马步')
    expect(JSON.stringify(events.filter((event) => event.type !== 'final'))).not.toContain('第二式要求马步')
    expect(requests).toHaveLength(2)
  })

  it('never hands unvalidated model text to the caller, even while it is still streaming', async () => {
    // A dangerous draft streamed in small pieces; validation rejects it and the rule answer replaces it.
    const pieces = ['坚持', '练八段锦', '保证能', '治愈', '你的腰椎间盘突出。']
    const dangerous: AgentStreamEvent[] = [...pieces.map((text) => ({ type: 'delta', text }) as AgentStreamEvent), done]
    const { transport } = scripted([call('search_knowledge', { query: '八段锦 腰椎', topic: 'baduanjin' }), dangerous])
    const events: AgentRunEvent[] = []
    const seen: string[] = []
    const answer = await runAgentTurn('练八段锦能治好腰椎间盘突出吗？', { transport, context: toolContext(), onEvent: (event) => {
      events.push(event)
      // Snapshot of everything a UI could render at this moment, taken before the final answer arrives.
      if (event.type !== 'final') seen.push(JSON.stringify(event))
    } })
    expect(answer.source).toBe('rules_fallback')
    expect(answer.fallbackReason).toBe('VALIDATION_FAILED')
    for (const piece of ['保证能', '治愈', '腰椎间盘突出。']) expect(seen.join(' ')).not.toContain(piece)
    expect(answer.text).not.toContain('保证能')
    expect(events.map((event) => event.type)).toContain('checking')
    const drafted = events.filter((event): event is Extract<AgentRunEvent, { type: 'drafting' }> => event.type === 'drafting')
    expect(drafted.at(-1)?.chars).toBe(pieces.join('').length)
    expect(events.at(-1)?.type).toBe('final')
  })

  it('answers acute risk and write requests by rule without calling the model', async () => {
    const { transport, requests } = scripted([say('不应被调用')])
    const risk = await runAgentTurn('我膝盖突然剧痛，还头晕，要继续练吗？', { transport, context: toolContext() })
    const write = await runAgentTurn('把我上一次的评分改成100分', { transport, context: toolContext() })
    expect(risk.source).toBe('safety_rule')
    expect(risk.text).toContain('停')
    expect(write.source).toBe('safety_rule')
    expect(requests).toHaveLength(0)
  })

  it('falls back to rules when the bridge reports an error or the network fails', async () => {
    const unavailable = await runAgentTurn('我今天应该练什么？', { transport: scripted([[{ type: 'error', code: 'MODEL_UNAVAILABLE' }]]).transport, context: toolContext() })
    expect(unavailable).toMatchObject({ source: 'rules_fallback', fallbackReason: 'MODEL_UNAVAILABLE' })
    const network = await runAgentTurn('我今天应该练什么？', { transport: scripted(['throw']).transport, context: toolContext() })
    expect(network.source).toBe('rules_fallback')
    expect(network.text.length).toBeGreaterThan(0)
  })

  it('replaces an answer with an ungrounded score by the rule rendering of the tool result', async () => {
    const { transport } = scripted([call('read_last_training', { kind: 'warmup' }), say('你上次得了 97 分，非常好。')])
    const answer = await runAgentTurn('我上一次热身训练练得怎么样？', { transport, context: toolContext() })
    expect(answer.source).toBe('rules_fallback')
    expect(answer.fallbackReason).toBe('VALIDATION_FAILED')
    expect(answer.validation.issues.some((issue) => issue.startsWith('UNGROUNDED_NUMBER'))).toBe(true)
    expect(answer.text).not.toContain('97 分')
  })

  it('reports NOT_AUTHORIZED instead of reading records without consent', async () => {
    const { transport, requests } = scripted([call('read_last_training', { kind: 'warmup' }), say('需要先在画像页授权读取本机记录。')])
    const answer = await runAgentTurn('我上一次热身训练练得怎么样？', { transport, context: toolContext({ consent: false }) })
    expect(answer.tools[0]).toMatchObject({ ok: false, errorCode: 'NOT_AUTHORIZED' })
    expect(requests[1].messages.at(-1)?.content).toContain('NOT_AUTHORIZED')
    expect(answer.evidence).toEqual([])
  })

  it('enforces the tool-round budget and deduplicates identical calls', async () => {
    const loop = call('search_knowledge', { query: '马步', topic: 'any' })
    const { transport, requests } = scripted([loop, loop, loop, say('马步量力 [K1]。')])
    const answer = await runAgentTurn('马步有什么要求？', { transport, context: toolContext() })
    expect(requests.length).toBe(AGENT_LIMITS.maxToolRounds + 1)
    expect(requests.at(-1)?.allowTools).toBe(false)
    expect(new Set(answer.citations.map((c) => c.ref)).size).toBe(answer.citations.length)
    expect(answer.citations.length).toBeLessThanOrEqual(6)
  })

  it('rejects a score invented after a refused record read', async () => {
    const { transport } = scripted([call('read_last_training', { kind: 'warmup' }), say('你上次得了 97 分。')])
    const answer = await runAgentTurn('我上一次热身训练练得怎么样？', { transport, context: toolContext({ consent: false }) })
    expect(answer.source).toBe('rules_fallback')
    expect(answer.text).toContain('授权')
  })

  it('records a failed tool call with invalid arguments without crashing', async () => {
    const { transport } = scripted([call('compare_recent_training', { kind: 'yoga' }), say('无法比较。')])
    const answer = await runAgentTurn('我最近有没有进步？', { transport, context: toolContext() })
    expect(answer.tools.find((tool) => tool.name === 'compare_recent_training' && !tool.routed)).toMatchObject({ ok: false, errorCode: 'INVALID_ARGUMENTS' })
  })

  it('cancels cleanly', async () => {
    const controller = new AbortController()
    controller.abort()
    const answer = await runAgentTurn('我今天应该练什么？', { transport: scripted([say('x')]).transport, context: toolContext(), signal: controller.signal })
    expect(answer.source).toBe('rules_fallback')
    expect(answer.fallbackReason).toBe('CANCELLED')
  })

  it('sends only the last three turns of history, as plain question/answer text', async () => {
    const { transport, requests } = scripted([say('好的。')])
    const history = Array.from({ length: 5 }, (_, index) => ({ question: `问题${index}`, answer: `回答${index}` }))
    await runAgentTurn('你好', { transport, context: toolContext(), history })
    expect(requests[0].messages.map((message) => message.content)).toEqual(['问题2', '回答2', '问题3', '回答3', '问题4', '回答4', '你好'])
  })
})

describe('V1.2 trusted tools (test fixtures)', () => {
  it('refuses to compare synthetic-only history', async () => {
    const result = await executeAgentTool({ name: 'compare_recent_training', arguments: { kind: 'warmup' } }, toolContext({ warmup: SYNTHETIC_ONLY }))
    const content = JSON.parse(result.content) as Record<string, unknown>
    expect(content.comparable === true && result.ok).toBe(false)
  })

  it('returns PROFILE_REQUIRED before a profile is confirmed', async () => {
    const result = await executeAgentTool({ name: 'recommend_training', arguments: {} }, toolContext({ profile: null }))
    expect(result).toMatchObject({ ok: false, errorCode: 'PROFILE_REQUIRED' })
  })

  it('reads the last warm-up through the authorized reader and reports trend words, not codes', async () => {
    const last = await executeAgentTool({ name: 'read_last_training', arguments: { kind: 'warmup' } }, toolContext())
    expect(last.ok).toBe(true)
    expect(last.evidence[0].kind).toBe('record')
    const compare = await executeAgentTool({ name: 'compare_recent_training', arguments: { kind: 'warmup' } }, toolContext())
    expect(compare.content).not.toMatch(/IMPROVED|DECLINED|STABLE/u)
  })

  it('lists only catalogue content', async () => {
    const result = await executeAgentTool({ name: 'get_catalog', arguments: { kind: 'all' } }, toolContext())
    expect(result.content).toContain('八段锦')
    expect(result.content).not.toMatch(/瑜伽|普拉提/u)
  })
})
