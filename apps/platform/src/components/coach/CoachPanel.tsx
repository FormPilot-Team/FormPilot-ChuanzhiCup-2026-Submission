import { memo, useEffect, useMemo, useState } from 'react'
import { Bot, CircleCheck, Dumbbell, Pause } from 'lucide-react'
import type { ReferencePose } from '../../features/referencePose/types'
import { validateCoachAsset } from '../../features/referencePose/coachAssetValidation'
import type { CoachCardViewModel } from '../../features/coach/types'
import { cn } from '../../lib/cn'
import { ReferencePoseOverlay } from '../pose/ReferencePoseOverlay'
import { CoachHighlightOverlay } from './CoachHighlightOverlay'
import { CoachMotion } from './CoachMotion'
import { coachMotionMode } from '../../features/coach/coachMotionPolicy'

interface CoachPanelProps {
  viewModel: CoachCardViewModel
  showReferenceSkeleton: boolean
}

const stateTone: Record<CoachCardViewModel['state'], string> = {
  PREPARING: 'bg-slate-100 text-slate-600',
  ACTIVE: 'bg-blue-50 text-blue-600',
  CORRECTING: 'bg-coral-50 text-coral-600',
  POSITIVE: 'bg-emerald-50 text-emerald-700',
  TRANSITION: 'bg-blue-50 text-emerald-700',
}

export const CoachPanel = memo(function CoachPanel({ viewModel, showReferenceSkeleton }: CoachPanelProps) {
  const [referencePose, setReferencePose] = useState<ReferencePose>()
  const frame = viewModel.coachAsset
  const referenceProfile = viewModel.referenceProfile
  const canonicalPose = referenceProfile.canonicalPoses.find((pose) => pose.id === frame.canonicalPoseId)
  const assetAcceptance = referenceProfile.coachAssetAcceptance.find((item) => item.canonicalPoseId === frame.canonicalPoseId)
  const validation = useMemo(() => {
    if (!referencePose || !assetAcceptance?.detectability) return undefined
    return validateCoachAsset(referencePose, assetAcceptance)
  }, [assetAcceptance, referencePose])
  const motionMode = coachMotionMode(viewModel.state, viewModel.paused)

  useEffect(() => {
    const controller = new AbortController()
    setReferencePose(undefined)
    fetch(frame.poseAnchorSrc, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Reference pose request failed: ${response.status}`)
        return response.json() as Promise<ReferencePose>
      })
      .then(setReferencePose)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setReferencePose(undefined)
      })
    return () => controller.abort()
  }, [frame.poseAnchorSrc])

  return (
    <section className="panel flex min-h-0 min-w-0 flex-col overflow-hidden" aria-labelledby="coach-title" data-coach-state={viewModel.state}>
      <div className="flex items-center gap-2 px-5 pt-5">
        <span className="grid size-8 place-items-center rounded-xl bg-blue-50 text-blue-600"><Bot size={18} /></span>
        <h2 id="coach-title" className="text-balance text-base font-bold text-slate-900">AI 教练</h2>
        <span className={cn('ml-1 rounded-lg px-2 py-1 text-xs font-semibold', stateTone[viewModel.state])} data-testid="coach-status-label">{viewModel.statusLabel}</span>
      </div>

      <div className="relative mx-4 mt-3 min-h-[320px] min-w-0 flex-1 overflow-hidden rounded-2xl bg-[#f6f9fd]">
        <CoachMotion frame={frame} mode={motionMode} />
        <CoachHighlightOverlay pose={referencePose} region={viewModel.highlightRegion} direction={viewModel.direction} />
        {showReferenceSkeleton && referencePose ? <ReferencePoseOverlay detectedPose={referencePose} canonicalPose={canonicalPose} /> : null}

        {viewModel.countdown ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-900/10" aria-label={`倒计时 ${viewModel.countdown}`} data-testid="coach-countdown">
            <span className="grid size-20 place-items-center rounded-full bg-white/95 text-4xl font-bold tabular-nums text-blue-600 shadow-sm">{viewModel.countdown}</span>
          </div>
        ) : null}

        {viewModel.state === 'POSITIVE' ? (
          <span className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white text-emerald-600 shadow-sm" aria-hidden="true" data-testid="coach-positive-check"><CircleCheck size={25} /></span>
        ) : null}

        {viewModel.paused ? (
          <div className="absolute inset-0 grid place-items-center bg-white/70" data-testid="coach-paused-overlay">
            <p className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"><Pause size={16} />训练已暂停</p>
          </div>
        ) : null}

        {showReferenceSkeleton ? (
          <div className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-lg bg-slate-950/90 px-3 py-2 font-mono text-xs text-white shadow-sm" data-testid="coach-validation-debug">
            <p className="font-semibold">{frame.canonicalPoseId}</p>
            {referencePose ? <p className="mt-1 text-pretty text-sky-300">Detected · solid</p> : <p className="mt-1 text-pretty text-slate-300">Anchor unavailable · text fallback active</p>}
            {canonicalPose?.landmarks ? <p className="text-pretty text-orange-300">Canonical · dashed</p> : null}
            {validation ? (
              <p className={cn('mt-1 tabular-nums', validation.detectable && validation.canonicalSimilarityPassed ? 'text-emerald-300' : 'text-rose-300')}>
                Detectable {validation.detectable ? 'PASS' : 'FAIL'} · Similarity {validation.canonicalSimilarityPassed ? 'PASS' : 'FAIL'}
                {validation.failedChecks.length ? ` · ${validation.failedChecks.map((item) => item.check).join(', ')}` : ''}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className={cn('absolute inset-x-4 bottom-4 rounded-2xl bg-white/95 px-4 py-3 shadow-sm', viewModel.state === 'CORRECTING' && 'border border-coral-500/40', viewModel.state === 'POSITIVE' && 'border border-emerald-400/50')}>
          <p key={viewModel.primaryMessage} className="line-clamp-2 text-pretty text-lg font-bold leading-7 text-slate-800" aria-live="polite" aria-atomic="true" data-testid="coach-primary-message">{viewModel.primaryMessage}</p>
          {viewModel.secondaryMessage ? <p className="mt-1 line-clamp-2 text-pretty text-xs leading-5 text-slate-600" data-testid="coach-secondary-message">{viewModel.secondaryMessage}</p> : null}
        </div>
      </div>

      <div className="m-4 mt-3 flex min-w-0 items-center rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Dumbbell size={21} /></span>
        <div className="ml-3 min-w-0">
          <p className="truncate font-bold text-slate-900">{viewModel.exerciseName}</p>
          <p className="truncate text-xs text-slate-500">标准动作参照</p>
        </div>
        <div className="ml-auto min-w-0 shrink-0 text-right">
          <p className="text-xl font-bold tabular-nums text-slate-900" data-testid="coach-target">{viewModel.target.label}</p>
          <p className="text-xs text-slate-500">{viewModel.target.type === 'duration' ? '按有效运动计时' : '按目标自动切换'}</p>
        </div>
      </div>
    </section>
  )
})
