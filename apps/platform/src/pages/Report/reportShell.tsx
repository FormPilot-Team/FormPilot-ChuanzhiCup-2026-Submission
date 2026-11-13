import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, CircleDashed, type LucideIcon } from 'lucide-react'
import { AppHeader } from '../../components/layout/AppHeader'
import { cn } from '../../lib/cn'

/**
 * Report shell shared by every mode's report (热身训练, 跟练课程, 自定义动作): a light summary that answers "did I
 * finish, how did I do, what was the biggest problem, what next" on the first screen, then compact sections.
 */

export function SectionHeading({ id, icon: Icon, title, description }: {
  id: string
  icon: LucideIcon
  title: string
  description?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700" aria-hidden="true"><Icon size={18} /></span>
      <div className="min-w-0">
        <h2 id={id} className="text-balance text-lg font-bold text-slate-950 sm:text-xl">{title}</h2>
        {description ? <p className="mt-0.5 max-w-3xl text-pretty text-sm leading-6 text-slate-500">{description}</p> : null}
      </div>
    </div>
  )
}

export function ReportLayout({ children, dataRoutine }: { children: ReactNode; dataRoutine?: string }) {
  return (
    <div className="fp-page min-h-dvh min-w-0 overflow-x-clip text-slate-900" data-routine={dataRoutine}>
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-[1240px] px-4 pb-24 pt-4 sm:px-6 lg:px-8">
        <button type="button" onClick={() => window.location.assign('/')} className="mb-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeft size={17} aria-hidden="true" />返回首页</button>
        <div className="space-y-4 sm:space-y-5">{children}</div>
      </main>
    </div>
  )
}

export type ScoreTone = 'good' | 'fair' | 'low' | 'none'

const RING_STROKE: Readonly<Record<ScoreTone, string>> = {
  good: 'stroke-emerald-500',
  fair: 'stroke-blue-500',
  low: 'stroke-coral-500',
  none: 'stroke-slate-300',
}

