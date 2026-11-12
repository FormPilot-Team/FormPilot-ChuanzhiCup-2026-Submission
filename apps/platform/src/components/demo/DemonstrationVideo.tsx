import { CircleAlert, Clapperboard, LoaderCircle, Pause, Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CourseSnapshot } from '../../features/course/CourseController'
import {
  getDemonstrationSource,
  resolveDemonstrationDirective,
  type DemonstrationPlayback,
} from '../../features/demo/demonstrationSources'
import type { ExerciseId } from '../../features/exercises/types'

interface DemonstrationVideoProps {
  currentExerciseId: ExerciseId
  nextExerciseId?: ExerciseId
  courseSnapshot: CourseSnapshot
  /** `compact`: the small demonstration window of the immersive warm-up (Web V1.1 C3). */
  variant?: 'panel' | 'compact'
}

type MediaStatus = 'loading' | 'ready' | 'unavailable' | 'error'

function playbackLabel(playback: DemonstrationPlayback): string {
  if (playback === 'playing') return '标准动作播放中'
  if (playback === 'paused') return '训练已暂停'
  if (playback === 'stopped') return '训练已结束'
  return '标准动作预览'
}

export function DemonstrationVideo({ currentExerciseId, nextExerciseId, courseSnapshot, variant = 'panel' }: DemonstrationVideoProps) {
  const compact = variant === 'compact'
  const videoRef = useRef<HTMLVideoElement>(null)
  const directive = useMemo(
    () => resolveDemonstrationDirective(courseSnapshot, currentExerciseId, nextExerciseId),
    [courseSnapshot, currentExerciseId, nextExerciseId],
  )
  const source = getDemonstrationSource(directive.exerciseId)
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>(source ? 'loading' : 'unavailable')

  useEffect(() => {
    const video = videoRef.current
    setMediaStatus(source ? 'loading' : 'unavailable')
    if (!video || !source) return
    video.pause()
    video.currentTime = 0
    video.load()
  }, [source])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !source) return

    if (directive.playback === 'playing') {
      video.loop = true
      void video.play().catch(() => setMediaStatus('error'))
      return
    }

    video.pause()
    if (directive.playback === 'stopped') video.currentTime = 0
  }, [directive.playback, source])

  return (
    <section
      className={compact ? 'imm-panel' : 'panel flex min-h-0 min-w-0 flex-col overflow-hidden p-3'}
      aria-labelledby="demonstration-video-title"
      data-testid="demonstration-panel"
      data-demo-exercise={directive.exerciseId}
      data-demo-playback={directive.playback}
      data-demo-source={source?.src ?? ''}
      data-media-status={mediaStatus}
    >
      {compact ? (
        <div className="imm-panel-head">
          <h2 id="demonstration-video-title" className="imm-chip"><i className="size-2 rounded-full bg-violet-300" aria-hidden="true" />标准示范 · 真人</h2>
          <span className="imm-chip ml-auto min-w-0 truncate">{directive.playback === 'playing' ? <Play size={12} fill="currentColor" aria-hidden="true" /> : <Pause size={12} fill="currentColor" aria-hidden="true" />}{source?.displayName ?? '未知动作'} · 循环</span>
        </div>
      ) : <div className="flex h-12 min-w-0 items-center gap-2 px-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Clapperboard size={18} /></span>
        <div className="min-w-0">
          <h2 id="demonstration-video-title" className="truncate text-balance font-bold text-slate-900">真人标准动作</h2>
          <p className="truncate text-pretty text-xs text-slate-500">{source?.displayName ?? '未知动作'}</p>
        </div>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
          {directive.playback === 'playing' ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
          {playbackLabel(directive.playback)}
        </span>
      </div>}

      <div className={compact ? 'relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-950' : 'relative min-h-[380px] flex-1 overflow-hidden rounded-2xl bg-slate-950'}>
        {source ? (
          <video
            key={source.src}
            ref={videoRef}
            className="size-full object-contain"
            muted
            playsInline
            preload="metadata"
            loop
            aria-label={`${source.displayName}真人标准动作示范`}
            onLoadStart={() => setMediaStatus('loading')}
            onLoadedData={() => setMediaStatus('ready')}
            onCanPlay={() => setMediaStatus('ready')}
            onError={() => setMediaStatus('error')}
          >
            <source src={source.src} type={source.type} />
          </video>
        ) : null}

        {mediaStatus === 'loading' ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-950 text-center text-white" role="status">
            <div><LoaderCircle className="mx-auto animate-spin motion-reduce:animate-none" /><p className="mt-3 text-pretty text-sm">正在加载真人示范…</p></div>
          </div>
        ) : null}

        {mediaStatus === 'unavailable' || mediaStatus === 'error' ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-100 p-6 text-center" role="status" data-testid="demonstration-fallback">
            <div>
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-slate-500 shadow-sm"><CircleAlert size={24} /></span>
              <p className="mt-4 text-pretty font-semibold text-slate-800">真人示范视频暂未可用</p>
              <p className="mt-1 text-pretty text-sm leading-6 text-slate-500">请跟随中间摄像头区域的训练提示完成动作。</p>
              {source ? <p className="mt-3 break-all font-mono text-xs text-slate-400">{source.src}</p> : null}
            </div>
          </div>
        ) : null}

        {mediaStatus === 'ready' && directive.playback === 'paused' ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/30" data-testid="demonstration-paused-overlay">
            <p className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm"><Pause size={16} />示范已暂停</p>
          </div>
        ) : null}
      </div>
    </section>
  )
}
