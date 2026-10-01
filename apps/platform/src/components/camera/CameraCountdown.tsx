import { useEffect, useRef, useState } from 'react'
import type { CourseSnapshot } from '../../features/course/CourseController'
import { COUNTDOWN_GO_MS, countdownCue } from '../../features/course/countdownCue'

/**
 * The 3-2-1 countdown in the middle of the camera picture. It reuses the course's own countdown (CourseController), so
 * it starts exactly when the start gesture or framing has made the course ready and never delays training; the voice
 * (三、二、一、开始, when a system voice exists) comes from the course's voice policy and is not needed here. Purely
 * visual: pointer-events none, so it never blocks a button. Each step scales in lightly; reduced motion shows it still.
 */
export function CameraCountdown({ course }: { course?: Pick<CourseSnapshot, 'state' | 'countdown'> }) {
  const state = course?.state
  const previousState = useRef(state)
  const [justStarted, setJustStarted] = useState(false)

  useEffect(() => {
    const before = previousState.current
    previousState.current = state
    if (before === 'COUNTDOWN' && state === 'ACTIVE') {
      setJustStarted(true)
      const timer = window.setTimeout(() => setJustStarted(false), COUNTDOWN_GO_MS)
      return () => window.clearTimeout(timer)
    }
    setJustStarted(false)
    return undefined
  }, [state])

  const cue = countdownCue(course, justStarted)
  if (!cue) return null
  const go = cue === '开始'
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-slate-950/15" data-testid="camera-countdown" data-countdown={cue}>
      <span
        key={cue}
        role="status"
        aria-live="assertive"
        aria-label={go ? '开始训练' : `倒计时 ${cue}`}
        className={go
          ? 'fp-countdown-step grid h-28 min-w-28 place-items-center rounded-full bg-emerald-500/90 px-8 text-5xl font-extrabold text-white shadow-[0_18px_40px_-16px_rgb(5_150_105/0.9)] sm:h-36 sm:min-w-36 sm:text-6xl'
          : 'fp-countdown-step grid size-28 place-items-center rounded-full bg-slate-950/55 text-7xl font-extrabold tabular-nums text-white shadow-[0_18px_40px_-16px_rgb(15_23_42/0.9)] ring-4 ring-white/70 backdrop-blur-sm sm:size-36 sm:text-8xl'}
      >
        {cue}
      </span>
    </div>
  )
}
