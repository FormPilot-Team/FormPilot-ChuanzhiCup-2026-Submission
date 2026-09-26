import { useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, ChartNoAxesCombined, Check, CircleDashed,
  Clock3, History, RefreshCw, TrendingUp,
} from 'lucide-react'
import { START_TRAINING_PATH } from '../../app/routes'
import { AppHeader } from '../../components/layout/AppHeader'
import {
  historyComparisonText, historyScoreText, loadTrainingHistory, type TrainingHistoryItem,
  type TrainingHistoryOverview, type TrainingTrendPoint,
} from '../../features/history/TrainingHistory'
import { loadRoutineHistory, mergeHistoryEntries, type HistoryEntry, type RoutineHistoryItem } from '../../features/history/routineHistory'
import { loadCustomHistory, type CustomHistoryItem } from '../../features/history/customHistory'
import { LocalStorageCustomSessionRepository, type CustomSessionRepository } from '../../features/workshop/session'
import { LocalStorageRoutineSessionRepository, type RoutineSessionRepository } from '../../features/routines/session/RoutineSessionRepository'
import { LocalStorageTrainingSessionRepository } from '../../features/training/LocalStorageTrainingSessionRepository'
import type { TrainingSessionRepository } from '../../features/training/TrainingSessionRepository'
import { freeTrainingLabel } from '../../features/training/trainingScope'
import { cn } from '../../lib/cn'
import { formatDate, formatDuration, formatShortDate } from '../Report/reportPresentation'
import { CustomActionHistoryCard } from './CustomActionHistoryCard'
import { RoutineHistoryCard } from './RoutineHistoryCard'

const localRepository = new LocalStorageTrainingSessionRepository()
const localRoutineRepository = new LocalStorageRoutineSessionRepository()
const localCustomRepository = new LocalStorageCustomSessionRepository()

type HistoryFilter = 'all' | 'smart' | 'routine' | 'custom'

const FILTERS: ReadonlyArray<{ id: HistoryFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'smart', label: '热身训练' },
  { id: 'routine', label: '跟练课程' },
  { id: 'custom', label: '我的动作' },
]

function sessionDuration(item: TrainingHistoryItem): number | null {
  if (typeof item.session.totalDurationMs === 'number' && Number.isFinite(item.session.totalDurationMs)) {
    return Math.max(0, item.session.totalDurationMs)
  }
  if (typeof item.session.endedAt === 'number' && Number.isFinite(item.session.endedAt)) {
    return Math.max(0, item.session.endedAt - item.session.startedAt)
  }
  return null
}

function HistoryCard({ item }: { item: TrainingHistoryItem }) {
  const comparison = historyComparisonText(item.analysis)
  const priority = item.analysis.priorityIssues[0]
  const CompletionIcon = item.incomplete ? CircleDashed : Check
  return (
    <article data-testid={`history-card-${item.session.id}`}>
      <a
        href={`/report/${encodeURIComponent(item.session.id)}`}
        className="group block rounded-2xl border border-slate-200 bg-white p-5 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:p-6"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <time className="text-base font-bold text-slate-950" dateTime={new Date(item.session.startedAt).toISOString()}>{formatDate(item.session.startedAt)}</time>
              {item.scope.kind === 'free_training' ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800" data-testid="history-free-training-label">{freeTrainingLabel(item.scope.exerciseId)}</span> : null}
              {item.legacy ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">旧版本记录</span> : null}
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold', item.incomplete ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-800')}>
                <CompletionIcon size={13} aria-hidden="true" />{item.incomplete ? '训练未完成' : '训练完成'}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
              <span className="inline-flex items-center gap-2 font-semibold text-slate-700"><Clock3 size={16} className="text-slate-400" aria-hidden="true" />{formatDuration(sessionDuration(item))}</span>
              <span className="inline-flex items-center gap-2 font-bold tabular-nums text-slate-950"><TrendingUp size={16} className="text-blue-600" aria-hidden="true" />{historyScoreText(item.analysis, item.scope)}</span>
              {comparison ? <span className="font-semibold tabular-nums text-slate-600">{comparison}</span> : null}
            </div>
            {priority ? <p className="mt-4 text-pretty text-sm font-semibold text-slate-700">重点：{priority.reportLabel}</p> : null}
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 self-start text-sm font-bold text-blue-700 group-hover:text-blue-800 lg:self-center">查看报告<ArrowRight size={17} aria-hidden="true" /></span>
        </div>
      </a>
    </article>
  )
}

