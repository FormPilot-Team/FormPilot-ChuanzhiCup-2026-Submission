import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowRight, MessageCircle, Send, X } from 'lucide-react'
import { INTENTS, answerIntent, greeting, reply, suggestedIntents, type CoachIntentId } from '../../features/aiCoach/intents'
import type { CoachAnswer, CoachPageContext } from '../../features/aiCoach/types'
import { cn } from '../../lib/cn'
import { COACH_AVATAR_ASSET, COACH_NAME } from '../coach/coachIdentity'

interface Message {
  id: number
  role: 'coach' | 'user'
  text: string
  answer?: CoachAnswer
}

const PAGE_LABEL: Readonly<Record<CoachPageContext['page'], string>> = {
  home: '首页',
  history: '我的训练',
  training: '训练中',
  report: '训练报告',
  workshop: '动作工坊',
}

function Avatar({ className }: { className?: string }) {
  return <img src={COACH_AVATAR_ASSET} alt="" aria-hidden="true" draggable={false} className={cn('shrink-0 rounded-full bg-sky-50 object-cover mix-blend-multiply', className)} />
}

function CoachBubble({ answer, text }: { answer?: CoachAnswer; text: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Avatar className="mt-0.5 size-7" />
      <div className="min-w-0 rounded-2xl rounded-tl-md bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-800 ring-1 ring-slate-100">
        <p className="text-pretty">{text}</p>
        {answer?.facts?.length ? (
          <dl className="mt-1.5 grid gap-1">
            {answer.facts.map((fact) => (
              <div key={`${fact.label}-${fact.value}`} className="flex min-w-0 gap-2 text-[13px] leading-5">
                <dt className="shrink-0 font-semibold text-slate-600">{fact.label}</dt>
                <dd className="min-w-0 text-pretty text-slate-800">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {answer?.link ? (
          <a href={answer.link.href} className="mt-1.5 inline-flex items-center gap-1 rounded-lg text-sm font-bold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            {answer.link.label}<ArrowRight size={14} aria-hidden="true" />
          </a>
        ) : null}
        {answer?.basis ? <p className="mt-1 text-xs text-slate-500">{answer.basis}</p> : null}
      </div>
    </div>
  )
}

/**
 * AI Coach Lite: FormPilot's coach (the same character as on Home) answers questions about the current page from real
 * training data. `floating` sits in the bottom-right corner; `inline` is a button placed in a training page header,
 * whose panel opens below the header so it never covers the training controls. Non-modal: the page stays usable.
 */
export function AICoach({ context, variant = 'floating' }: { context: CoachPageContext; variant?: 'floating' | 'inline' }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstChipRef = useRef<HTMLButtonElement>(null)
  const logRef = useRef<HTMLOListElement>(null)
  const idRef = useRef(0)
  const contextRef = useRef(context)
  contextRef.current = context
  const panelId = useId()
  const titleId = `${panelId}-title`
  const inputId = `${panelId}-input`

  useEffect(() => {
    if (open) firstChipRef.current?.focus()
  }, [open])

  useEffect(() => {
    const last = logRef.current?.lastElementChild
    if (last && typeof last.scrollIntoView === 'function') last.scrollIntoView({ block: 'nearest' })
  }, [messages])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    close()
  }

  const push = (question: string, answer: CoachAnswer) => {
    setMessages((previous) => [
      ...previous,
      { id: (idRef.current += 1), role: 'user', text: question },
      { id: (idRef.current += 1), role: 'coach', text: answer.text, answer },
    ])
  }

  const askIntent = (id: CoachIntentId) => push(INTENTS[id].question, answerIntent(id, contextRef.current))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const question = draft.trim()
    if (!question) return
    push(question, reply(question, contextRef.current).answer)
    setDraft('')
  }

  const suggestions = suggestedIntents(context)
  const floating = variant === 'floating'
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? '收起 AI 教练' : '打开 AI 教练'}
        className={cn(
          'inline-flex items-center gap-2 rounded-full bg-white font-semibold text-slate-800 ring-1 ring-slate-200 hover:ring-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          floating ? 'fixed bottom-4 right-4 z-20 py-1.5 pl-1.5 pr-1.5 shadow-[0_12px_30px_-12px_rgb(30_64_175/0.5)] sm:bottom-6 sm:right-6 sm:pr-4' : 'py-1 pl-1 pr-3.5 text-sm shadow-sm',
        )}
        data-testid="ai-coach-trigger"
      >
        <Avatar className={floating ? 'size-10' : 'size-8'} />
        <span className={cn(floating && 'hidden sm:inline')}>问 AI 教练</span>
        {floating ? null : <MessageCircle size={15} className="text-blue-600" aria-hidden="true" />}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={onKeyDown}
          className={cn(
            'fixed right-4 z-[25] flex w-[min(calc(100vw-2rem),380px)] flex-col overflow-hidden rounded-3xl bg-white shadow-[0_24px_60px_-20px_rgb(15_23_42/0.45)] ring-1 ring-slate-200 sm:right-6',
            floating ? 'bottom-20 max-h-[min(72dvh,600px)] sm:bottom-24' : 'top-20 max-h-[min(78dvh,620px)]',
          )}
          data-testid="ai-coach-panel"
          data-page={context.page}
        >
          <div className="fp-hero flex items-center gap-3 px-4 py-3">
            <Avatar className="size-10 ring-2 ring-white" />
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate font-bold text-slate-950">{COACH_NAME}</h2>
              <p className="truncate text-xs text-slate-600">{PAGE_LABEL[context.page]} · 根据你的训练数据回答</p>
            </div>
            <button type="button" onClick={close} aria-label="关闭 AI 教练" className="grid size-9 place-items-center rounded-xl text-slate-500 hover:bg-white/80 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><X size={18} aria-hidden="true" /></button>
          </div>
          <ol ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label="与教练的对话" data-testid="ai-coach-log">
            <li><CoachBubble text={greeting(context)} /></li>
            {messages.map((message) => (
              <li key={message.id} data-role={message.role}>
                {message.role === 'user'
                  ? <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-md bg-blue-600 px-3 py-2 text-sm leading-6 text-white">{message.text}</p>
                  : <CoachBubble text={message.text} answer={message.answer} />}
              </li>
            ))}
          </ol>
          <div className="border-t border-slate-100 px-4 pb-3 pt-2.5">
            <p className="text-xs font-semibold text-slate-500" id={`${panelId}-suggestions`}>你可以问：</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby={`${panelId}-suggestions`} data-testid="ai-coach-suggestions">
              {suggestions.map((id, index) => (
                <button key={id} ref={index === 0 ? firstChipRef : undefined} type="button" onClick={() => askIntent(id)} className="rounded-full bg-blue-50 px-3 py-1.5 text-left text-[13px] font-semibold text-blue-800 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  {INTENTS[id].question}
                </button>
              ))}
            </div>
            <form onSubmit={submit} className="mt-2.5 flex items-center gap-2">
              <label htmlFor={inputId} className="sr-only">向教练提问</label>
              <input
                id={inputId}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={60}
                placeholder="也可以直接输入问题"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
              <button type="submit" disabled={!draft.trim()} aria-label="发送问题" className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"><Send size={16} aria-hidden="true" /></button>
            </form>
            <p className="mt-1.5 text-[11px] leading-4 text-slate-500">只根据你的训练数据回答，不是通用聊天，也不做医学判断。</p>
          </div>
        </div>
      ) : null}
    </>
  )
}
