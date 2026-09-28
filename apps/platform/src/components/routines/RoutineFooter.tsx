import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Check, Pause, Play, SkipForward, Square, Volume2, VolumeX } from 'lucide-react'
import { chapterDisplayName, formatClock } from '../../features/routines/scope'
import type { RoutineChapter, RoutineProgram } from '../../features/routines/types'
import { cn } from '../../lib/cn'
import { ROUTINE_ACCENT } from './routineTheme'

interface RoutineFooterProps {
  program: RoutineProgram
  chapters: ReadonlyArray<RoutineChapter>
  chapter: RoutineChapter
  elapsedSeconds: number
  totalSeconds: number
  paused: boolean
  canControl: boolean
  canJump: boolean
  /** The routine played to its end: every chapter counts as done. */
  finished?: boolean
  voiceEnabled: boolean
  voiceAvailable: boolean
  onSelectChapter: (chapterId: string) => void
  onPause: () => void
  onToggleVoice: () => void
  onEnd: () => void
}

function stepMark(chapter: RoutineChapter): string {
  if (chapter.kind === 'opening') return '起'
  if (chapter.kind === 'closing') return '收'
  return String(chapter.formNumber ?? chapter.index + 1)
}

/** Progress through the routine, the chapter ribbon, and the same pause / voice / end controls as Smart Training. */
export function RoutineFooter({
  program, chapters, chapter, elapsedSeconds, totalSeconds, paused, canControl, canJump, finished = false, voiceEnabled, voiceAvailable,
  onSelectChapter, onPause, onToggleVoice, onEnd,
}: RoutineFooterProps) {
  const accent = ROUTINE_ACCENT[program.accent]
  const progress = totalSeconds > 0 ? Math.min(1, Math.max(0, elapsedSeconds / totalSeconds)) : 0
  const currentIndex = chapters.indexOf(chapter)
  const next = currentIndex >= 0 && !finished ? chapters[currentIndex + 1] : undefined
  const done = finished ? chapters.length : Math.max(0, currentIndex)
  return (
    <section className="panel grid min-w-0 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,250px)_auto] lg:items-center" aria-label="训练控制" data-testid="routine-footer">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-semibold text-slate-800">跟练进度 · <span data-testid="routine-current-chapter">{chapterDisplayName(chapter)}</span></p>
          <p className="shrink-0 text-xs tabular-nums text-slate-500" data-testid="routine-elapsed">{formatClock(elapsedSeconds)} / {formatClock(totalSeconds)}</p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="整体跟练进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className={cn('h-full rounded-full', accent.fill)} style={{ width: `${progress * 100}%` }} />
        </div>
        <ol className="mt-3 flex min-w-0 gap-1.5 overflow-x-auto pb-1" aria-label={`${program.title}动作段落`} data-testid="routine-ribbon">
          {chapters.map((item, index) => {
            const current = item.id === chapter.id
            const done = index < currentIndex
            return (
              <li key={item.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onSelectChapter(item.id)}
                  disabled={!canJump || current}
                  aria-current={current ? 'step' : undefined}
                  aria-label={`${canJump && !current ? '跳到' : ''}${chapterDisplayName(item)}`}
                  title={chapterDisplayName(item)}
                  className={cn(
                    'grid h-8 min-w-8 place-items-center rounded-full border px-2 text-xs font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default',
                    current ? accent.step : done ? 'border-slate-200 bg-slate-100 text-slate-600' : 'border-slate-200 bg-white text-slate-600',
                    canJump && !current && 'hover:border-blue-300 hover:text-blue-700',
                  )}
                  data-testid={`routine-step-${item.id}`}
                >
                  {done ? <Check size={14} aria-hidden="true" /> : stepMark(item)}
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3" data-testid="routine-next-chapter">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', accent.soft, accent.text)}><SkipForward size={20} aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{next ? '下一段' : '本次跟练'}</p>
          <p className="truncate font-bold text-slate-900" title={next ? chapterDisplayName(next) : undefined}>{next ? chapterDisplayName(next) : finished ? '全部段落已完成' : chapters.length === 1 ? '单独练习本段' : '这是最后一段'}</p>
          <p className="text-xs tabular-nums text-slate-500" data-testid="routine-chapters-done">已完成 {done} / {chapters.length} 段</p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button type="button" onClick={onToggleVoice} disabled={!voiceAvailable} aria-pressed={!voiceEnabled} aria-label={voiceAvailable ? voiceEnabled ? '静音' : '开启语音' : '语音不可用'} className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-100 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
          {voiceEnabled && voiceAvailable ? <Volume2 size={19} aria-hidden="true" /> : <VolumeX size={19} aria-hidden="true" />}
          {voiceAvailable ? voiceEnabled ? '语音' : '静音' : '语音不可用'}
        </button>
        <button type="button" onClick={onPause} disabled={!canControl} aria-label={paused ? '继续训练' : '暂停训练'} className="grid size-14 place-items-center rounded-full bg-blue-500 text-white shadow-sm hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50">
          {paused ? <Play size={22} fill="currentColor" aria-hidden="true" /> : <Pause size={22} fill="currentColor" aria-hidden="true" />}
        </button>
        <AlertDialog.Root>
          <AlertDialog.Trigger asChild><button type="button" disabled={!canControl} aria-label="结束训练" className="grid size-14 place-items-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"><Square size={18} fill="currentColor" aria-hidden="true" /></button></AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 shadow-xl">
              <AlertDialog.Title className="text-balance text-lg font-bold text-slate-900">确认结束本次跟练？</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-pretty text-sm leading-6 text-slate-500">当前正在进行 {chapterDisplayName(chapter)}，已跟练 {formatClock(elapsedSeconds)}。结束后会保存已完成的部分，并标记为未完成。</AlertDialog.Description>
              <div className="mt-6 flex justify-end gap-3"><AlertDialog.Cancel asChild><button type="button" className="secondary-button">继续训练</button></AlertDialog.Cancel><AlertDialog.Action asChild><button type="button" onClick={onEnd} className="danger-button">结束并保存</button></AlertDialog.Action></div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </section>
  )
}
