import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import type { RoutineProgram } from '../../features/routines/types'

export interface DemoRequest {
  /** Changes every time the user asks for a chapter, so the same chapter can be replayed. */
  token: number
  startSeconds: number
  label: string
}

type DemoState = 'poster' | 'loading' | 'playing' | 'error'

/**
 * 标准示范 on the routine detail page: the course's standard video, watched without the camera.
 * Shows the poster until the user asks to play; a missing or undecodable file says so instead of pretending to play.
 */
export function RoutineDemoVideo({ program, request }: { program: RoutineProgram; request: DemoRequest | null }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<DemoState>('poster')
  const [label, setLabel] = useState('整套示范')

  useEffect(() => {
    if (!request) return
    setLabel(request.label)
    setState((current) => (current === 'error' ? 'error' : current === 'playing' ? 'playing' : 'loading'))
    const video = videoRef.current
    if (!video) return
    const seek = () => {
      try { video.currentTime = request.startSeconds } catch { /* metadata not ready; the loadedmetadata handler retries */ }
      void video.play().catch(() => { /* autoplay with sound can be refused; controls stay available */ })
    }
    if (video.readyState >= 1) seek()
    else video.addEventListener('loadedmetadata', seek, { once: true })
    return () => video.removeEventListener('loadedmetadata', seek)
  }, [request])

  const start = () => {
    setState('loading')
    setLabel('整套示范')
    const video = videoRef.current
    if (video) void video.play().catch(() => { /* user can press play in the controls */ })
  }

  return (
    <figure className="min-w-0" data-testid="routine-demo">
      <div className="relative overflow-hidden rounded-2xl bg-slate-950" style={{ aspectRatio: String(program.video.contentAspect) }}>
        <video
          ref={videoRef}
          className={state === 'poster' || state === 'error' ? 'hidden' : 'size-full object-contain'}
          src={program.video.src}
          poster={program.video.posterSrc}
          preload="none"
          controls
          playsInline
          onPlaying={() => setState('playing')}
          onError={() => setState('error')}
          data-testid="routine-demo-video"
          aria-label={`${program.title}标准示范视频`}
        />
        {state === 'poster' || state === 'error' ? <img src={program.video.posterSrc} alt={`${program.title}标准示范视频画面`} className="size-full object-cover" /> : null}
        {state === 'poster' ? (
          <button type="button" onClick={start} className="absolute inset-0 grid place-items-center bg-slate-950/25 text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300" data-testid="routine-demo-play">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg"><Play size={16} fill="currentColor" aria-hidden="true" />播放标准示范</span>
          </button>
        ) : null}
        {state === 'error' ? (
          <div className="absolute inset-x-3 bottom-3 rounded-xl bg-white/95 px-4 py-3 text-sm font-semibold text-amber-900" role="status" data-testid="routine-demo-error">示范视频暂时无法播放（文件缺失或浏览器不支持）。仍可直接进入跟练，或稍后重试。</div>
        ) : null}
      </div>
      <figcaption className="mt-2 text-xs text-slate-500" data-testid="routine-demo-caption">
        标准示范视频 · {state === 'playing' || state === 'loading' ? `正在播放：${label}` : '只看示范不会开启摄像头'}
      </figcaption>
    </figure>
  )
}
