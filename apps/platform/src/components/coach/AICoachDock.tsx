import type { ReactNode } from 'react'
import { Bot, Radio, Volume2 } from 'lucide-react'
import type { CoachDockState } from '../../features/coach/coachDockState'
import { cn } from '../../lib/cn'
import { PrimaryFeedback } from './PrimaryFeedback'

export const STATIC_AI_COACH_ASSET = '/assets/overhead-raise-demo-start.png'

const statusTone: Record<CoachDockState['severity'], string> = {
  neutral: 'bg-slate-100 text-slate-600',
  info: 'bg-blue-50 text-blue-700',
  warning: 'bg-coral-50 text-coral-600',
  success: 'bg-emerald-50 text-emerald-700',
}

interface AICoachDockProps {
  state: CoachDockState
  metrics: ReactNode
}

export function AICoachDock({ state, metrics }: AICoachDockProps) {
  return (
    <section className="panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl" aria-labelledby="ai-coach-title" data-testid="ai-coach-dock" data-coach-state={state.visualState}>
      <div className="flex min-w-0 items-center gap-2 px-4 pt-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Bot size={18} /></span>
        <div className="min-w-0">
          <h2 id="ai-coach-title" className="truncate text-base font-bold text-slate-900">AI 教练</h2>
          <p className="truncate text-xs text-slate-500">正在观察 · {state.exerciseContext}</p>
        </div>
        <span className={cn('ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold', statusTone[state.severity])} data-testid="coach-status-label">
          <Radio size={12} aria-hidden="true" />{state.isSpeaking ? '语音指导中' : state.statusLabel}
        </span>
      </div>

      <div className="grid min-h-0 grid-cols-[minmax(108px,0.72fr)_minmax(0,1.28fr)] gap-3 px-4 py-3" data-testid="static-ai-coach-slot">
        <div className="relative min-h-[152px] overflow-hidden rounded-2xl bg-slate-100" data-testid="coach-identity">
          <img
            src={STATIC_AI_COACH_ASSET}
            alt="FormPilot AI 教练示范站姿"
            className="size-full object-contain object-bottom"
            draggable={false}
          />
          <span className="absolute bottom-2 left-2 rounded-lg bg-white/95 px-2 py-1 text-xs font-semibold text-slate-700 shadow-sm">静态教练</span>
        </div>
        <div className="flex min-w-0 flex-col justify-center">
          <p className="text-xs font-semibold text-blue-600">教练指导</p>
          <p className="mt-2 text-pretty text-lg font-bold leading-7 text-slate-900" data-testid="coach-primary-message">{state.primaryMessage}</p>
          {state.isSpeaking && state.currentSpokenMessage ? (
            <div className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-800" role="status" aria-live="polite" data-testid="coach-spoken-message">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-600"><Volume2 size={14} aria-hidden="true" />正在说话</p>
              <p className="mt-1 text-pretty leading-5">{state.currentSpokenMessage}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="px-4 pb-3" data-testid="realtime-feedback-slot">
        <PrimaryFeedback state={state} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 p-3" data-testid="detailed-metrics">
        {metrics}
      </div>
    </section>
  )
}
