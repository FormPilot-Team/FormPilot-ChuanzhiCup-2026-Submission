import { Gauge } from 'lucide-react'
import { CoachAvatar } from '../coach/CoachAvatar'
import type { RoutineFeedbackTone } from '../../features/routines/followAlong/feedbackPolicy'
import type { FollowAlongMatch, FollowAlongRegion } from '../../features/routines/followAlong/matcher'
import { REGION_LABEL, SIMILARITY_BAND_LABEL, similarityBand } from '../../features/routines/report/routineReport'
import type { RoutineChapter } from '../../features/routines/types'
import { cn } from '../../lib/cn'

export type RoutineTrackingState = 'preparing' | 'normal' | 'adjust' | 'paused' | 'done'

interface RoutineFeedbackPanelProps {
  chapter: RoutineChapter
  match?: FollowAlongMatch
  trackingState: RoutineTrackingState
  coachMessage: string
  coachTone: RoutineFeedbackTone
  comparisonAvailable: boolean
}

const TRACKING: Readonly<Record<RoutineTrackingState, { label: string; tone: string }>> = {
  normal: { label: '识别正常', tone: 'bg-emerald-50 text-emerald-700' },
  adjust: { label: '请调整位置', tone: 'bg-coral-50 text-coral-600' },
  paused: { label: '训练暂停', tone: 'bg-slate-100 text-slate-600' },
  preparing: { label: '准备中', tone: 'bg-blue-50 text-blue-600' },
  done: { label: '已结束', tone: 'bg-slate-100 text-slate-600' },
}

const MESSAGE_TONE: Readonly<Record<RoutineFeedbackTone, string>> = {
  neutral: 'border-slate-200 bg-white',
  info: 'border-blue-100 bg-blue-50/60',
  success: 'border-emerald-200 bg-emerald-50/70',
  warning: 'border-coral-500/40 bg-coral-50',
}

function rhythmText(match?: FollowAlongMatch): string {
  if (!match || match.status === 'insufficient') return '识别中'
  const seconds = (Math.abs(match.timingOffsetMs) / 1000).toFixed(1)
  if (match.status === 'ahead') return `稍快 ${seconds} 秒`
  if (match.status === 'behind') return `稍慢 ${seconds} 秒`
  if (match.status === 'mismatch') return '动作差异较大'
  return '节奏同步'
}

const REGIONS: ReadonlyArray<FollowAlongRegion> = ['arms', 'torso', 'legs']

/** Live follow-along feedback: the AI Coach line, similarity to the standard video, rhythm and body regions. */
export function RoutineFeedbackPanel({ chapter, match, trackingState, coachMessage, coachTone, comparisonAvailable }: RoutineFeedbackPanelProps) {
  const measured = match && match.status !== 'insufficient'
  const similarity = measured ? Math.round(match.similarity * 100) : null
  const band = similarity === null ? null : similarityBand(similarity)
  const tracking = TRACKING[trackingState]
  return (
    <section className="panel flex min-h-0 min-w-0 flex-col gap-3 p-4 xl:flex-1" aria-labelledby="routine-feedback-title" data-testid="routine-feedback">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Gauge size={18} aria-hidden="true" /></span>
        <h2 id="routine-feedback-title" className="min-w-0 truncate font-bold text-slate-900">实时反馈</h2>
        <span className={cn('ml-auto shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold', tracking.tone)} data-testid="routine-tracking">{tracking.label}</span>
      </div>

      <div className={cn('flex min-w-0 items-start gap-3 rounded-2xl border p-3', MESSAGE_TONE[coachTone])} data-testid="routine-coach-entry" data-coach-tone={coachTone}>
        <CoachAvatar className="size-10" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-blue-700">AI 教练</p>
          <p className="mt-0.5 text-pretty text-sm font-semibold leading-6 text-slate-900" role="status" aria-live="polite" aria-atomic="true" data-testid="routine-coach-message">{coachMessage}</p>
          {coachMessage !== chapter.cue ? <p className="mt-1 line-clamp-2 text-pretty text-xs leading-5 text-slate-600" data-testid="routine-cue">要点：{chapter.cue}</p> : null}
        </div>
      </div>

      <div
        className="rounded-2xl border border-slate-100 bg-white p-3"
        data-testid="routine-similarity"
        data-match-status={match?.status ?? 'none'}
        data-match-similarity={similarity ?? ''}
        data-match-mirrored={match?.mirrored ? 'true' : 'false'}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <strong className="text-3xl font-bold tabular-nums leading-9 text-slate-950">{similarity === null ? '—' : `${similarity}%`}</strong>
          <span className="text-xs text-slate-500">跟练相似度</span>
          {band ? <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', band === 'high' ? 'bg-emerald-50 text-emerald-700' : band === 'fair' ? 'bg-blue-50 text-blue-700' : 'bg-coral-50 text-coral-600')}>{SIMILARITY_BAND_LABEL[band]}</span> : null}
          <span className="ml-auto text-xs font-semibold text-slate-700" data-testid="routine-rhythm">节奏：{comparisonAvailable ? rhythmText(match) : '暂不可比对'}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <div className={cn('h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none', band === 'low' ? 'bg-coral-500' : band === 'high' ? 'bg-emerald-500' : 'bg-blue-500')} style={{ width: `${similarity ?? 0}%` }} />
        </div>
        <dl className="mt-2 grid grid-cols-3 gap-2">
          {REGIONS.map((region) => {
            const score = measured && match.regionScores[region] !== null ? Math.round((match.regionScores[region] as number) * 100) : null
            return (
              <div key={region} className="flex min-w-0 items-baseline justify-between gap-1 rounded-xl bg-slate-50 px-2.5 py-1.5">
                <dt className="text-xs text-slate-500">{REGION_LABEL[region]}</dt>
                <dd className="text-sm font-bold tabular-nums text-slate-900">{score === null ? '—' : score}</dd>
              </div>
            )
          })}
        </dl>
      </div>
    </section>
  )
}
