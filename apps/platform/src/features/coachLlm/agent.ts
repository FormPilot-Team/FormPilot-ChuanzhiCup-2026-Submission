import { MEDICAL_NOTICE, RISK_ANSWER, WRITE_ANSWER, classifyQuestion, validateAnswer, type GuardFlag } from './guard'
import { AGENT_LIMITS, AGENT_PROTOCOL_VERSION, type AgentChatRequest, type AgentMessage, type AgentMetrics, type AgentStreamEvent, type AgentToolCall, type AgentToolName } from './protocol'
import { contextualQuery, routeQuestion } from './router'
import { executeAgentTool, toolLabel, type AgentToolContext, type ToolCitation, type ToolEvidence, type ToolExecution } from './tools'

/**
 * One V1.2 agent turn: guard → model (native tool calls, streamed) → trusted tool execution → model answer →
 * validation → answer or rule fallback. The orchestration, tool budget, authorization and validation are application
 * code; the model only chooses tools and writes the explanation. Model text and tool evidence stay separate.
 */

export interface AgentTransport {
  chat(request: AgentChatRequest, onEvent: (event: AgentStreamEvent) => void, signal: AbortSignal): Promise<void>
}

export type AgentAnswerSource = 'llm' | 'rules_fallback' | 'safety_rule'

export interface AgentToolTrace { name: AgentToolName; label: string; arguments: Record<string, unknown>; ok: boolean; summary: string; errorCode: string | null; elapsedMs: number
  /** Added by the intent router because the model tried to answer without it. */
  routed: boolean }

export interface AgentAnswer {
  text: string
  source: AgentAnswerSource
  flags: GuardFlag[]
  notice: string | null
  validation: { ok: boolean; issues: string[] }
  fallbackReason: string | null
  citations: ToolCitation[]
  evidence: ToolEvidence[]
  tools: AgentToolTrace[]
  metrics: { rounds: number; ttftMs: number | null; totalMs: number; modelMs: number; promptTokens: number; outputTokens: number; model: string | null; tokensPerSecond: number | null }
}

export type AgentRunEvent =
  | { type: 'thinking'; round: number }
  | { type: 'tool_start'; name: AgentToolName; label: string; arguments: Record<string, unknown> }
  | { type: 'tool_end'; trace: AgentToolTrace }
  | { type: 'delta'; text: string }
  | { type: 'reset' }
  | { type: 'final'; answer: AgentAnswer }

export interface AgentTurnOptions {
  transport: AgentTransport
  context: AgentToolContext
  /** Previous turns: user questions and final answers only (no tool traffic). */
  history?: ReadonlyArray<{ question: string; answer: string }>
  signal?: AbortSignal
  onEvent?: (event: AgentRunEvent) => void
  now?: () => number
}

const MAX_TOOL_CALLS_PER_TURN = 5

function emptyMetrics() {
  return { rounds: 0, ttftMs: null as number | null, totalMs: 0, modelMs: 0, promptTokens: 0, outputTokens: 0, model: null as string | null, tokensPerSecond: null as number | null }
}

