import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { reportPath, trainingEntryPath } from '../../app/routes'
import { REPORT_EXERCISE_PRESENTATION } from '../../features/report/presentation'
import { resolveTrainingScope } from '../../features/training/trainingScope'
import type { TrainingSessionState } from '../../features/training/types'

interface SessionCompleteDialogProps {
  session: TrainingSessionState
  persistFailed: boolean
}

export function SessionCompleteDialog({ session, persistFailed }: SessionCompleteDialogProps) {
  if (session.status !== 'completed') return null
  const scope = resolveTrainingScope(session)
  const incomplete = session.courseStatus === 'incomplete'
  const status = scope.kind === 'free_training'
    ? incomplete ? '自由训练提前结束，已保存当前结果' : `${REPORT_EXERCISE_PRESENTATION[scope.exerciseId].name}自由训练已完成`
    : incomplete ? '课程提前结束，已保存未完成结果' : '课程动作已完成'
  return (
    <AlertDialog.Root open>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-30 bg-slate-900/20" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-40 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-8 text-center shadow-xl">
          <AlertDialog.Title className="text-balance text-2xl font-bold">本次训练已保存</AlertDialog.Title>
          <AlertDialog.Description className="mt-3 space-y-1 text-pretty text-sm text-slate-500">
            <span className="block font-semibold text-slate-800">{status}</span>
            <span className="mt-2 block">{scope.kind === 'free_training' ? '训练记录已准备好，可以进入报告查看本次动作表现与下一次建议。' : '训练记录已准备好，可以进入报告查看动作表现、能力汇总与下一次建议。'}</span>
            {persistFailed ? <span className="mt-2 block text-coral-600">本地保存失败，结果仅在本页有效。</span> : null}
          </AlertDialog.Description>
          <AlertDialog.Action asChild>
            <button type="button" onClick={() => window.location.assign(reportPath(session.id))} className="primary-button mt-6">查看训练报告</button>
          </AlertDialog.Action>
          <button type="button" onClick={() => window.location.assign(trainingEntryPath(scope))} className="secondary-button mt-3">重新训练</button>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
