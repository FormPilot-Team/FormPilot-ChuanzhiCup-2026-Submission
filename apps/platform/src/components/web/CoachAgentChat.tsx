import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { AgentAnswer } from '../../features/coachLlm/agent'
import type { AgentChatTurn, ChatTimelineItem, CoachAgentChatState } from './useCoachAgentChat'


const EXAMPLES = ['我今天应该练什么？', '我上一次练得怎么样？主要问题在哪里？', '我最近有没有进步？', '八段锦第二式有哪些常见错误？']

const SOURCE_LABEL: Record<AgentAnswer['source'], string> = {
  llm: '本机大模型生成',
  rules_fallback: '规则回答（未采用模型文本）',
  safety_rule: '安全规则回答（不经过大模型）',
}

const FALLBACK_TEXT: Record<string, string> = {
  VALIDATION_FAILED: '模型回答未通过安全与证据校验',
  RATE_LIMITED: '本地模型请求过于频繁',
  BUSY: '本地模型正在回答上一个问题',
  TIMEOUT: '本地模型响应超时',
  MODEL_UNAVAILABLE: '本地模型不可用',
  EMPTY_ANSWER: '模型没有给出回答',
  CANCELLED: '已取消',
}

function modelName(model: string | null): string {
  if (!model) return '本地模型'
  if (model.startsWith('qwen3:4b')) return 'Qwen3-4B-Instruct（本机）'
  return `${model}（本机）`
}

/** Model text with [K1] markers turned into citation chips. Model text is never evidence by itself. */
function AnswerText({ text, onCite }: { text: string; onCite: (ref: string) => void }) {
  const parts = text.split(/(\[K\d+\])/gu)
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((part, index) => {
        const match = /^\[(K\d+)\]$/u.exec(part)
        return match
          ? <button key={index} type="button" className="agent-cite" onClick={() => onCite(match[1])} aria-label={`查看依据 ${match[1]}`}>{match[1]}</button>
          : <span key={index}>{part}</span>
      })}
    </span>
  )
}

function StepList({ turn }: { turn: AgentChatTurn }) {
  if (!turn.steps.length && !turn.thinking) return null
  return (
    <ol className="agent-steps" data-testid="coach-agent-steps" aria-label="AI 教练处理步骤">
      {turn.steps.map((step, index) => (
        <li key={index} className={`agent-step${step.pending ? ' pending' : step.ok ? ' ok' : ' fail'}`} data-tool={step.name} data-routed={step.routed ? 'true' : 'false'}>
          <span className="agent-step-dot" aria-hidden="true" />
          <span>{step.label}{step.routed ? <small> · 意图路由补充</small> : null}</span>
          <small>{step.pending ? '进行中…' : `${step.summary} · ${step.elapsedMs} ms`}</small>
        </li>
      ))}
      {turn.thinking ? <li className="agent-step pending"><span className="agent-step-dot" aria-hidden="true" /><span>{turn.steps.length ? '根据工具结果组织回答' : '理解问题、选择工具'}</span><small>本机模型推理中…</small></li> : null}
    </ol>
  )
}

