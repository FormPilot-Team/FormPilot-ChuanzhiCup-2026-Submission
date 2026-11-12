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

/**
 * The chapter rail of the immersive follow-along (Web V1.1, C2): time left in this chapter and the next chapter, the
 * routine as one segmented bar (width = chapter length; tap a chapter to jump when allowed), and the voice / pause /
 * end controls. Same props, behaviour and test hooks as before; only the presentation changed.
 */
export function RoutineFooter({
  program, chapters, chapter, elapsedSeconds, totalSeconds, paused, canControl, canJump, finished = false, voiceEnabled, voiceAvailable,
  onSelectChapter, onPause, onToggleVoice, onEnd,
}: RoutineFooterProps) {
  const accent = ROUTINE_ACCENT[program.accent]
  const progress = totalSeconds > 0 ? Math.min(1, Math.max(0, elapsedSeconds / totalSeconds)) : 0
  const currentIndex = chapters.indexOf(chapter)
  const next = currentIndex >= 0 && !finished ? chapters[currentIndex + 1] : undefined
  const done = finished ? chapters.length : Math.max(0, currentIndex)
  const chapterLength = Math.max(0, chapter.endSeconds - chapter.startSeconds)
  const scopeStart = chapters[0]?.startSeconds ?? 0
  const chapterElapsed = Math.min(chapterLength, Math.max(0, scopeStart + elapsedSeconds - chapter.startSeconds))
  return (
    <section className="imm-rail" aria-label="训练控制" data-testid="routine-footer">
      <div className="min-w-0" data-testid="routine-next-chapter">
        <p className="text-xs text-slate-400">
          <span data-testid="routine-current-chapter" className="font-semibold text-slate-200">{chapterDisplayName(chapter)}</span>
          {!finished ? <> · 本段剩余 <b className="tabular-nums text-white">{formatClock(Math.max(0, chapterLength - chapterElapsed))}</b></> : null}
        </p>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-sm font-bold text-white" title={next ? chapterDisplayName(next) : undefined}>
          <SkipForward size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
          <span className="truncate">{next ? `下一段 · ${chapterDisplayName(next)}` : finished ? '全部段落已完成' : chapters.length === 1 ? '单独练习本段' : '这是最后一段'}</span>
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-slate-400"><span data-testid="routine-chapters-done">已完成 {done} / {chapters.length} 段</span> · <span data-testid="routine-elapsed">{formatClock(elapsedSeconds)} / {formatClock(totalSeconds)}</span></p>
      </div>

      <div className="min-w-0">
        <div className="sr-only" role="progressbar" aria-label="整体跟练进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} />
        <ol className="flex min-w-0 gap-1" aria-label={`${program.title}动作段落`} data-testid="routine-ribbon">
          {chapters.map((item, index) => {
            const current = item.id === chapter.id
            const itemDone = finished || index < currentIndex
            const length = Math.max(1, item.endSeconds - item.startSeconds)
            const share = current && chapterLength > 0 ? chapterElapsed / chapterLength : 0
            return (
              <li key={item.id} className="min-w-0" style={{ flex: `${length} 1 0%` }}>
                <button
                  type="button"
                  onClick={() => onSelectChapter(item.id)}
                  disabled={!canJump || current}
                  aria-current={current ? 'step' : undefined}
                  aria-label={`${canJump && !current ? '跳到' : ''}${chapterDisplayName(item)}`}
                  title={chapterDisplayName(item)}
                  className={cn('group block w-full min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-default', canJump && !current && 'cursor-pointer')}
                  data-testid={`routine-step-${item.id}`}
                  data-step-state={current ? 'current' : itemDone ? 'done' : 'todo'}
                >
                  <span className={cn('relative block h-2.5 overflow-hidden rounded-md', itemDone ? 'bg-[#91e6d2]' : current ? 'bg-sky-300/30' : 'bg-white/[0.13]', canJump && !current && 'group-hover:bg-white/25')} aria-hidden="true">
                    {current ? <span className={cn('absolute inset-y-0 left-0 rounded-md', accent.fill)} style={{ width: `${share * 100}%` }} /> : null}
                  </span>
                  <span className={cn('imm-hide-sm mt-1.5 flex min-w-0 items-center gap-1 truncate text-[11px]', current ? 'font-bold text-white' : 'text-slate-400')}>
                    {itemDone && !current ? <Check size={11} className="shrink-0" aria-hidden="true" /> : null}
                    <span className="truncate">{stepMark(item)}{item.kind === 'form' ? ` ${item.name.slice(0, 4)}` : ''}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="flex items-center justify-center gap-3 lg:justify-end">
        <button type="button" onClick={onToggleVoice} disabled={!voiceAvailable} aria-pressed={!voiceEnabled} aria-label={voiceAvailable ? voiceEnabled ? '静音' : '开启语音' : '语音不可用'} title={voiceAvailable ? voiceEnabled ? '语音提示已开启' : '语音提示已关闭' : '语音不可用'} className="imm-round">
          {voiceEnabled && voiceAvailable ? <Volume2 size={19} aria-hidden="true" /> : <VolumeX size={19} aria-hidden="true" />}
        </button>
        <button type="button" onClick={onPause} disabled={!canControl} aria-label={paused ? '继续训练' : '暂停训练'} className="imm-round imm-round-main">
          {paused ? <Play size={22} fill="currentColor" aria-hidden="true" /> : <Pause size={22} fill="currentColor" aria-hidden="true" />}
        </button>
        <AlertDialog.Root>
          <AlertDialog.Trigger asChild><button type="button" disabled={!canControl} aria-label="结束训练" className="imm-round"><Square size={17} fill="currentColor" aria-hidden="true" /></button></AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-950/50" />
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
