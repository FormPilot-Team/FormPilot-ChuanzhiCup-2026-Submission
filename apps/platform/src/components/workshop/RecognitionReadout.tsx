import { Check, Minus, X } from 'lucide-react'
import { PHASE_LABELS, REQUIREMENTS } from '../../features/workshop/catalog'
import type { RecognizerPhase, RequirementResult } from '../../features/workshop/recognition/recognizer'
import type { PhaseThresholds } from '../../features/workshop/types'
import { cn } from '../../lib/cn'

const SCALE_MAX = 1.2

function position(value: number): number {
  return Math.round((Math.min(SCALE_MAX, Math.max(0, value)) / SCALE_MAX) * 1000) / 10
}

/**
 * Where the user is between the start pose (0 %) and the finish pose (100 %), with the thresholds that start a
 * movement and count it as reached. The number is always written out; the bar is a visual aid.
 */
export function ProgressMeter({ progress, phase, thresholds, label = '动作进度' }: {
  progress: number | null
  phase: RecognizerPhase
  thresholds: PhaseThresholds
  label?: string
}) {
  const percent = progress === null ? null : Math.round(Math.max(0, progress) * 100)
  return (
    <div className="min-w-0" data-testid="recognition-meter" data-phase={phase} data-progress={percent ?? ''}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-500"><strong className="text-lg text-slate-950">{percent === null ? '—' : `${percent}%`}</strong> · {PHASE_LABELS[phase]}</span>
      </div>
      <div
        className="relative mt-2 h-3 rounded-full bg-slate-100"
        role="meter"
        aria-label={`${label}：从开始姿势到完成姿势`}
        aria-valuemin={0}
        aria-valuemax={Math.round(SCALE_MAX * 100)}
        aria-valuenow={percent ?? 0}
        aria-valuetext={percent === null ? '暂时看不清' : `${percent}%，${PHASE_LABELS[phase]}`}
      >
        <span className={cn('absolute inset-y-0 left-0 rounded-full', progress !== null && progress >= thresholds.peak ? 'bg-emerald-500' : 'fp-energy-gradient')} style={{ width: `${percent === null ? 0 : position(progress ?? 0)}%` }} />
        <span className="absolute inset-y-[-3px] w-0.5 rounded bg-slate-400" style={{ left: `${position(thresholds.moving)}%` }} aria-hidden="true" />
        <span className="absolute inset-y-[-3px] w-0.5 rounded bg-emerald-600" style={{ left: `${position(thresholds.peak)}%` }} aria-hidden="true" />
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-slate-500" aria-hidden="true">
        <span className="absolute -translate-x-1/2" style={{ left: `${position(thresholds.moving)}%` }}>开始</span>
        <span className="absolute -translate-x-1/2 font-semibold text-emerald-700" style={{ left: `${position(thresholds.peak)}%` }}>到位</span>
      </div>
    </div>
  )
}

/** Each 识别重点 of the last repetition, with text next to the icon so the state never relies on colour alone. */
export function RequirementResults({ results, emptyText = '完成一次动作后显示' }: { results?: ReadonlyArray<RequirementResult>; emptyText?: string }) {
  if (!results?.length) return <p className="text-sm text-slate-500">{emptyText}</p>
  return (
    <ul className="grid gap-1.5" data-testid="requirement-results">
      {results.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-sm" data-requirement={item.id} data-passed={item.passed === null ? 'unknown' : String(item.passed)}>
          <span className="min-w-0 truncate text-slate-700">{REQUIREMENTS[item.id].label}</span>
          {item.passed === null ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-500"><Minus size={14} aria-hidden="true" />看不清</span>
          ) : item.passed ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700"><Check size={14} aria-hidden="true" />达标</span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-coral-600"><X size={14} aria-hidden="true" />未达标</span>
          )}
        </li>
      ))}
    </ul>
  )
}
