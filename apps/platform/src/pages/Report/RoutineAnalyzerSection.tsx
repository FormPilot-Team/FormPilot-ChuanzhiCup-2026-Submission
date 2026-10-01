import { ChevronDown, Sparkles } from 'lucide-react'
import type { MetricResult } from '../../features/routines/analyzers/types'
import type { RoutineReport } from '../../features/routines/report/routineReport'
import { chapterDisplayName } from '../../features/routines/scope'
import { cn } from '../../lib/cn'
import { scoreTone } from './reportPresentation'
import { MiniBar, SectionHeading } from './reportShell'

interface CategorySummary {
  category: string
  label: string
  quality: string
  profileRatio: number | null
  score: number | null
}

function categoriesOf(extras: Record<string, unknown>): CategorySummary[] {
  return Array.isArray(extras.categories) ? (extras.categories as CategorySummary[]) : []
}

function MetricLine({ metric }: { metric: MetricResult }) {
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-white px-3 py-1.5 text-xs ring-1 ring-slate-100" data-testid="routine-analyzer-metric" data-metric-id={metric.id} data-metric-evaluated={metric.evaluated ? 'true' : 'false'}>
      <span className="min-w-0 font-semibold text-slate-800">{metric.label}</span>
      <span className="text-slate-600">{metric.display}</span>
      <span className="ml-auto shrink-0 font-bold tabular-nums text-slate-950">
        {!metric.evaluated ? '只记录' : metric.score === null ? '—' : metric.score}
      </span>
      {metric.note && !metric.evaluated ? <p className="w-full text-pretty text-slate-500">{metric.note}</p> : null}
    </li>
  )
}

/**
 * 专项分析: the routine analyzer's own evaluation (八段锦到位度、太极拳连续性、五禽戏五戏特征、易筋经稳定性), per
 * chapter with the measured values. Kept apart from 跟练相似度 and 动作规范评价; nothing here changes them.
 */
export function RoutineAnalyzerSection({ report }: { report: RoutineReport }) {
  const analysis = report.analysis
  if (!analysis) return null
  const chapters = new Map(report.program.chapters.map((chapter) => [chapter.id, chapter]))
  const categories = categoriesOf(analysis.extras)
  return (
    <section className="report-panel p-5 sm:p-6" aria-labelledby="routine-analyzer-title" data-testid="routine-report-analyzer" data-analyzer={analysis.analyzerId}>
      <SectionHeading id="routine-analyzer-title" icon={Sparkles} title={`专项分析 · ${analysis.title}`} description="按本功法自身的要点逐段估计你与示范动作的一致程度，数值来自二维画面中你与示范者在同一段落的比较；与跟练相似度、动作规范评价分开计算。" />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-3xl font-bold tabular-nums text-slate-950" data-testid="routine-analyzer-score">{analysis.score === null ? '—' : analysis.score}</p>
        <div className="w-40"><MiniBar value={analysis.score} tone={scoreTone(analysis.score)} /></div>
        <p className="text-xs text-slate-500">{analysis.score === null ? '识别数据不足，暂不给出专项分析' : '各段专项分的平均'}</p>
      </div>
      {categories.length ? (
        <dl className="mt-4 grid gap-2 sm:grid-cols-5" data-testid="routine-analyzer-categories">
          {categories.map((item) => (
            <div key={item.category} className="rounded-xl bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">{item.label} · {item.quality}</dt>
              <dd className="mt-1 font-bold tabular-nums text-slate-950">{item.score ?? '—'}</dd>
              <p className="text-xs text-slate-500">{item.profileRatio === null ? '特征未能识别' : `特征幅度为示范的 ${Math.round(item.profileRatio * 100)}%`}</p>
            </div>
          ))}
        </dl>
      ) : null}
      <ol className="mt-4 space-y-2">
        {analysis.chapters.map((item) => {
          const chapter = chapters.get(item.chapterId)
          if (!chapter) return null
          const top = item.feedback[0]
          return (
            <li key={item.chapterId} data-testid={`routine-analyzer-chapter-${item.chapterId}`}>
              <details className="group rounded-xl border border-slate-100 bg-slate-50/60">
                <summary className="flex min-w-0 cursor-pointer list-none items-center gap-3 px-3 py-2.5 marker:content-none">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{chapterDisplayName(chapter)}</span>
                    <span className={cn('block truncate text-xs', top?.tone === 'warning' ? 'text-amber-800' : 'text-slate-500')}>{top?.message ?? (item.score === null ? '识别数据不足' : '')}</span>
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-slate-950">{item.score ?? '—'}</span>
                  <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                </summary>
                {item.metrics.length ? <ul className="grid gap-1.5 px-3 pb-3">{item.metrics.map((metric) => <MetricLine key={metric.id} metric={metric} />)}</ul> : null}
              </details>
            </li>
          )
        })}
      </ol>
      <ul className="mt-4 space-y-1 text-pretty text-xs leading-5 text-slate-500" data-testid="routine-analyzer-notes">
        {analysis.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </section>
  )
}
