import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AgentAnswer, AgentToolTrace } from '../../features/coachLlm/agent'
import type { AgentToolContext } from '../../features/coachLlm/tools'
import { agentFeatureEnabled, checkAgentHealth, createBridgeTransport, type AgentHealth } from '../../features/coachLlm/transport'

export interface AgentChatTurn {
  id: number
  /** Shared ordering key with the page's fixed-question answers. */
  at: number
  question: string
  running: boolean
  thinking: boolean
  steps: Array<AgentToolTrace & { pending?: boolean }>
  text: string
  answer: AgentAnswer | null
}

export interface ChatTimelineItem { at: number; key: string; node: ReactNode }

export interface CoachAgentChatState {
  health: AgentHealth | null
  turns: AgentChatTurn[]
  ready: boolean
  busy: boolean
  ask: (question: string) => Promise<void>
  cancel: () => void
  refresh: () => void
  /** First health probe; called when the chat is first shown, so the page makes no request before that. */
  ensureHealth: () => void
}

/**
 * Chat state for the V1.2 agent, owned by the page so the conversation survives switching coach panels.
 * `getContext` is read at ask time (latest consent / recommendation); `nextOrder` is shared with the fixed questions.
 */
export function useCoachAgentChat(getContext: () => AgentToolContext, nextOrder: () => number): CoachAgentChatState {
  const [health, setHealth] = useState<AgentHealth | null>(null)
  const [turns, setTurns] = useState<AgentChatTurn[]>([])
  const controller = useRef<AbortController | null>(null)
  const transport = useMemo(() => createBridgeTransport(), [])
  const nextId = useRef(1)
  const latest = useRef({ getContext, nextOrder })
  latest.current = { getContext, nextOrder }
  const probed = useRef(false)
  const mounted = useRef(true)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  const probe = () => {
    if (!agentFeatureEnabled()) { setHealth({ status: 'disabled', model: null }); return }
    setHealth(null)
    void checkAgentHealth().then((value) => { if (mounted.current) setHealth(value) })
  }
  // While the bridge is preloading the model, re-check every 5 s so the status turns to 已就绪 by itself.
  useEffect(() => {
    if (health?.warm !== 'loading') return undefined
    const timer = window.setTimeout(() => { void checkAgentHealth().then((value) => { if (mounted.current) setHealth(value) }) }, 5000)
    return () => window.clearTimeout(timer)
  }, [health])

  const busy = turns.some((turn) => turn.running)
  const ready = health?.status === 'ready'
  const update = (id: number, change: (turn: AgentChatTurn) => AgentChatTurn) => setTurns((items) => items.map((turn) => (turn.id === id ? change(turn) : turn)))

  const ask = async (question: string) => {
    const text = question.trim()
    if (!text || busy || !ready || controller.current) return
    const id = nextId.current++
    const history = turns.filter((turn) => turn.answer).slice(-3).map((turn) => ({ question: turn.question, answer: turn.answer!.text }))
    setTurns((items) => [...items, { id, at: latest.current.nextOrder(), question: text, running: true, thinking: true, steps: [], text: '', answer: null }])
    const own = new AbortController()
    controller.current = own
    try {
      // Code-split: the agent, knowledge base and tools load on the first question, not with the page.
      const { runAgentTurn } = await import('../../features/coachLlm/agent')
      await runAgentTurn(text, {
        transport, context: latest.current.getContext(), history, signal: own.signal,
        onEvent: (event) => {
          if (event.type === 'thinking') update(id, (turn) => ({ ...turn, thinking: true }))
          else if (event.type === 'tool_start') update(id, (turn) => ({ ...turn, thinking: false, steps: [...turn.steps, { name: event.name, label: event.label, arguments: event.arguments, ok: true, summary: '', errorCode: null, elapsedMs: 0, routed: false, pending: true }] }))
          else if (event.type === 'tool_end') update(id, (turn) => ({ ...turn, steps: turn.steps.map((step, index) => (index === turn.steps.length - 1 ? { ...event.trace } : step)) }))
          else if (event.type === 'delta') update(id, (turn) => ({ ...turn, thinking: false, text: turn.text + event.text }))
          else if (event.type === 'reset') update(id, (turn) => ({ ...turn, text: '' }))
          else if (event.type === 'final') update(id, (turn) => ({ ...turn, running: false, thinking: false, text: event.answer.text, answer: event.answer }))
        },
      })
    } finally {
      if (controller.current === own) controller.current = null
      update(id, (turn) => (turn.running ? { ...turn, running: false, thinking: false } : turn))
    }
  }

  return {
    health, turns, ready, busy, ask,
    cancel: () => controller.current?.abort(),
    refresh: probe,
    ensureHealth: () => { if (!probed.current) { probed.current = true; probe() } },
  }
}

