import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Check, Pause, Play, SkipForward, Square, Volume2, VolumeX } from 'lucide-react'
import type { TrainingSessionState } from '../../features/training/types'

interface TrainingFooterProps {
  repCount: number
  targetReps: number
  targetType?: 'duration' | 'reps' | 'cycles'
  exerciseIndex: number
  exerciseNames: string[]
  currentName: string
  nextName?: string
  sessionStatus: TrainingSessionState['status']
  /** One exercise chosen on the smart-training page instead of the six-step course. */
  freeTraining?: boolean
  voiceEnabled: boolean
  voiceAvailable: boolean
  onPause: () => void
  onToggleVoice: () => void
  onEnd: () => void
}

/**
 * Warm-up rail (Web V1.1, C3): the course's steps (done / now / next), the next exercise, and the voice / pause / end
 * controls on the dark training shell. Same props and behaviour as before; only the presentation changed.
 */
export function TrainingFooter({ repCount, targetReps, targetType = 'reps', exerciseIndex, exerciseNames, currentName, nextName, sessionStatus, freeTraining = false, voiceEnabled, voiceAvailable, onPause, onToggleVoice, onEnd }: TrainingFooterProps) {
  const exerciseProgress = Math.min(1, repCount / targetReps)
  const progress = Math.round(((exerciseIndex + exerciseProgress) / exerciseNames.length) * 100)
  const unit = targetType === 'duration' ? '秒' : targetType === 'cycles' ? '组' : '次'
  return (
    <section className="imm-rail" aria-label="训练控制" data-testid="training-footer">
      <div className="min-w-0">
        <p className="text-xs text-slate-400">{freeTraining ? '自由训练 · 单个动作' : `完整训练 · ${exerciseNames.length} 项`} · <span className="tabular-nums">整体 {progress}%</span></p>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-sm font-bold text-white">
          <SkipForward size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
          <span className="truncate">{freeTraining ? `${currentName} · 达到目标后自动保存` : nextName ? `下一项 · ${nextName}` : '最后一项 · 完成后可结束并保存'}</span>
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-slate-400">当前 {currentName} · 完成 {repCount} / {targetReps} {unit}</p>
      </div>
      <div className="min-w-0">
        {freeTraining ? (
          <div className="h-2.5 overflow-hidden rounded-md bg-white/[0.13]" role="progressbar" aria-label="本动作进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(exerciseProgress * 100)}>
            <div className="h-full rounded-md bg-sky-300" style={{ width: `${exerciseProgress * 100}%` }} />
          </div>
        ) : (
          <ol className="flex min-w-0 gap-1.5" aria-label="训练项目" data-testid="training-steps">
            {exerciseNames.map((label, index) => {
              const complete = index < exerciseIndex
              const active = index === exerciseIndex
              return (
                <li key={label} className={complete ? 'flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg bg-[#91e6d2]/20 px-1 text-[11px] font-semibold text-[#91e6d2]' : active ? 'flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg bg-sky-300/25 px-1 text-[11px] font-bold text-white ring-1 ring-sky-300/60' : 'flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg bg-white/[0.06] px-1 text-[11px] text-slate-400'} aria-current={active ? 'step' : undefined}>
                  {complete ? <Check size={12} className="shrink-0" aria-hidden="true" /> : <span className="shrink-0 tabular-nums">{index + 1}</span>}
                  <span className="imm-hide-sm min-w-0 truncate">{label}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
      <div className="flex items-center justify-center gap-3 lg:justify-end">
        <button type="button" onClick={onToggleVoice} disabled={!voiceAvailable} aria-pressed={!voiceEnabled} aria-label={voiceAvailable ? voiceEnabled ? '静音' : '开启语音' : '语音不可用'} title={voiceAvailable ? voiceEnabled ? '语音提示已开启' : '语音提示已关闭' : '语音不可用'} className="imm-round">
          {voiceEnabled && voiceAvailable ? <Volume2 size={19} aria-hidden="true" /> : <VolumeX size={19} aria-hidden="true" />}
        </button>
        <button type="button" onClick={onPause} aria-label={sessionStatus === 'paused' ? '继续训练' : '暂停训练'} className="imm-round imm-round-main">
          {sessionStatus === 'paused' ? <Play size={22} fill="currentColor" aria-hidden="true" /> : <Pause size={22} fill="currentColor" aria-hidden="true" />}
        </button>
        <AlertDialog.Root>
          <AlertDialog.Trigger asChild><button type="button" aria-label="结束训练" className="imm-round"><Square size={17} fill="currentColor" aria-hidden="true" /></button></AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-950/50" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 shadow-xl">
              <AlertDialog.Title className="text-balance text-lg font-bold text-slate-900">确认结束本次训练？</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-pretty text-sm leading-6 text-slate-500">当前正在进行 {currentName}，已完成 {repCount} {unit}。{freeTraining ? '结束后会保存当前结果，本次自由训练记为未完成。' : '结束后会将课程标记为未完成并保存当前结果。'}</AlertDialog.Description>
              <div className="mt-6 flex justify-end gap-3"><AlertDialog.Cancel asChild><button type="button" className="secondary-button">继续训练</button></AlertDialog.Cancel><AlertDialog.Action asChild><button type="button" onClick={onEnd} className="danger-button">结束并保存</button></AlertDialog.Action></div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </section>
  )
}
