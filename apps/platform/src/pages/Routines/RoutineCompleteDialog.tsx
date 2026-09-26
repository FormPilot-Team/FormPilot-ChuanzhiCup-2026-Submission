import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { reportPath, routinePath, routineTrainingPath } from '../../app/routes'
import { scopeTitle } from '../../features/routines/scope'
import type { RoutineProgram, RoutineScope } from '../../features/routines/types'
import type { RoutineCompletion } from './useRoutineRuntime'

interface RoutineCompleteDialogProps {
  completion?: RoutineCompletion
  program: RoutineProgram
  scope: RoutineScope
}

export function RoutineCompleteDialog({ completion, program, scope }: RoutineCompleteDialogProps) {
  if (!completion) return null
  const started = completion.recordId !== null
  const title = !started ? '本次跟练还没有开始' : completion.saved ? '本次跟练已保存' : '本次跟练未能保存'
  const status = !started
    ? '还没有开始跟练，因此没有生成记录。'
    : completion.outcome === 'completed' ? `${scopeTitle(program, scope)}已完成` : '跟练提前结束，已保存已完成的部分'
  const again = routineTrainingPath(program.id, scope.kind === 'form' ? scope.chapterId : undefined)
  return (
    <AlertDialog.Root open>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-30 bg-slate-900/20" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-40 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-8 text-center shadow-xl" data-testid="routine-complete-dialog" data-outcome={completion.outcome}>
          <AlertDialog.Title className="text-balance text-2xl font-bold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-3 space-y-1 text-pretty text-sm text-slate-500">
            <span className="block font-semibold text-slate-800">{status}</span>
            {started ? <span className="mt-2 block">跟练报告已准备好，可以查看每段的完成度、跟练相似度与节奏。</span> : null}
            {started && !completion.saved ? <span className="mt-2 block text-coral-600">本地保存失败，结果仅在本页有效。</span> : null}
          </AlertDialog.Description>
          {started && completion.saved && completion.recordId ? (
            <AlertDialog.Action asChild>
              <button type="button" onClick={() => window.location.assign(reportPath(completion.recordId as string))} className="primary-button mt-6">查看跟练报告</button>
            </AlertDialog.Action>
          ) : null}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" onClick={() => window.location.assign(again)} className="secondary-button">再练一次</button>
            <button type="button" onClick={() => window.location.assign(routinePath(program.id))} className="secondary-button">返回{program.title}</button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