/** Progress ring for the main result; `value` is 0–100. Purely visual: the number is written next to it. */
function ScoreRing({ value, tone }: { value: number | null; tone: ScoreTone }) {
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const share = value === null ? 0 : Math.min(100, Math.max(0, value)) / 100
  return (
    <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r={radius} fill="none" className="stroke-slate-200/80" strokeWidth="9" />
      {value === null ? null : <circle cx="50" cy="50" r={radius} fill="none" className={RING_STROKE[tone]} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${circumference * share} ${circumference}`} />}
    </svg>
  )
}

export interface ReportScore {
  /** The main number, or null when the report honestly has none. */
  value: number | null
  /** e.g. "%"; nothing for plain scores. */
  suffix?: string
  /** What the number is, e.g. 综合评分 / 跟练相似度 · 基本一致. */
  label: string
  /** Shown instead of a number when `value` is null. */
  emptyText: string
  tone: ScoreTone
  testId: string
}

export interface ReportMetric {
  icon: LucideIcon
  label: string
  value: string
  /** 0–1: draws a mini bar under the value. */
  progress?: number | null
}

export interface ReportTakeaway {
  label: string
  text: string
  tone: 'attention' | 'focus' | 'good'
}


export interface ReportSummaryProps {
  kind: 'smart' | 'routine' | 'custom'
  /** What was trained, e.g. 热身训练 · 完整训练. */
  modeLabel: string
  complete: boolean
  statusLabel: string
  title: string
  score: ReportScore
  trend?: { text: string; tone: 'up' | 'down' | 'flat' } | null
  summary?: string | null
  comparison?: string | null
  metrics: ReadonlyArray<ReportMetric>
  takeaways?: ReadonlyArray<ReportTakeaway>
  /** A richer 主要问题 card built from the report's own fields (routine: the weakest chapter). */
  problem?: ReactNode
  /** The actions of 下次怎么练: the primary one is the page's only lime button. */
  nextActions?: ReadonlyArray<ReportNextAction>
}

export interface ReportNextAction {
  label: string
  href?: string
  onClick?: () => void
  primary?: boolean
  testId?: string
}

function NextActionButton({ action }: { action: ReportNextAction }) {
  const className = action.primary ? 'fp-cta w-full' : 'secondary-button inline-flex w-full items-center justify-center gap-1.5'
  return action.href
    ? <a href={action.href} className={className} data-testid={action.testId}>{action.label}{action.primary ? <ArrowRight size={15} aria-hidden="true" /> : null}</a>
    : <button type="button" onClick={action.onClick} className={className} data-testid={action.testId}>{action.label}{action.primary ? <ArrowRight size={15} aria-hidden="true" /> : null}</button>
}

/**
 * First screen of every report (Web V1.1, C4): three questions side by side — 这次怎么样 (the main result, its band,
 * the comparison with last time), 主要问题 (only the one biggest problem) and 下次怎么练 (the first focus item and how
 * to start it) — with the compact facts above. Every value is a field the report already had; nothing is added.
 */
export function ReportSummary({ kind, modeLabel, complete, statusLabel, title, score, trend, summary, comparison, metrics, takeaways = [], problem, nextActions = [] }: ReportSummaryProps) {
  const StatusIcon = complete ? Check : CircleDashed
  const problemItem = takeaways.find((item) => item.tone !== 'focus')
  const nextItem = takeaways.find((item) => item.tone === 'focus')
  return (
    <section className="min-w-0" aria-labelledby="report-title" data-testid="report-summary" data-report-kind={kind}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold', complete ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>
          <StatusIcon size={15} aria-hidden="true" />{statusLabel}
        </span>
        <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-100">{modeLabel}</span>
      </div>
      <h1 id="report-title" className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2" data-testid="report-facts">
        {metrics.map(({ icon: Icon, label, value, progress }) => (
          <div key={label} className="flex min-w-0 items-center gap-2 text-sm">
            <dt className="flex items-center gap-1.5 text-slate-500"><Icon size={14} className="shrink-0 text-blue-500" aria-hidden="true" />{label}</dt>
            <dd className="font-bold tabular-nums text-slate-900">{value}</dd>
            {typeof progress === 'number' ? (
              <span className="block h-1.5 w-14 overflow-hidden rounded-full bg-slate-200/70" aria-hidden="true">
                <span className="fp-energy-gradient block h-full rounded-full" style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
              </span>
            ) : null}
          </div>
        ))}
      </dl>

      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.1fr)_minmax(0,.9fr)]">
        <article className="fp-card flex min-w-0 flex-col p-5 sm:p-6" aria-label="这次练得怎么样" data-testid="report-q-result">
          <p className="text-xs font-bold tracking-[0.08em] text-slate-500">这次练得怎么样</p>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3" data-testid={score.testId}>
            <span className="relative grid size-24 shrink-0 place-items-center sm:size-28">
              <span className="absolute inset-0"><ScoreRing value={score.value} tone={score.tone} /></span>
              {score.value === null
                ? <span className="relative px-2 text-center text-xs font-semibold leading-4 text-slate-500">暂无</span>
                : <span className="relative text-3xl font-bold tabular-nums text-slate-950 sm:text-4xl">{score.value}{score.suffix ? <span className="text-lg">{score.suffix}</span> : null}</span>}
            </span>
            <span className="min-w-0 flex-1">
              {score.value === null
                ? <span className="block text-balance text-lg font-bold text-slate-900">{score.emptyText}</span>
                : <span className="block text-base font-bold text-slate-800">{score.label}</span>}
              {trend ? <span className={cn('mt-1 block text-sm font-semibold', trend.tone === 'down' ? 'text-amber-700' : trend.tone === 'up' ? 'text-emerald-700' : 'text-slate-600')}>{trend.text}</span> : null}
            </span>
          </div>
          {summary ? <p className="mt-4 text-pretty text-[15px] font-medium leading-7 text-slate-800">{summary}</p> : null}
          {comparison ? <p className="mt-2 text-pretty text-sm leading-6 text-slate-500">{comparison}</p> : null}
        </article>
        <ul className="contents" aria-label="本次要点" data-testid="report-takeaways">
          <li className={cn('fp-card flex min-w-0 flex-col p-5 sm:p-6', problemItem?.tone === 'attention' || problem ? 'ring-1 ring-coral-500/30' : undefined)} data-testid="report-q-problem" data-problem-tone={problemItem?.tone ?? 'none'}>
            <p className={cn('text-xs font-bold tracking-[0.08em]', problemItem?.tone === 'good' && !problem ? 'text-emerald-700' : 'text-coral-600')}>主要问题 · 只看这一处</p>
            {problem ?? (problemItem
              ? <p className="mt-3 text-pretty text-lg font-bold leading-7 text-slate-900">{problemItem.text}</p>
              : <p className="mt-3 text-pretty text-sm leading-6 text-slate-500">本次识别数据不足，暂时无法判断主要问题。</p>)}
          </li>
          <li className="fp-card flex min-w-0 flex-col bg-gradient-to-br from-[#fff7d6]/80 to-white/70 p-5 sm:p-6" data-testid="report-q-next">
            <p className="text-xs font-bold tracking-[0.08em] text-slate-500">下次怎么练</p>
            <p className="mt-3 text-pretty text-lg font-bold leading-7 text-slate-900">{nextItem ? nextItem.text : '按原计划再练一次'}</p>
            <p className="mt-1 text-pretty text-xs text-slate-500">下一次会生成新的独立报告，并与本次同范围比较。</p>
            {nextActions.length ? <div className="mt-auto grid gap-2 pt-4">{nextActions.map((action) => <NextActionButton key={action.label} action={action} />)}</div> : null}
          </li>
        </ul>
      </div>
    </section>
  )
}

/** A folded section of a report: the title and its key values stay visible, the details open on demand. */
export function ReportFold({ id, title, summary, testId, children, defaultOpen = false }: { id: string; title: string; summary: ReactNode; testId?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group report-panel min-w-0 overflow-hidden" open={defaultOpen} data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 marker:content-none sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="text-balance font-bold text-slate-950">{title}</h2>
          <div className="mt-0.5 text-pretty text-sm text-slate-500">{summary}</div>
        </div>
        <ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="border-t border-slate-100 p-3 sm:p-4">{children}</div>
    </details>
  )
}

/** "下次训练重点": the most actionable part of a report, visually the strongest section after the summary. */
export function FocusPanel({ id, title = '下次训练重点', description, testId, children, footer }: {
  id: string
  title?: string
  description?: string
  testId: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-blue-200/80 bg-gradient-to-br from-blue-50 via-white to-cyan-50/70 p-5 shadow-[0_14px_34px_-24px_rgb(37_99_235/0.6)] sm:p-6" aria-labelledby={id} data-testid={testId}>
      <span className="fp-energy-gradient absolute inset-y-0 left-0 w-1.5" aria-hidden="true" />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={id} className="text-balance text-lg font-bold text-slate-950 sm:text-xl">{title}</h2>
          {description ? <p className="mt-0.5 text-pretty text-sm leading-6 text-slate-600">{description}</p> : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
      {footer ? <div className="mt-4 flex flex-wrap items-center gap-2">{footer}</div> : null}
    </section>
  )
}

export interface FocusCardProps {
  rank: number
  /** Which exercise or form. */
  eyebrow: string
  title: string
  /** What to do. */
  detail?: string | null
  /** The measured value behind it. */
  value?: string | null
  /** Why it comes first. */
  reason?: string | null
  target?: string | null
  action?: { label: string; href: string } | null
  testId?: string
}

export function FocusCard({ rank, eyebrow, title, detail, value, reason, target, action, testId }: FocusCardProps) {
  return (
    <li className="flex min-w-0 flex-col rounded-2xl bg-white/90 p-4 ring-1 ring-blue-100" data-testid={testId}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-sm font-bold tabular-nums text-white">{rank}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-blue-700" title={eyebrow}>{eyebrow}</p>
          <h3 className="mt-0.5 text-pretty font-bold leading-6 text-slate-950">{title}</h3>
          {value ? <span className="mt-1.5 inline-block rounded-lg bg-slate-50 px-2 py-1 text-xs font-bold tabular-nums text-slate-800 ring-1 ring-slate-200 sm:hidden">{value}</span> : null}
        </div>
        {value ? <span className="hidden shrink-0 rounded-lg bg-slate-50 px-2 py-1 text-xs font-bold tabular-nums text-slate-800 ring-1 ring-slate-200 sm:inline-block">{value}</span> : null}
      </div>
      {detail ? <p className="mt-3 text-pretty text-sm leading-6 text-slate-700">{detail}</p> : null}
      {reason ? <p className="mt-2 text-pretty text-xs leading-5 text-slate-500"><span className="font-semibold text-slate-600">为什么优先：</span>{reason}</p> : null}
      {target ? <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-pretty text-sm font-bold leading-6 text-blue-800">{target}</p> : null}
      {action ? (
        <a href={action.href} className="mt-3 inline-flex items-center gap-1.5 self-start rounded-lg px-1 py-1 text-sm font-bold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          {action.label}<ArrowRight size={15} aria-hidden="true" />
        </a>
      ) : null}
    </li>
  )
}

/** Compact horizontal bar for a 0–100 value. */
export function MiniBar({ value, tone = 'fair', label }: { value: number | null; tone?: ScoreTone; label?: string }) {
  const fill = tone === 'good' ? 'bg-emerald-500' : tone === 'low' ? 'bg-coral-500' : tone === 'none' ? 'bg-slate-300' : 'bg-blue-500'
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <span className={cn('block h-full rounded-full', fill)} style={{ width: `${value === null ? 0 : Math.min(100, Math.max(0, value))}%` }} />
    </span>
  )
}

/** The closing call to action of a report: train again, or go to 我的训练. */
export function ReportActions({ title, description, historyHref, againLabel, onAgain }: {
  title: string
  description: string
  historyHref: string
  againLabel: string
  onAgain: () => void
}) {
  return (
    <section className="fp-card flex flex-col items-start justify-between gap-4 bg-gradient-to-r from-white to-blue-50/80 p-5 sm:flex-row sm:items-center sm:p-6" aria-label="报告操作">
      <div>
        <h2 className="text-balance text-lg font-bold text-slate-950">{title}</h2>
        <p className="mt-0.5 text-pretty text-sm text-slate-600">{description}</p>
      </div>
      <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
        <a href={historyHref} className="secondary-button inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">查看训练记录</a>
        <button type="button" onClick={onAgain} className="primary-button inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">{againLabel}</button>
      </div>
    </section>
  )
}