/** Deterministic answer from this turn's tool results (no model text). */
export function ruleFallbackText(executions: readonly ToolExecution[], question: string): string {
  const lines: string[] = []
  for (const execution of executions) {
    if (!execution.ok) { lines.push(execution.summary); continue }
    let data: Record<string, unknown>
    try { data = JSON.parse(execution.content) as Record<string, unknown> } catch { continue }
    if (execution.call.name === 'search_knowledge') {
      if (data.status === 'insufficient') { lines.push('知识库中没有与这个问题足够相关的资料。'); continue }
      for (const c of execution.citations.slice(0, 3)) lines.push(`· ${c.title}：${c.text.split('\n')[0].replace(/^[^：]+：/u, '')} [${c.ref}]`)
    } else if (execution.call.name === 'recommend_training') {
      if (data.status === 'safety_hold') { lines.push(String(data.message)); continue }
      const items = (data.items as Array<{ title: string; kind: string }> | undefined) ?? []
      lines.push(`${String(data.decisionOrigin)}：${items.slice(0, 3).map((item) => `${item.kind}「${item.title}」`).join('、')}。`)
    } else if (execution.call.name === 'read_last_training') {
      const parts = [data.date, data.status, data.overallScore ?? data.followAlongSimilarity, data.weakestChapter].filter(Boolean)
      lines.push(`${String(data.kind)}：${parts.join('；')}。`)
      for (const issue of ((data.mainIssues as Array<{ issue: string; cue: string }> | undefined) ?? []).slice(0, 2)) lines.push(`· ${issue.issue}（${issue.cue}）`)
    } else if (execution.call.name === 'compare_recent_training') {
      lines.push(data.comparable ? `与 ${String(data.previousDate ?? '上一次')} 比较（${String(data.gate)}）：${[data.overallChange, data.similarityChange, ...(((data.exerciseChanges as string[] | undefined) ?? []).slice(0, 3))].filter(Boolean).join('；')}。` : `暂时无法判断进步：${String(data.reason ?? '没有可比较的同类记录')}。`)
    } else if (execution.call.name === 'get_catalog') {
      const routines = (data.routines as Array<{ title: string }> | undefined)?.map((item) => item.title).join('、')
      if (routines) lines.push(`功法：${routines}`)
      if (data.warmup) lines.push(`热身动作：${(data.warmup as string[]).join('、')}`)
      if (data.games) lines.push(`体感游戏：${(data.games as string[]).join('、')}`)
    }
  }
  if (!lines.length) return question.trim() ? '本地 AI 模型暂时无法回答这个问题。可以使用上方的固定问题，或稍后再试。' : ''
  return lines.join('\n')
}

