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

export function TrainingFooter({ repCount, targetReps, targetType = 'reps', exerciseIndex, exerciseNames, currentName, nextName, sessionStatus, freeTraining = false, voiceEnabled, voiceAvailable, onPause, onToggleVoice, onEnd }: TrainingFooterProps) {
  const exerciseProgress = Math.min(1, repCount / targetReps)
  const progress = Math.round(((exerciseIndex + exerciseProgress) / exerciseNames.length) * 100)
  const unit = targetType === 'duration' ? '秒' : targetType === 'cycles' ? '组' : '次'
  return (
    <section className="panel grid min-w-0 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,280px)_minmax(0,300px)]" aria-label="训练控制">
      <div className="flex min-w-0 items-center gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-full border-[6px] border-blue-100 text-sm font-bold tabular-nums text-blue-600">{progress}%</div>
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-between gap-2"><p className="min-w-0 truncate text-sm font-semibold text-slate-800">训练进度 · {currentName}</p><p className="shrink-0 text-xs tabular-nums text-slate-500">完成 {repCount} / {targetReps} {unit}</p></div>
          {freeTraining ? <p className="text-pretty text-xs text-slate-500">自由训练 · 单个动作，达到目标后自动保存</p> : <div className="grid min-w-0 grid-cols-3 gap-x-2 gap-y-2 sm:grid-cols-6">
            {exerciseNames.map((label, index) => {
              const complete = index < exerciseIndex
              const active = index === exerciseIndex
              return (
                <div key={label} className="flex min-w-0 items-center">
                  <span className={complete || active ? 'grid size-7 shrink-0 place-items-center rounded-full bg-emerald-400 text-xs font-semibold text-white' : 'grid size-7 shrink-0 place-items-center rounded-full bg-slate-200 text-xs text-slate-500'}>{complete ? <Check size={14} /> : index + 1}</span>
                  <span className="ml-2 hidden min-w-0 truncate text-xs text-slate-600 sm:inline">{label}</span>
                </div>
              )
            })}
          </div>}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><SkipForward size={20} /></span>
        <div className="min-w-0"><p className="text-xs text-slate-500">{freeTraining ? '自由训练' : nextName ? '下一动作' : '本次训练'}</p><p className="truncate font-bold text-slate-900">{freeTraining ? currentName : nextName ?? '完成全部动作'}</p><p className="text-xs text-slate-500">{freeTraining ? '达到目标后自动保存' : nextName ? '完成当前次数后自动切换' : '可以结束并保存'}</p></div>
      </div>
      <div className="flex items-center justify-center gap-4">
        <button type="button" onClick={onToggleVoice} disabled={!voiceAvailable} aria-pressed={!voiceEnabled} aria-label={voiceAvailable ? voiceEnabled ? '静音' : '开启语音' : '语音不可用'} className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-100 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
          {voiceEnabled && voiceAvailable ? <Volume2 size={19} /> : <VolumeX size={19} />}
          {voiceAvailable ? voiceEnabled ? '语音' : '静音' : '语音不可用'}
        </button>
        <button type="button" onClick={onPause} aria-label={sessionStatus === 'paused' ? '继续训练' : '暂停训练'} className="grid size-14 place-items-center rounded-full bg-blue-500 text-white shadow-sm hover:bg-blue-600">
          {sessionStatus === 'paused' ? <Play size={22} fill="currentColor" /> : <Pause size={22} fill="currentColor" />}
        </button>
        <AlertDialog.Root>
          <AlertDialog.Trigger asChild><button type="button" aria-label="结束训练" className="grid size-14 place-items-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"><Square size={18} fill="currentColor" /></button></AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
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
