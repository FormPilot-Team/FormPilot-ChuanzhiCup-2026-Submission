import { ArrowLeft, ArrowRight, Check, ClipboardList, MessageSquareText, ScanLine, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { ONBOARDING_STEPS, type OnboardingOutcome, type OnboardingStepId } from '../../features/onboarding/onboarding'
import { cn } from '../../lib/cn'
import { OnboardingIllustration } from './OnboardingIllustrations'

const WELCOME_ICONS = [ScanLine, MessageSquareText, Volume2, ClipboardList]

interface OnboardingStepsProps {
  initialIndex: number
  primaryRef: RefObject<HTMLButtonElement | null>
  onFinish: () => void
  onDismiss: () => void
}

function OnboardingSteps({ initialIndex, primaryRef, onFinish, onDismiss }: OnboardingStepsProps) {
  const [index, setIndex] = useState(initialIndex)
  const step = ONBOARDING_STEPS[index]
  const last = index === ONBOARDING_STEPS.length - 1
  return (
    <div className="flex flex-col" data-testid="onboarding-step" data-step={step.id}>
      <div className="flex items-center justify-between gap-3 px-5 pt-4 sm:px-7 sm:pt-5">
        <p className="text-sm font-semibold tabular-nums text-slate-500">
          使用说明<span aria-hidden="true"> · {index + 1} / {ONBOARDING_STEPS.length}</span>
          <span className="sr-only">，第 {index + 1} 步，共 {ONBOARDING_STEPS.length} 步</span>
        </p>
        <button type="button" onClick={onDismiss} aria-label="关闭使用说明" className="grid size-10 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="px-5 sm:px-7">
        <div className="mt-2 rounded-2xl bg-slate-50 px-6 py-2">
          <div className="mx-auto max-w-[300px]"><OnboardingIllustration stepId={step.id} /></div>
        </div>
        <div aria-live="polite">
          <h2 id="onboarding-title" className="mt-5 text-balance text-2xl font-bold text-slate-950">{step.title}</h2>
          <p id="onboarding-lead" className="mt-2 text-pretty text-base font-medium leading-7 text-slate-700">{step.lead}</p>
          <ul className={cn('mt-4', step.id === 'welcome' ? 'grid gap-2 sm:grid-cols-2' : 'space-y-2')}>
            {step.points.map((point, pointIndex) => {
              const Icon = step.id === 'welcome' ? WELCOME_ICONS[pointIndex] ?? Check : Check
              return (
                <li key={point} className={cn('flex items-start gap-2.5 text-pretty text-sm leading-6 text-slate-600', step.id === 'welcome' && 'rounded-xl bg-slate-50 px-3 py-2.5 font-semibold text-slate-700')}>
                  <Icon size={17} className="mt-[3px] shrink-0 text-blue-600" aria-hidden="true" />
                  {point}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 sm:px-7">
        {index === 0 ? (
          <button type="button" onClick={onDismiss} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">跳过</button>
        ) : (
          <button type="button" onClick={() => setIndex(index - 1)} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"><ArrowLeft size={16} aria-hidden="true" />上一步</button>
        )}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {ONBOARDING_STEPS.map((item, dotIndex) => <span key={item.id} className={cn('h-1.5 rounded-full transition-all duration-200 motion-reduce:transition-none', dotIndex === index ? 'w-5 bg-blue-600' : 'w-1.5 bg-slate-300')} />)}
        </div>
        <button ref={primaryRef} type="button" onClick={() => last ? onFinish() : setIndex(index + 1)} className="primary-button inline-flex items-center gap-1.5">
          {last ? '开始使用' : '下一步'}{last ? null : <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}

interface OnboardingDialogProps {
  open: boolean
  onClose: (outcome: OnboardingOutcome) => void
  /** Page to open on; the guide always starts from the welcome page unless a caller needs a specific topic. */
  initialStepId?: OnboardingStepId
}

/**
 * First-run guide in a native modal <dialog>: the browser provides the focus trap, the inert background, Escape and
 * focus restoration. Every way of closing it reports an outcome; only "开始使用" on the last page counts as completed.
 */
export function OnboardingDialog({ open, onClose, initialStepId = 'welcome' }: OnboardingDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const outcomeRef = useRef<OnboardingOutcome>('dismissed')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      outcomeRef.current = 'dismissed'
      dialog.showModal()
      primaryRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const close = (outcome: OnboardingOutcome) => {
    outcomeRef.current = outcome
    dialogRef.current?.close()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-lead"
      data-testid="onboarding-dialog"
      onClose={() => { if (open) onClose(outcomeRef.current) }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),520px)] overflow-y-auto rounded-3xl border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/45"
    >
      {open ? <OnboardingSteps initialIndex={Math.max(0, ONBOARDING_STEPS.findIndex((step) => step.id === initialStepId))} primaryRef={primaryRef} onFinish={() => close('completed')} onDismiss={() => close('dismissed')} /> : null}
    </dialog>
  )
}