export async function runAgentTurn(question: string, options: AgentTurnOptions): Promise<AgentAnswer> {
  const now = options.now ?? (() => performance.now())
  const started = now()
  const emit = (event: AgentRunEvent) => options.onEvent?.(event)
  const metrics = emptyMetrics()
  const { flags } = classifyQuestion(question)
  const finish = (answer: Omit<AgentAnswer, 'metrics' | 'flags'>) => {
    metrics.totalMs = Math.round(now() - started)
    const final: AgentAnswer = { ...answer, flags, metrics }
    emit({ type: 'final', answer: final })
    return final
  }

  if (flags.includes('risk') || flags.includes('write_request')) {
    return finish({ text: flags.includes('risk') ? RISK_ANSWER : WRITE_ANSWER, source: 'safety_rule', notice: null,
      validation: { ok: true, issues: [] }, fallbackReason: null, citations: [], evidence: [], tools: [] })
  }

  const messages: AgentMessage[] = []
  for (const turn of (options.history ?? []).slice(-3)) {
    messages.push({ role: 'user', content: turn.question.slice(0, 1000) }, { role: 'assistant', content: turn.answer.slice(0, 1500) })
  }
  messages.push({ role: 'user', content: question.slice(0, 2000) })

  const executions: ToolExecution[] = []
  const traces: AgentToolTrace[] = []
  const cache = new Map<string, ToolExecution>()
  let refOffset = 0
  let answerText = ''
  let failure: string | null = null
  let routerUsed = false
  const routedQuestion = contextualQuery(question, options.history ?? [])
  const routed_calls = () => routeQuestion(routedQuestion).calls
  const controller = new AbortController()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', () => controller.abort(), { once: true })

  for (let round = 0; round <= AGENT_LIMITS.maxToolRounds; round += 1) {
    if (controller.signal.aborted) { failure = 'CANCELLED'; break }
    emit({ type: 'thinking', round })
    metrics.rounds = round + 1
    const allowTools = round < AGENT_LIMITS.maxToolRounds && traces.length < MAX_TOOL_CALLS_PER_TURN
    let content = ''
    let calls: AgentToolCall[] = []
    let error: string | null = null
    const roundStart = now()
    try {
      await options.transport.chat({ protocol: AGENT_PROTOCOL_VERSION, messages, allowTools }, (event) => {
        if (event.type === 'delta') {
          if (metrics.ttftMs === null) metrics.ttftMs = Math.round(now() - started)
          content += event.text
          emit({ type: 'delta', text: event.text })
        } else if (event.type === 'tool_calls') calls = calls.concat(event.calls)
        else if (event.type === 'done') {
          metrics.model = event.model
          addMetrics(metrics, event.metrics)
        } else if (event.type === 'error') error = event.code
      }, controller.signal)
    } catch {
      error = controller.signal.aborted ? 'CANCELLED' : 'MODEL_UNAVAILABLE'
    }
    metrics.modelMs += Math.round(now() - roundStart)
    if (error) { failure = error; break }
    let routed = false
    if (!calls.length || !allowTools) {
      // Grounding guarantee: an answer to a routed intent needs that intent's tool result first.
      const missing = routerUsed ? [] : routed_calls().filter((call) => !traces.some((trace) => trace.name === call.name))
      if (!missing.length || !allowTools) { answerText = content; break }
      routerUsed = true
      routed = true
      calls = missing
    }

    // Tools requested (by the model or the router): discard interim text and run them in order (deduplicated, budgeted).
    if (content) emit({ type: 'reset' })
    const accepted = calls.slice(0, MAX_TOOL_CALLS_PER_TURN - traces.length)
    messages.push({ role: 'assistant', content: '', toolCalls: accepted })
    for (const call of accepted) {
      const key = `${call.name}:${JSON.stringify(call.arguments)}`
      emit({ type: 'tool_start', name: call.name, label: toolLabel(call.name), arguments: call.arguments })
      let execution = cache.get(key)
      if (!execution) {
        execution = await executeAgentTool(call, options.context, refOffset)
        refOffset += execution.citations.length
        cache.set(key, execution)
        executions.push(execution)
      }
      const trace: AgentToolTrace = { name: call.name, label: toolLabel(call.name), arguments: call.arguments, ok: execution.ok, summary: execution.summary, errorCode: execution.errorCode, elapsedMs: execution.elapsedMs, routed }
      traces.push(trace)
      emit({ type: 'tool_end', trace })
      messages.push({ role: 'tool', toolName: call.name, content: execution.content })
    }
  }

  const citations = executions.flatMap((item) => item.citations)
  const evidence = executions.flatMap((item) => item.evidence)
  const notice = flags.includes('medical') ? MEDICAL_NOTICE : null
  if (failure || !answerText.trim()) {
    const text = failure === 'CANCELLED' && !executions.length ? '已停止回答。' : ruleFallbackText(executions, question)
    if (answerText.trim() || failure) emit({ type: 'reset' })
    return finish({ text, source: 'rules_fallback', notice, validation: { ok: false, issues: [failure ?? 'EMPTY_ANSWER'] }, fallbackReason: failure ?? 'EMPTY_ANSWER', citations, evidence, tools: traces })
  }
  const validation = validateAnswer(answerText, {
    toolText: executions.map((item) => item.content).join(' '), question, citationRefs: citations.map((item) => item.ref), flags,
    // "Called", not "succeeded": after a refused or empty record read, any score in the answer is ungrounded.
    usedRecordTools: executions.some((item) => item.call.name === 'read_last_training' || item.call.name === 'compare_recent_training'),
    usedRecommendation: executions.some((item) => item.call.name === 'recommend_training'),
  })
  if (!validation.ok) {
    emit({ type: 'reset' })
    return finish({ text: ruleFallbackText(executions, question), source: 'rules_fallback', notice, validation: { ok: false, issues: validation.issues }, fallbackReason: 'VALIDATION_FAILED', citations, evidence, tools: traces })
  }
  return finish({ text: validation.text, source: 'llm', notice, validation: { ok: true, issues: validation.issues }, fallbackReason: null, citations, evidence, tools: traces })
}

function addMetrics(target: ReturnType<typeof emptyMetrics>, metrics: AgentMetrics) {
  target.promptTokens += metrics.promptTokens ?? 0
  target.outputTokens += metrics.outputTokens ?? 0
  if (metrics.outputTokens && metrics.outputMs) target.tokensPerSecond = Math.round((metrics.outputTokens / (metrics.outputMs / 1000)) * 10) / 10
}
