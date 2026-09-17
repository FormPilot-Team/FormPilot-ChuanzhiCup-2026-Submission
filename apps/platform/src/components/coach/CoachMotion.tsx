import { useEffect, useState, type CSSProperties } from 'react'
import type { CoachAnimationFrame, CoachMotionMode } from '../../adapters/coachAnimation/types'
import { resolveCoachMotionMode } from '../../features/coach/coachMotionPolicy'

interface CoachMotionProps {
  frame: CoachAnimationFrame
  mode: CoachMotionMode
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return reduced
}

export function CoachMotion({ frame, mode }: CoachMotionProps) {
  const reducedMotion = useReducedMotion()
  const frames = frame.motionFrames
  const hasMotion = Boolean(frames && frames.length > 1)
  const effectiveMode = resolveCoachMotionMode(mode, hasMotion, reducedMotion)

  useEffect(() => {
    if (!frames) return
    const images = frames.map((item) => {
      const image = new Image()
      image.src = item.src
      void image.decode?.().catch(() => undefined)
      return image
    })
    return () => { for (const image of images) image.src = '' }
  }, [frames])

  if (effectiveMode === 'static' || !frames) {
    return <img src={frame.src} alt={frame.alt} className="size-full object-contain object-center" data-coach-motion={effectiveMode} data-coach-frame-count={hasMotion ? frames?.length : 1} />
  }

  const cycleDuration = frames.reduce((total, item) => total + item.durationMs, 0)
  const style = {
    '--coach-frame-count': frames.length,
    '--coach-frame-steps': frames.length - 1,
    '--coach-cycle-duration': `${cycleDuration}ms`,
  } as CSSProperties

  return (
    <div className="coach-motion size-full overflow-hidden" data-coach-motion={effectiveMode} data-coach-frame-count={frames.length} style={style}>
      <div className="coach-motion-track flex size-full" aria-label={frame.alt}>
        {frames.map((item, index) => (
          <img key={item.id} src={item.src} alt="" aria-hidden="true" className="coach-motion-frame h-full shrink-0 object-contain object-center" data-frame-id={item.id} data-frame-index={index} />
        ))}
      </div>
    </div>
  )
}
