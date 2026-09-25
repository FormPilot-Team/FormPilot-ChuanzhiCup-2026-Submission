import type { ReactNode } from 'react'
import type { CoachDockState } from '../../features/coach/coachDockState'
import { AICoachDock } from '../coach/AICoachDock'

interface AICoachFeedbackDockProps {
  state: CoachDockState
  metrics: ReactNode
}

export function AICoachFeedbackDock({ state, metrics }: AICoachFeedbackDockProps) {
  return (
    <aside className="min-h-[600px] min-w-0 xl:min-h-0" aria-label="AI Coach 与实时反馈" data-testid="ai-coach-feedback-dock">
      <AICoachDock state={state} metrics={metrics} />
    </aside>
  )
}
