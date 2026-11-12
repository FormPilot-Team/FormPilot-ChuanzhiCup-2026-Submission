import { CheckCircle2 } from 'lucide-react'
import type { ExercisePresentation } from '../../features/exercises/contract'
import type { ExercisePhase } from '../../features/exercises/types'
import { cn } from '../../lib/cn'

interface WarmupCountCardProps {
  exerciseName: string
  progress: number
  target: number
  targetType: 'duration' | 'reps' | 'cycles'
  phase: ExercisePhase
  presentation: ExercisePresentation
  /** The exercise has reached its target (course moved on or finished). */
  complete: boolean
  /** Guidance-only exercise (shoulder rotation in the course): no score, still counted. */
  guidanceOnly?: boolean
}

const UNIT = { duration: '秒', reps: '次', cycles: '组' } as const
const TARGET_LABEL = { duration: '按时长', reps: '按次数', cycles: '按组数' } as const

/**
 * The large count and the movement phase of the warm-up (Web V1.1, C3). Every number comes from the existing exercise
 * runtime (course progress, target, rule-engine phase); nothing is computed here.
 */
export function WarmupCountCard({ exerciseName, progress, target, targetType, phase, presentation, complete, guidanceOnly = false }: WarmupCountCardProps) {
  // The phases the exercise itself names, in its own order; 完成 is shown as the card's completed state instead.
  const phases = (Object.entries(presentation.phaseLabels) as Array<[ExercisePhase, string]>).filter(([key]) => key !== 'COMPLETE')
  return (
    <section className="imm-panel px-4 py-3.5" aria-label="计数与动作阶段" data-testid="warmup-count" data-count={progress} data-target={target} data-phase={phase} data-complete={complete ? 'true' : 'false'}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-slate-400">{exerciseName} · {TARGET_LABEL[targetType]}{guidanceOnly ? ' · 引导动作' : ''}</p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className={cn('text-6xl font-extrabold leading-none tabular-nums', complete ? 'text-[#91e6d2]' : 'text-white')} data-testid="warmup-count-value">{progress}</span>
            <span className="text-xl font-semibold tabular-nums text-slate-400">/ {target} {UNIT[targetType]}</span>
          </p>
        </div>
        {complete ? (
          <span className="imm-chip imm-chip-good shrink-0" data-testid="warmup-complete"><CheckCircle2 size={14} aria-hidden="true" />本项完成</span>
        ) : null}
      </div>
      {phases.length ? (
        <ol className="mt-3 flex gap-1.5" aria-label="动作阶段" data-testid="warmup-phases">
          {phases.map(([key, label]) => {
            const current = key === phase
            return (
              <li
                key={key}
                className={cn('min-w-0 flex-1 truncate rounded-lg px-1 py-1.5 text-center text-xs', current ? 'bg-sky-300/20 font-bold text-white ring-1 ring-sky-300/60' : 'bg-white/[0.05] text-slate-400')}
                aria-current={current ? 'step' : undefined}
                data-phase-key={key}
              >
                {label}
              </li>
            )
          })}
        </ol>
      ) : null}
    </section>
  )
}
