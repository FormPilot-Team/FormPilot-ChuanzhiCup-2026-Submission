import { useEffect, useRef, useState } from 'react'

/** Assets from the PR #54 design refresh (see public/web-v1/ASSET_SOURCES.md). */
export const COACH_ORB_VIDEO = '/web-v1/assets/coach-orb-loop.webm'
export const COACH_ORB_POSTER = '/web-v1/assets/coach-orb-poster.png'
const VIDEO_TYPE = 'video/webm; codecs="vp9"'

function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

function canPlayOrbVideo(): boolean {
  try { return typeof document !== 'undefined' && document.createElement('video').canPlayType(VIDEO_TYPE) !== '' } catch { return false }
}

interface CoachOrbProps {
  /** `stage`: the large orb of the AI Coach intro. `avatar`: the coach's round avatar. */
  variant: 'stage' | 'avatar'
  /** false = poster only (small repeated avatars), so only one video decodes at a time. */
  animate?: boolean
  size?: 'md' | 'sm'
  testId?: string
}

/**
 * The AI Coach liquid orb (#54): a transparent VP9 WebM over its own poster. The poster is always rendered first and
 * stays when the video cannot load or the browser cannot decode VP9. With reduced motion no video is loaded at all. The
 * video plays only while it is on screen and the tab is visible.
 */
export function CoachOrb({ variant, animate = true, size = 'md', testId }: CoachOrbProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [useVideo] = useState(() => animate && canPlayOrbVideo())
  const [reduced, setReduced] = useState(prefersReducedMotion)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = true
    // The first frame may already be decoded before React's handler is attached (cache, fast disk): check readyState
    // and listen natively, as the #54 prototype does.
    const markReady = () => setReady(true)
    const markFailed = () => setReady(false)
    if (video.readyState >= 2) markReady()
    video.addEventListener('loadeddata', markReady)
    video.addEventListener('playing', markReady)
    video.addEventListener('error', markFailed)
    let onScreen = true
    const sync = () => {
      if (reduced || !onScreen || document.hidden) video.pause()
      else void video.play().catch(() => { /* autoplay refused: the poster or the decoded frame stays */ })
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting)
      sync()
    })
    observer?.observe(video)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      observer?.disconnect()
      document.removeEventListener('visibilitychange', sync)
      video.removeEventListener('loadeddata', markReady)
      video.removeEventListener('playing', markReady)
      video.removeEventListener('error', markFailed)
      video.pause()
    }
  }, [reduced, useVideo])

  const stage = variant === 'stage'
  const imageClass = stage ? 'signals-orb-still' : undefined
  const videoClass = `${stage ? 'signals-orb-video' : 'coach-orb-video'}${ready ? ' is-ready' : ''}`
  const dimension = stage ? 640 : size === 'sm' ? 32 : 50
  return (
    <div className={stage ? 'signals-orb-stage' : `coach-orb${size === 'sm' ? ' fpw-orb-sm' : ''}`} aria-hidden="true" data-testid={testId} data-orb-state={!useVideo ? 'poster' : reduced ? 'reduced-motion' : ready ? 'video' : 'loading'}>
      <img className={imageClass} src={COACH_ORB_POSTER} width={dimension} height={dimension} alt="" decoding="async" />
      {useVideo && !reduced ? (
        <video
          ref={videoRef}
          className={videoClass}
          muted
          loop
          playsInline
          preload={stage ? 'auto' : 'metadata'}
          width={dimension}
          height={dimension}
          poster={COACH_ORB_POSTER}
          onLoadedData={() => setReady(true)}
          onError={() => setReady(false)}
          disablePictureInPicture
        >
          <source src={COACH_ORB_VIDEO} type={VIDEO_TYPE} onError={() => setReady(false)} />
        </video>
      ) : null}
    </div>
  )
}
