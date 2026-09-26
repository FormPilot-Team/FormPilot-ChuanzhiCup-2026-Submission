import { ArrowRight, ChartLine } from 'lucide-react'
import { HISTORY_PATH, reportPath } from '../../app/routes'
import { weekChangeText, type HomeTrainingSummary } from '../../features/history/homeSummary'
import { cn } from '../../lib/cn'
import { formatDate } from '../../pages/Report/reportPresentation'

function barHeight(count: number): string {
  if (count <= 0) return 'h-1.5'
  if (count === 1) return 'h-5'
  if (count === 2) return 'h-8'
  return 'h-11'
}

/**
 * "我的训练" on Home answers "how am I doing": the latest finished training, this week's count and rhythm, and one
 * way into History. It replaces the former 训练记录 card and 最近训练 strip.
 */
export function MyTrainingSummary({ summary, unavailable = false }: { summary: HomeTrainingSummary; unavailable?: boolean }) {
  const { latest } = summary
  const change = weekChangeText(summary)
  return (
    <section className="fp-card flex min-w-0 flex-col p-5 sm:p-6" aria-labelledby="my-training-title" data-testid="home-training-history">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700"><ChartLine size={20} aria-hidden="true" /></span>
          <h2 id="my-training-title" className="fp-section-title">我的训练</h2>
        </div>
        <a href={HISTORY_PATH} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-bold text-blue-700 ring-1 ring-blue-100 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid="home-history-link">
          查看训练记录<ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
      {unavailable ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900" role="status">部分训练记录暂时无法读取。</p> : null}

      <div className="mt-5 grid min-w-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col rounded-2xl bg-gradient-to-br from-slate-50 to-blue-50/60 p-4" data-testid="home-latest-training">
          <p className="text-xs font-semibold text-slate-500">最近一次</p>
          {latest ? (
            <>
              <p className="mt-1.5 truncate font-bold text-slate-950" title={latest.title}>{latest.title}</p>
              <p className="mt-0.5 text-xs tabular-nums text-slate-500"><time dateTime={new Date(latest.startedAt).toISOString()}>{formatDate(latest.startedAt)}</time></p>
              <p className="mt-3 text-pretty text-lg font-bold tabular-nums text-blue-800">{latest.headline}</p>
              <a href={reportPath(latest.id)} className="mt-auto inline-flex items-center gap-1 self-start rounded-lg pt-3 text-sm font-bold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                查看报告<ArrowRight size={15} aria-hidden="true" />
              </a>
            </>
          ) : (
            <p className="mt-2 text-pretty text-sm leading-6 text-slate-600">还没有训练记录。选一种训练开始，完成后会在这里看到表现。</p>
          )}
        </div>

        <div className="min-w-0 rounded-2xl p-1" data-testid="home-week">
          <p className="text-xs font-semibold text-slate-500">本周</p>
          <p className="mt-1 flex items-baseline gap-1.5 text-slate-600">
            <strong className="text-3xl font-bold tabular-nums text-slate-950">{summary.weekCount}</strong>
            <span className="text-sm font-semibold">次完成的训练</span>
          </p>
          {change ? <p className="mt-0.5 text-xs font-semibold text-slate-500">{change}</p> : null}
          <ol className="mt-3 grid grid-cols-7 items-end gap-1.5" aria-label="本周每天完成的训练">
            {summary.week.map((day) => (
              <li key={day.key} className="flex min-w-0 flex-col items-center gap-1">
                <span className="flex h-11 w-full items-end justify-center" aria-hidden="true">
                  <span className={cn('w-full max-w-5 rounded-full', barHeight(day.count), day.count > 0 ? 'fp-energy-gradient' : day.future ? 'bg-slate-100' : 'bg-slate-200')} />
                </span>
                <span className={cn('text-xs tabular-nums', day.today ? 'font-bold text-blue-700' : 'text-slate-400')} aria-hidden="true">{day.label}</span>
                <span className="sr-only">周{day.label}{day.today ? '（今天）' : ''}：{day.count} 次</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