function Sparkline({ sessions }: { sessions: TrainingTrendPoint[] }) {
  const width = 640
  const height = 170
  const insetX = 32
  const insetTop = 24
  const insetBottom = 34
  const scores = sessions.map((item) => item.score)
  const minimum = Math.min(...scores)
  const maximum = Math.max(...scores)
  const padding = Math.max(4, Math.ceil((maximum - minimum) * 0.2))
  const domainMin = Math.max(0, minimum - padding)
  const domainMax = Math.min(100, maximum + padding)
  const domain = Math.max(1, domainMax - domainMin)
  const x = (index: number) => sessions.length === 1 ? width / 2 : insetX + index * ((width - insetX * 2) / (sessions.length - 1))
  const y = (score: number) => insetTop + ((domainMax - score) / domain) * (height - insetTop - insetBottom)
  const points = sessions.map((item, index) => `${x(index)},${y(item.score)}`).join(' ')
  const first = sessions[0]
  const last = sessions.at(-1)
  return (
    <div className="min-w-0">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-labelledby="history-trend-title history-trend-desc" data-testid="history-score-trend">
        <title id="history-trend-title">最近完整训练评分趋势</title>
        <desc id="history-trend-desc">{sessions.map((item) => `${formatShortDate(item.startedAt)} ${item.score} 分`).join('，')}</desc>
        {[0, 0.5, 1].map((position) => {
          const lineY = insetTop + position * (height - insetTop - insetBottom)
          return <line key={position} x1={insetX} x2={width - insetX} y1={lineY} y2={lineY} stroke="#e2e8f0" strokeWidth="1" />
        })}
        <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {sessions.map((item, index) => <circle key={item.sessionId} cx={x(index)} cy={y(item.score)} r="5" fill="#fff" stroke="#2563eb" strokeWidth="3" />)}
        {first ? <text x={insetX} y={height - 8} fill="#64748b" fontSize="12">{formatShortDate(first.startedAt)}</text> : null}
        {last ? <text x={width - insetX} y={height - 8} fill="#64748b" fontSize="12" textAnchor="end">{formatShortDate(last.startedAt)}</text> : null}
      </svg>
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="评分趋势数据">
        {sessions.map((item) => <li key={item.sessionId} className="rounded-xl bg-slate-50 px-3 py-2"><span className="block text-xs text-slate-500">{formatShortDate(item.startedAt)}</span><span className="mt-0.5 block font-bold tabular-nums text-slate-950">{item.score} 分</span></li>)}
      </ol>
    </div>
  )
}

