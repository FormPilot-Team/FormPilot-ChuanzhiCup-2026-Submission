import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { ArrowLeft } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import type { TrainingExitPhase } from '../../features/training/trainingExit'

interface TrainingExitControlProps {
  /** Where the user came from: the 热身训练 entry, or the routine's own page. */
  href: string
  /** Visible text, e.g. 返回热身训练. */
  label: string
  /** `preparing` (nothing started yet) and `complete` leave at once; `active` (running or paused) asks first. */
  phase: TrainingExitPhase
}

/** The one “← 返回 …” exit of every training page (热身训练 and the four follow-along routines). */
export function TrainingExitControl({ href, label, phase }: TrainingExitControlProps) {
  const [confirming, setConfirming] = useState(false)
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (phase !== 'active' || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    setConfirming(true)
  }
  return (
    <>
      <a
        href={href}
        onClick={onClick}
        className="mb-1 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-sm font-semibold text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        data-testid="training-exit"
        data-exit-phase={phase}
      >
        <ArrowLeft size={15} aria-hidden="true" />{label}
      </a>
      <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 shadow-xl" data-testid="training-exit-dialog">
            <AlertDialog.Title className="text-balance text-lg font-bold text-slate-900">退出训练？</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-pretty text-sm leading-6 text-slate-500">当前训练尚未完成，退出后本次进度不会继续保留。</AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-3">
              <AlertDialog.Cancel asChild><button type="button" className="secondary-button">继续训练</button></AlertDialog.Cancel>
              <AlertDialog.Action asChild><button type="button" onClick={() => window.location.assign(href)} className="danger-button">确认退出</button></AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  )
}
