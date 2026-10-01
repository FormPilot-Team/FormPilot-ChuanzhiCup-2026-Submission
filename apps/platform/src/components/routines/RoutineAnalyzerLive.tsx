import { Sparkles } from 'lucide-react'
import type { RoutineAnalysisLive } from '../../features/routines/analyzers/RoutineAnalysisEngine'
import type { AnalyzerFeedbackTone } from '../../features/routines/analyzers/types'
import { cn } from '../../lib/cn'

const TONE: Readonly<Record<AnalyzerFeedbackTone, string>> = {
  info: 'text-slate-600',
  success: 'text-emerald-700',
  warning: 'text-amber-800',
}

/**
 * 专项分析 on the training page: the routine analyzer's view of the last few seconds (八段锦到位度 …), one score and
 * its most relevant sentence. Shown only; it is never spoken and does not change the AI Coach line above.
 */
export function RoutineAnalyzerLive({ title, live, following }: { title: string; live: RoutineAnalysisLive | null; following: boolean }) {
  const score = following ? live?.score ?? null : null
  const message = !following ? '开始跟练后显示' : live?.feedback?.message ?? '正在读取动作…'
  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-3 py-2" data-testid="routine-analyzer-live" data-analyzer={live?.analyzerId ?? ''} data-analyzer-score={score ?? ''}>
      <div className="flex min-w-0 items-center gap-1.5">
        <Sparkles size={15} className="shrink-0 text-blue-600" aria-hidden="true" />
        <h3 className="min-w-0 truncate text-sm font-bold text-slate-900">专项分析 · {title}</h3>
        <span className="ml-auto shrink-0 text-sm font-bold tabular-nums text-slate-950">{score === null ? '—' : score}</span>
      </div>
      <p className={cn('mt-0.5 line-clamp-1 text-xs', following && live?.feedback ? TONE[live.feedback.tone] : 'text-slate-500')} title={message}>{message}</p>
    </div>
  )
}