function Details({ turnId, answer, open, onToggle }: { turnId: number; answer: AgentAnswer; open: boolean; onToggle: (open: boolean) => void }) {
  const count = answer.citations.length + answer.evidence.length
  return (
    <details className="agent-details" open={open} onToggle={(event) => onToggle((event.currentTarget as HTMLDetailsElement).open)} data-testid="coach-agent-details">
      <summary>依据与来源{count ? `（${count}）` : ''} · 处理过程</summary>
      {answer.citations.length ? (
        <div data-testid="coach-agent-citations">
          <strong>知识库条目</strong>
          <ul>
            {answer.citations.map((c) => (
              <li key={c.ref} id={`agent-cite-${turnId}-${c.ref}`}>
                <b>[{c.ref}] {c.title}</b>
                <span className="tiny">来源：{c.source} · {c.verification}{c.url ? <> · <a href={c.url} target="_blank" rel="noreferrer noopener">原文链接</a></> : null}</span>
                <span className="agent-cite-text">{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {answer.evidence.length ? (
        <div data-testid="coach-agent-evidence">
          <strong>数据证据</strong>
          <ul>{answer.evidence.map((e, index) => <li key={index}><b>{e.label}</b><span className="tiny">{e.detail}</span></li>)}</ul>
        </div>
      ) : null}
      {answer.tools.length ? (
        <div>
          <strong>工具调用</strong>
          <ul>{answer.tools.map((t, index) => <li key={index}><b>{t.name}</b> <code>{JSON.stringify(t.arguments)}</code><span className="tiny">{t.ok ? '成功' : `失败：${t.errorCode}`} · {t.summary} · {t.elapsedMs} ms{t.routed ? ' · 由意图路由补充调用' : ''}</span></li>)}</ul>
        </div>
      ) : null}
      <p className="tiny">
        {answer.source === 'llm' ? `模型：${modelName(answer.metrics.model)} · 首字 ${answer.metrics.ttftMs ?? '—'} ms · 总耗时 ${answer.metrics.totalMs} ms · ${answer.metrics.rounds} 轮 · 输出 ${answer.metrics.outputTokens} tokens${answer.metrics.tokensPerSecond ? ` · ${answer.metrics.tokensPerSecond} tokens/s` : ''}` : `总耗时 ${answer.metrics.totalMs} ms`}
        {answer.validation.issues.length ? ` · 校验：${answer.validation.issues.join('、')}` : ' · 校验通过'}
      </p>
      <p className="tiny">模型文本不作为证据；分数、比较结论和推荐只来自上面的工具结果。模型在本机运行，不上传问题或训练记录。</p>
    </details>
  )
}

/**
 * AI Coach free-text chat (Web V1.2). Real local LLM only: the input is enabled only when the local agent bridge
 * reports the pinned model ready. Otherwise the panel says so and the fixed five questions remain the way to ask.
 */
export function CoachAgentChat({ chat, intro, timeline = [], prompts, initialDraft = '', recordsConsent, onRecordsConsent }: {
  chat: CoachAgentChatState
  /** Prefilled question (from a report link); never sent automatically. */
  initialDraft?: string
  /** Page-owned consent for the chat's record tools. */
  recordsConsent: boolean
  onRecordsConsent: (value: boolean) => void
  /** Shown first in the stream (page guidance). */
  intro?: ReactNode
  /** Fixed-question answers rendered by the page; merged with agent turns by `at`. */
  timeline?: ChatTimelineItem[]
  /** The page's fixed-question buttons, shown above the free-text input. */
  prompts?: ReactNode
}) {
  const { health, turns, ready, busy, ask, refresh, ensureHealth } = chat
  useEffect(() => { ensureHealth() }, [ensureHealth])
  const [draft, setDraft] = useState(initialDraft)
  const [openDetails, setOpenDetails] = useState<Record<number, boolean>>({})
  const streamEnd = useRef<HTMLDivElement>(null)
  const lastText = turns.length ? turns[turns.length - 1].text.length : 0
  useEffect(() => { streamEnd.current?.scrollIntoView?.({ block: 'nearest' }) }, [turns.length, timeline.length, lastText])

  const submit = (event: FormEvent) => { event.preventDefault(); if (!draft.trim()) return; const text = draft; setDraft(''); void ask(text) }
  const cite = (id: number, ref: string) => {
    setOpenDetails((value) => ({ ...value, [id]: true }))
    window.setTimeout(() => document.getElementById(`agent-cite-${id}-${ref}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 50)
  }

  const statusText = health === null ? '正在连接本地 AI 模型…'
    : ready ? `${modelName(health.model)} ${health.warm === 'loading' ? '正在载入显存（首次约 40 秒），可以先提问' : health.warm === 'warm' ? '已就绪' : '可用（若未载入，首个回答需额外等待模型加载）'} · 本机推理，不联网`
      : health.status === 'disabled' ? '本构建未启用本地大模型 · 请使用固定五问'
      : health.status === 'model_unavailable' ? '本地模型服务已启动，但固定的模型文件未通过校验'
        : '本地 AI 模型未连接 · 自由提问暂不可用，固定五问仍可使用'

  return (
    <>
      <div className="agent-status" data-testid="coach-agent-status" data-status={health?.status ?? 'checking'}>
        <span className={`agent-status-dot ${ready ? 'ok' : health === null ? 'wait' : 'off'}`} aria-hidden="true" />
        <span>{statusText}</span>
        {!ready && health !== null && health.status !== 'disabled' ? <button type="button" className="prompt" onClick={refresh}>重新检测</button> : null}
      </div>
      <div className="chat-stream" aria-live="polite">
        {intro}
        {[...timeline.map((item) => ({ at: item.at, key: item.key, node: item.node })), ...turns.map((turn) => ({ at: turn.at, key: `agent-${turn.id}`, node: (
          <div style={{ display: 'grid', gap: 12 }} data-testid="coach-agent-turn">
            <div className="bubble user">{turn.question}</div>
            <div className="bubble coach" data-testid="coach-agent-answer" data-source={turn.answer?.source ?? 'running'}>
              <StepList turn={turn} />
              {turn.answer?.notice ? <div className="notice" style={{ margin: '0 0 8px' }}>{turn.answer.notice}</div> : null}
              {turn.text ? <AnswerText text={turn.text} onCite={(ref) => cite(turn.id, ref)} /> : turn.running ? null : <span>（没有回答）</span>}
              {turn.running ? <span className="agent-caret" aria-hidden="true" /> : null}
              {turn.answer ? (
                <>
                  <span className="basis" data-testid="coach-agent-source">
                    {SOURCE_LABEL[turn.answer.source]}{turn.answer.source === 'llm' ? ` · ${modelName(turn.answer.metrics.model)} · 依据见下方` : ''}
                    {turn.answer.fallbackReason ? ` · 原因：${FALLBACK_TEXT[turn.answer.fallbackReason] ?? turn.answer.fallbackReason}` : ''}
                  </span>
                  <Details turnId={turn.id} answer={turn.answer} open={!!openDetails[turn.id]} onToggle={(open) => setOpenDetails((value) => ({ ...value, [turn.id]: open }))} />
                </>
              ) : null}
            </div>
          </div>
        ) }))].sort((x, y) => x.at - y.at).map((item) => <div key={item.key} style={{ display: 'grid' }}>{item.node}</div>)}
        <div ref={streamEnd} />
      </div>
      {prompts}
      {ready ? <div className="chat-prompts agent-examples" aria-label="自由提问示例">{EXAMPLES.map((example) => <button key={example} type="button" className="prompt" disabled={busy} onClick={() => void ask(example)} data-testid="coach-agent-example">{example}</button>)}</div> : null}
      {ready ? (
        <label className="check-chip agent-consent" data-testid="coach-agent-consent">
          <input type="checkbox" checked={recordsConsent} onChange={(event) => onRecordsConsent(event.target.checked)} />
          允许 AI 教练读取此浏览器中的热身与功法训练记录（只读、不上传、不修改；模型只看到工具整理后的分数与问题）
        </label>
      ) : null}
      <form className="chat-input" onSubmit={submit}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={300} disabled={!ready || busy}
          placeholder={ready ? '自由提问：训练表现、进步、推荐、功法要领…' : health?.status === 'disabled' ? '本构建未启用自由提问' : '自由提问需要本地 AI 模型 · 请先启动本地模型服务'} aria-label="自由提问" data-testid="coach-agent-input" />
        {busy ? <button className="btn btn-secondary" type="button" onClick={chat.cancel} data-testid="coach-agent-cancel">停止</button>
          : <button className="btn btn-dark" type="submit" disabled={!ready || !draft.trim()} data-testid="coach-agent-send">发送</button>}
      </form>
    </>
  )
}
