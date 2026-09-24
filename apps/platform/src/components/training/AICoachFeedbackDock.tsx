import type { ReactNode } from 'react'

interface AICoachFeedbackDockProps {
  coachSlot: ReactNode
  feedbackSlot: ReactNode
}

export function AICoachFeedbackDock({ coachSlot, feedbackSlot }: AICoachFeedbackDockProps) {
  return (
    <aside className="grid min-h-0 min-w-0 gap-3 overflow-y-auto xl:grid-rows-[minmax(300px,0.9fr)_minmax(330px,1.1fr)]" aria-label="AI Coach 与实时反馈" data-testid="ai-coach-feedback-dock">
      <div className="min-h-[300px] min-w-0 xl:min-h-0" aria-label="Static AI Coach 预留插槽" data-testid="static-ai-coach-slot">
        {coachSlot}
      </div>
      <div className="min-h-[330px] min-w-0 xl:min-h-0" aria-label="实时反馈插槽" data-testid="realtime-feedback-slot">
        {feedbackSlot}
      </div>
    </aside>
  )
}
