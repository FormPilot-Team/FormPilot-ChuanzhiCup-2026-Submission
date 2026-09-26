import { ArrowRight, Check, CircleDashed, Clock3, TrendingUp } from 'lucide-react'
import { reportPath } from '../../app/routes'
import type { CustomHistoryItem } from '../../features/history/customHistory'
import { cn } from '../../lib/cn'
import { formatDate, formatDuration } from '../Report/reportPresentation'

function comparisonText(item: CustomHistoryItem): string | null {
  const { comparison } = item.report
  if (!comparison.available || comparison.passRateDelta === null) return null
  if (comparison.passRateDelta === 0) return '达标比例与上次持平'
  return comparison.passRateDelta > 0 ? `达标比例 ↑ ${comparison.passRateDelta}%` : `达标比例 ↓ ${Math.abs(comparison.passRateDelta)}%`
}

/** A custom-action training in the history: same card shape as the other modes, its own results inside. */
export function CustomActionHistoryCard({ item }: { item: CustomHistoryItem }) {
  const { record, report } = item
  const CompletionIcon = item.incomplete ? CircleDashed : Check
  const duration = record.activeMs > 0 ? record.activeMs : record.endedAt !== undefined ? Math.max(0, record.endedAt - record.startedAt) : null
  const comparison = comparisonText(item)
  return (
    <article data-testid={`history-card-${record.id}`} data-kind="custom">
      <a
        href={reportPath(record.id)}
        className="group block rounded-2xl border border-slate-200 bg-white p-5 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:p-6"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <time className="text-base font-bold text-slate-950" dateTime={new Date(record.startedAt).toISOString()}>{formatDate(record.startedAt)}</time>
              <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800" data-testid="history-custom-label">我的动作 · {record.actionName}</span>
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold', item.incomplete ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-800')}>
                <CompletionIcon size={13} aria-hidden="true" />{item.incomplete ? '训练未完成' : '训练完成'}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
              <span className="inline-flex items-center gap-2 font-semibold text-slate-700"><Clock3 size={16} className="text-slate-400" aria-hidden="true" />{formatDuration(duration)}</span>
              <span className="inline-flex items-center gap-2 font-bold tabular-nums text-slate-950"><TrendingUp size={16} className="text-blue-600" aria-hidden="true" />{report.headline}</span>
              {comparison ? <span className="font-semibold tabular-nums text-slate-600">{comparison}</span> : null}
            </div>
            {report.primaryFeedback ? <p className="mt-4 text-pretty text-sm font-semibold text-slate-700">重点：{report.primaryFeedback.message}</p> : null}
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 self-start text-sm font-bold text-blue-700 group-hover:text-blue-800 lg:self-center">查看报告<ArrowRight size={17} aria-hidden="true" /></span>
        </div>
      </a>
    </article>
  )
}
