import { ArrowRight, Check, CircleDashed, Clock3, TrendingUp } from 'lucide-react'
import { reportPath } from '../../app/routes'
import { ROUTINE_ACCENT } from '../../components/routines/routineTheme'
import type { RoutineHistoryItem } from '../../features/history/routineHistory'
import type { RoutineComparison } from '../../features/routines/report/routineReport'
import { scopeTitle } from '../../features/routines/scope'
import { cn } from '../../lib/cn'
import { formatDate, formatDuration } from '../Report/reportPresentation'

function routineComparisonText(comparison: RoutineComparison): string | null {
  if (!comparison.available || comparison.similarityDelta === null || comparison.similarityTrend === null) return null
  if (comparison.similarityTrend === 'flat') return '与上次基本持平'
  return comparison.similarityDelta > 0 ? `相似度 ↑ ${comparison.similarityDelta}` : `相似度 ↓ ${Math.abs(comparison.similarityDelta)}`
}

function recordDuration(item: RoutineHistoryItem): number | null {
  if (item.record.activeMs > 0) return item.record.activeMs
  return item.record.endedAt !== undefined ? Math.max(0, item.record.endedAt - item.record.startedAt) : null
}

/** A follow-along routine in the training history: same card shape as Smart Training, routine metrics inside. */
export function RoutineHistoryCard({ item }: { item: RoutineHistoryItem }) {
  const { record, report } = item
  const accent = ROUTINE_ACCENT[report.program.accent]
  const comparison = routineComparisonText(report.comparison)
  const CompletionIcon = item.incomplete ? CircleDashed : Check
  const focus = report.weakestChapter && report.weakestChapter.band !== 'high' ? report.weakestChapter : null
  return (
    <article data-testid={`history-card-${record.id}`} data-kind="routine">
      <a
        href={reportPath(record.id)}
        className="group block rounded-2xl border border-slate-200 bg-white p-5 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:p-6"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <time className="text-base font-bold text-slate-950" dateTime={new Date(record.startedAt).toISOString()}>{formatDate(record.startedAt)}</time>
              <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', accent.chip)} data-testid="history-routine-label">{scopeTitle(report.program, record.scope)}</span>
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold', item.incomplete ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-800')}>
                <CompletionIcon size={13} aria-hidden="true" />{item.incomplete ? '训练未完成' : '训练完成'}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
              <span className="inline-flex items-center gap-2 font-semibold text-slate-700"><Clock3 size={16} className="text-slate-400" aria-hidden="true" />{formatDuration(recordDuration(item))}</span>
              <span className="inline-flex items-center gap-2 font-bold tabular-nums text-slate-950"><TrendingUp size={16} className="text-blue-600" aria-hidden="true" />{report.headline}</span>
              {comparison ? <span className="font-semibold tabular-nums text-slate-600">{comparison}</span> : null}
            </div>
            {focus ? <p className="mt-4 text-pretty text-sm font-semibold text-slate-700">重点：{focus.chapter.label === focus.chapter.name ? focus.chapter.name : `${focus.chapter.label} ${focus.chapter.name}`} · 相似度 {focus.similarity}%</p> : null}
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 self-start text-sm font-bold text-blue-700 group-hover:text-blue-800 lg:self-center">查看报告<ArrowRight size={17} aria-hidden="true" /></span>
        </div>
      </a>
    </article>
  )
}
