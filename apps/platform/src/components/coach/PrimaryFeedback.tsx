import { CircleCheck, CirclePause, MoveRight, ScanSearch, TriangleAlert } from 'lucide-react'
import type { CoachDockState } from '../../features/coach/coachDockState'
import { cn } from '../../lib/cn'

const presentation = {
  correcting: { title: '优先调整', detail: '按这条提示修正当前动作', icon: TriangleAlert, tone: 'border-coral-500/40 bg-coral-50 text-coral-600' },
  recovery: { title: '动作正确', detail: '刚才的问题已恢复，继续保持', icon: CircleCheck, tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  paused: { title: '训练暂停', detail: '检测已暂停，不会记录当前动作', icon: CirclePause, tone: 'border-slate-200 bg-slate-50 text-slate-600' },
  transition: { title: '动作完成', detail: '跟随教练准备下一项', icon: MoveRight, tone: 'border-blue-200 bg-blue-50 text-blue-700' },
  complete: { title: '训练结束', detail: '本次训练记录已停止', icon: CircleCheck, tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  preparing: { title: '等待识别', detail: '保持全身在镜头中', icon: ScanSearch, tone: 'border-blue-200 bg-blue-50 text-blue-700' },
  ready: { title: '动作就绪', detail: '保持位置，训练即将开始', icon: CircleCheck, tone: 'border-blue-200 bg-blue-50 text-blue-700' },
  active: { title: '动作正确', detail: '未发现需要优先纠正的问题', icon: CircleCheck, tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
} satisfies Record<CoachDockState['visualState'], { title: string; detail: string; icon: typeof CircleCheck; tone: string }>

export function PrimaryFeedback({ state }: { state: CoachDockState }) {
  const item = presentation[state.visualState]
  const Icon = item.icon

  return (
    <section className={cn('rounded-2xl border p-3', item.tone)} aria-labelledby="primary-feedback-title" data-testid="primary-feedback" data-feedback-state={state.visualState}>
      <div className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/80" aria-hidden="true"><Icon size={18} /></span>
        <div className="min-w-0">
          <h3 id="primary-feedback-title" className="text-sm font-bold">{item.title}</h3>
          <p className="text-pretty text-xs leading-5 opacity-80">{item.detail}</p>
        </div>
      </div>
      <p className="mt-2 text-pretty text-base font-bold leading-6 text-slate-900" aria-live="polite" aria-atomic="true" data-testid="primary-feedback-message">
        {state.primaryMessage}
      </p>
    </section>
  )
}
