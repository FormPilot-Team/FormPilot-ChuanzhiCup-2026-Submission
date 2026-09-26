import type { RefObject } from 'react'
import { CircleAlert, Clapperboard, LoaderCircle, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import type { CourseSnapshot } from '../../features/course/CourseController'
import { chapterDisplayName, formatClock } from '../../features/routines/scope'
import type { RoutineChapter, RoutineProgram } from '../../features/routines/types'
import { cn } from '../../lib/cn'
import { ROUTINE_ACCENT } from './routineTheme'

interface RoutineVideoStageProps {
  program: RoutineProgram
  chapter: RoutineChapter
  stageRef: RefObject<HTMLVideoElement | null>
  stageStatus: 'loading' | 'ready' | 'error'
  stageTime: number
  course: CourseSnapshot
  manuallyPaused: boolean
  videoMuted: boolean
  onToggleSound: () => void
  onMetadata: () => void
  onError: () => void
}

function playbackLabel(course: CourseSnapshot, manuallyPaused: boolean): string {
  if (course.state === 'ACTIVE') return '示范播放中'
  if (course.state === 'PAUSED') return manuallyPaused ? '已暂停' : '等待回到画面'
  if (course.state === 'COUNTDOWN') return '即将开始'
  if (course.state === 'TRANSITION' || course.state === 'COURSE_COMPLETE') return '跟练完成'
  if (course.state === 'COURSE_INCOMPLETE') return '已结束'
  return '准备开始'
}

/**
 * The standard video as the main stage. It keeps the source's own proportions: a pillarboxed source (4:3 inside
 * 16:9) is shown at its picture's aspect with only the black bars cropped; nothing is stretched.
 */
export function RoutineVideoStage({
  program, chapter, stageRef, stageStatus, stageTime, course, manuallyPaused, videoMuted, onToggleSound, onMetadata, onError,
}: RoutineVideoStageProps) {
  const accent = ROUTINE_ACCENT[program.accent]
  const frameAspect = program.video.width / program.video.height
  const cropsBars = Math.abs(frameAspect - program.video.contentAspect) > 0.01
  const chapterLength = chapter.endSeconds - chapter.startSeconds
  const chapterElapsed = Math.min(chapterLength, Math.max(0, stageTime - chapter.startSeconds))
  const playing = course.state === 'ACTIVE'
  return (
    <section
      className="panel flex min-w-0 flex-col overflow-hidden p-3"
      aria-labelledby="routine-stage-title"
      data-testid="routine-stage"
      data-stage-status={stageStatus}
      data-stage-playing={playing ? 'true' : 'false'}
      data-stage-chapter={chapter.id}
    >
      <div className="flex min-h-12 min-w-0 items-center gap-2 px-2 pb-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Clapperboard size={18} aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 id="routine-stage-title" className="truncate font-bold text-slate-900">标准示范 · {program.title}</h2>
          <p className="truncate text-xs text-slate-500">视频含原声口令，跟着示范一起练</p>
        </div>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-600" data-testid="routine-stage-playback">
          {playing ? <Play size={14} fill="currentColor" aria-hidden="true" /> : <Pause size={14} fill="currentColor" aria-hidden="true" />}
          {playbackLabel(course, manuallyPaused)}
        </span>
      </div>

      <div className="relative w-full overflow-hidden rounded-2xl bg-slate-950" style={{ aspectRatio: String(program.video.contentAspect) }}>
        <video
          ref={stageRef}
          src={program.video.src}
          poster={program.video.posterSrc}
          className={cn('size-full', cropsBars ? 'object-cover' : 'object-contain')}
          playsInline
          preload="auto"
          aria-label={`${program.title}标准示范视频`}
          onLoadedMetadata={onMetadata}
          onLoadedData={onMetadata}
          onCanPlay={onMetadata}
          onError={onError}
          data-testid="routine-stage-video"
        />

        {stageStatus === 'loading' ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/70 text-center text-white" role="status">
            <div><LoaderCircle className="mx-auto animate-spin motion-reduce:animate-none" aria-hidden="true" /><p className="mt-3 text-sm">正在加载标准示范…</p></div>
          </div>
        ) : null}

        {stageStatus === 'error' ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-100 p-6 text-center" role="alert" data-testid="routine-stage-error">
            <div>
              <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-white text-coral-600 shadow-sm"><CircleAlert size={22} aria-hidden="true" /></span>
              <p className="mt-3 font-semibold text-slate-800">标准示范视频无法播放</p>
              <p className="mt-1 text-pretty text-sm text-slate-500">请刷新页面重试；视频不可用时无法开始跟练。</p>
            </div>
          </div>
        ) : null}

        {stageStatus === 'ready' && course.state === 'COUNTDOWN' ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/35" data-testid="routine-countdown">
            <span className="text-7xl font-bold tabular-nums text-white drop-shadow sm:text-8xl">{Math.max(1, course.countdown)}</span>
          </div>
        ) : null}

        {stageStatus === 'ready' && course.state === 'PAUSED' ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/35" data-testid="routine-stage-paused">
            <p className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm">
              <Pause size={16} aria-hidden="true" />{manuallyPaused ? '示范已暂停' : '已自动暂停，回到画面后继续'}
            </p>
          </div>
        ) : null}

        <span className={cn('absolute left-3 top-3 max-w-[70%] truncate rounded-lg px-2.5 py-1 text-xs font-semibold shadow-sm', accent.chip)} data-testid="routine-stage-chapter">
          {chapterDisplayName(chapter)}
        </span>
        <button
          type="button"
          onClick={onToggleSound}
          aria-pressed={!videoMuted}
          aria-label={videoMuted ? '开启视频原声' : '关闭视频原声'}
          className="absolute bottom-3 right-3 grid size-10 place-items-center rounded-full bg-slate-950/60 text-white hover:bg-slate-950/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          data-testid="routine-video-sound"
        >
          {videoMuted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
        </button>
      </div>

      <div className="mt-3 flex min-w-0 items-center gap-3 px-2 text-xs text-slate-500">
        <span className="shrink-0 font-semibold text-slate-700">本段</span>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <div className={cn('h-full rounded-full', accent.fill)} style={{ width: `${chapterLength > 0 ? (chapterElapsed / chapterLength) * 100 : 0}%` }} />
        </div>
        <span className="shrink-0 tabular-nums">{formatClock(chapterElapsed)} / {formatClock(chapterLength)}</span>
      </div>
    </section>
  )
}