function ProgressOverview({ overview }: { overview: TrainingHistoryOverview }) {
  if (!overview.available) {
    return (
      <section className="report-panel p-5 sm:p-7" aria-labelledby="recent-progress-title" data-testid="history-progress-unavailable">
        <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><ChartNoAxesCombined size={20} aria-hidden="true" /></span><div><h2 id="recent-progress-title" className="text-balance text-xl font-bold text-slate-950">热身训练 · 近期进步</h2><p className="mt-2 text-pretty text-sm leading-6 text-slate-600">完成至少 3 次热身训练完整课程后，这里会显示近期变化。</p></div></div>
      </section>
    )
  }

  const first = overview.trendSessions[0]
  const last = overview.trendSessions.at(-1)
  const delta = first && last ? last.score - first.score : 0
  const deltaText = delta > 0 ? `+${delta}` : String(delta)
  return (
    <section className="report-panel p-5 sm:p-7" aria-labelledby="recent-progress-title" data-testid="history-progress-overview">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 id="recent-progress-title" className="text-balance text-xl font-bold text-slate-950">热身训练 · 近期进步</h2><p className="mt-1 text-pretty text-sm leading-6 text-slate-600">仅统计规则一致、完整完成的热身训练课程。</p></div>
        {last ? <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm"><p className="text-slate-600">最近一次 <strong className="text-lg tabular-nums text-slate-950">{last.score} 分</strong></p><p className="text-slate-600">相比第一条 <strong className="tabular-nums text-slate-950">{deltaText} 分</strong></p></div> : null}
      </div>
      <div className="mt-6 grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1.5fr)_minmax(260px,.7fr)]">
        <Sparkline sessions={overview.trendSessions} />
        <div>
          <h3 className="text-balance font-bold text-slate-950">近期反复出现</h3>
          {overview.recurringIssues.length ? <ul className="mt-3 divide-y divide-slate-100">{overview.recurringIssues.map((issue) => <li key={issue.id} className="py-3 first:pt-0"><p className="text-sm font-semibold text-slate-800">{issue.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">最近 {issue.sampleSize} 次训练中有 {issue.sessionCount} 次需要关注</p></li>)}</ul> : <p className="mt-3 text-pretty text-sm leading-6 text-slate-500">近期没有同一问题在多次完整训练中达到显著程度。</p>}
        </div>
      </div>
    </section>
  )
}

function HistoryEntryCard({ entry }: { entry: HistoryEntry }) {
  if (entry.kind === 'custom') return <CustomActionHistoryCard item={entry.custom} />
  return entry.kind === 'smart' ? <HistoryCard item={entry.smart} /> : <RoutineHistoryCard item={entry.routine} />
}

export function TrainingHistoryView({ items, overview, routineItems = [], routineUnavailable = false, customItems = [], customUnavailable = false }: {
  items: TrainingHistoryItem[]
  overview: TrainingHistoryOverview
  routineItems?: RoutineHistoryItem[]
  routineUnavailable?: boolean
  customItems?: CustomHistoryItem[]
  customUnavailable?: boolean
}) {
  const [showIncomplete, setShowIncomplete] = useState(false)
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const entries = mergeHistoryEntries(items, routineItems, customItems).filter((entry) => filter === 'all' || entry.kind === filter)
  const visibleEntries = showIncomplete ? entries : entries.filter((entry) => !entry.incomplete)
  const hiddenIncomplete = entries.filter((entry) => entry.incomplete).length
  const empty = items.length === 0 && routineItems.length === 0 && customItems.length === 0
  return (
    <div className="fp-page min-h-dvh min-w-0 overflow-x-clip text-slate-900">
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-[1200px] px-4 pb-12 pt-5 sm:px-6 lg:px-8">
        <a href="/" className="mb-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeft size={17} aria-hidden="true" />返回首页</a>
        <header className="mb-6 flex items-start gap-4 sm:mb-8"><span className="fp-energy-gradient grid size-12 shrink-0 place-items-center rounded-2xl text-white shadow-[0_8px_18px_-10px_rgb(14_165_233/0.9)]"><History size={23} aria-hidden="true" /></span><div><h1 className="text-balance text-3xl font-bold text-slate-950 sm:text-4xl">我的训练</h1><p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-slate-600 sm:text-base">查看每次训练的报告，了解热身训练、跟练课程和我的动作的近期变化。</p></div></header>
        {routineUnavailable ? <p className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status" data-testid="history-routine-unavailable">跟练课程记录暂时无法读取，其他训练记录不受影响。</p> : null}
        {customUnavailable ? <p className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status" data-testid="history-custom-unavailable">我的动作训练记录暂时无法读取，其他训练记录不受影响。</p> : null}

        {empty ? (
          <section className="report-panel p-8 text-center sm:p-10" data-testid="history-empty"><CalendarDays className="mx-auto text-slate-400" size={34} aria-hidden="true" /><h2 className="mt-4 text-balance text-xl font-bold text-slate-950">还没有训练记录</h2><p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-6 text-slate-600">完成一次训练后，报告会保存在这里。</p><a href={START_TRAINING_PATH} className="primary-button mt-6 inline-flex items-center justify-center gap-2">开始训练<ArrowRight size={16} aria-hidden="true" /></a></section>
        ) : (
          <div className="space-y-5 sm:space-y-6">
            <ProgressOverview overview={overview} />
            <section aria-labelledby="history-list-title">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div><h2 id="history-list-title" className="text-balance text-xl font-bold text-slate-950">训练记录</h2><p className="mt-1 text-pretty text-sm text-slate-500">最新记录排在最前</p></div>
                <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
                  <div className="inline-flex rounded-xl bg-white p-1 shadow-sm" role="group" aria-label="按训练模式筛选" data-testid="history-filter">
                    {FILTERS.map((item) => (
                      <button key={item.id} type="button" onClick={() => setFilter(item.id)} aria-pressed={filter === item.id} className={cn('rounded-lg px-3 py-1.5 text-sm font-semibold', filter === item.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>{item.label}</button>
                    ))}
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-3 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm"><input type="checkbox" checked={showIncomplete} onChange={(event) => setShowIncomplete(event.target.checked)} className="size-4 accent-blue-600" />显示未完成训练{hiddenIncomplete ? <span className="tabular-nums text-slate-400">{hiddenIncomplete}</span> : null}</label>
                </div>
              </div>
              {visibleEntries.length
                ? <div className="space-y-3" data-testid="history-list">{visibleEntries.map((entry) => <HistoryEntryCard key={entry.id} entry={entry} />)}</div>
                : <div className="report-panel p-7 text-center" data-testid="history-incomplete-hidden"><CircleDashed className="mx-auto text-slate-400" size={30} aria-hidden="true" /><p className="mt-3 text-balance font-bold text-slate-900">当前没有已完成的训练</p><p className="mt-2 text-pretty text-sm text-slate-600">{hiddenIncomplete ? '开启“显示未完成训练”可以查看已保存的中途记录。' : '换一个筛选条件看看。'}</p></div>}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

export function TrainingHistoryError() {
  return <div className="min-h-dvh bg-[#f5f7fa] text-slate-900"><AppHeader /><main className="mx-auto grid min-h-[70dvh] max-w-3xl place-items-center px-4 py-12"><section className="report-panel w-full p-8 text-center" data-testid="history-read-error"><span className="mx-auto grid size-12 place-items-center rounded-xl bg-amber-50 text-amber-700"><AlertTriangle size={22} aria-hidden="true" /></span><h1 className="mt-4 text-balance text-2xl font-bold">暂时无法读取训练记录</h1><p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-6 text-slate-600">本地记录读取失败，请稍后重新打开。已有训练不会因此被修改。</p><button type="button" onClick={() => window.location.reload()} className="secondary-button mt-6 inline-flex items-center justify-center gap-2"><RefreshCw size={16} aria-hidden="true" />重新读取</button></section></main></div>
}

export function TrainingHistoryPage({ repository = localRepository, routineRepository = localRoutineRepository, customRepository = localCustomRepository }: {
  repository?: TrainingSessionRepository
  routineRepository?: RoutineSessionRepository
  customRepository?: CustomSessionRepository
}) {
  const state = useMemo(() => loadTrainingHistory(repository), [repository])
  const routine = useMemo(() => loadRoutineHistory(routineRepository), [routineRepository])
  const custom = useMemo(() => loadCustomHistory(customRepository), [customRepository])
  if (state.status === 'error') return <TrainingHistoryError />
  return (
    <TrainingHistoryView
      items={state.items}
      overview={state.overview}
      routineItems={routine.status === 'ready' ? routine.items : []}
      routineUnavailable={routine.status === 'error'}
      customItems={custom.status === 'ready' ? custom.items : []}
      customUnavailable={custom.status === 'error'}
    />
  )
}
