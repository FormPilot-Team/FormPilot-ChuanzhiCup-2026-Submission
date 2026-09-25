import { Activity, Gauge, Lightbulb, MoveHorizontal, RefreshCw, ShieldCheck, TimerReset } from 'lucide-react'
import type { ExercisePresentation, MetricPresentation } from '../../features/exercises/contract'
import type { RuleResult } from '../../features/exercises/types'
import { cn } from '../../lib/cn'

const icons = { amplitude: Activity, symmetry: MoveHorizontal, coordination: RefreshCw, stability: ShieldCheck, tempo: TimerReset }

type TrackingState = 'preparing' | 'normal' | 'adjust' | 'paused'

interface MetricsPanelProps { result: RuleResult; presentation: ExercisePresentation; advice?: string; guidanceOnly?: boolean; trackingState?: TrackingState }

export function MetricsPanel({ result, presentation, advice, guidanceOnly = false, trackingState = 'preparing' }: MetricsPanelProps) {
  const resolvedAdvice = advice ?? result.primaryFeedback?.message ?? presentation.adviceFallback
  const tracking = trackingState === 'normal' ? { label: '识别正常', tone: 'bg-emerald-50 text-emerald-600' }
    : trackingState === 'adjust' ? { label: '请调整位置', tone: 'bg-coral-50 text-coral-600' }
      : trackingState === 'paused' ? { label: '训练暂停', tone: 'bg-slate-100 text-slate-600' }
        : { label: '准备中', tone: 'bg-blue-50 text-blue-600' }
  return (
    <section className="flex min-h-0 min-w-0 flex-col" aria-labelledby="metrics-title">
      <div className="flex min-w-0 items-center gap-2 pb-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Gauge size={18} /></span>
        <h2 id="metrics-title" className="min-w-0 truncate font-bold text-slate-900">详细指标</h2>
        <span className={cn('ml-auto shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold', tracking.tone)}>{tracking.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {presentation.metrics.map((meta) => <MetricCard key={meta.key} meta={meta} score={result.metrics[meta.key]?.score ?? 0} guidanceOnly={guidanceOnly} />)}
      </div>
      <div className="mt-3 grid min-h-0 flex-1 grid-cols-2 gap-3">
        <article className="rounded-2xl border border-slate-100 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Activity size={17} className="text-blue-500" />当前阶段</div>
          <p className="mt-3 inline-flex rounded-xl bg-blue-50 px-3 py-2 text-lg font-bold text-blue-600">{presentation.phaseLabels[result.phase] ?? result.phase}</p>
          <p className="mt-3 text-pretty text-xs leading-5 text-slate-500">{presentation.phaseHint}</p>
        </article>
        <article className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Lightbulb size={18} className="text-amber-500" />AI 建议</div>
          <p className="mt-3 text-pretty text-sm leading-6 text-slate-700">{resolvedAdvice}</p>
        </article>
      </div>
    </section>
  )
}

function MetricCard({ meta, score, guidanceOnly }: { meta: MetricPresentation; score: number; guidanceOnly: boolean }) {
  const Icon = icons[meta.icon]
  const green = meta.tone === 'green'
  return (
    <article className="rounded-2xl border border-slate-100 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className={cn('grid size-8 place-items-center rounded-xl', green ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600')}><Icon size={17} /></span>
        <h3 className="min-w-0 whitespace-nowrap text-xs font-semibold text-slate-800 sm:text-sm">{meta.label}</h3>
        <strong className={cn('ml-auto shrink-0 whitespace-nowrap tabular-nums', green ? 'text-emerald-600' : 'text-blue-600')}>{guidanceOnly ? '引导' : <>{score}<span className="ml-0.5 text-xs">分</span></>}</strong>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={cn('h-full rounded-full', green ? 'bg-emerald-500' : 'bg-blue-500')} style={{ width: `${score}%` }} /></div>
      <p className="mt-2 line-clamp-1 text-pretty text-xs text-slate-500">{meta.note}</p>
    </article>
  )
}
