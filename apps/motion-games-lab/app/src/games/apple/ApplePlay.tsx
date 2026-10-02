// Apple Picking play screen: Phaser scene + React HUD/overlays. React only re-renders on game
// events (score, combo, status) and a 4 Hz clock — never per pose frame.
import { useCallback, useEffect, useRef, useState } from 'react'
import { COPY } from '../../data/games'
import { defaultCalibration } from '../../motion/calibration'
import type { CalibrationProfile } from '../../motion/contracts'
import type { MotionSession } from '../../motion/session'
import { sfx } from '../../shared/audio'
import { FLAGS } from '../../shared/flags'
import { formatDuration, type GameResult } from '../../shared/metrics'
import { createPhaserHost } from '../../shared/phaserHost'
import type { Settings } from '../../shared/settings'
import { MirrorView } from '../../ui/MirrorView'
import { AppleController, type ControllerEffect, type PauseReason, type PlayStatus } from './controller'
import { ReachModel } from './reach'
import { AppleRound } from './round'
import { AppleScene } from './AppleScene'

type Toast = { kind: 'posture' | 'rest'; text: string; id: number }


export function ApplePlay({ session, profile, settings, onEnd, onRestart, onExit, onController }: {
  session: MotionSession
  profile: CalibrationProfile | null
  settings: Settings
  onEnd: (result: GameResult) => void
  onRestart: () => void
  onExit: () => void
  onController?: (controller: AppleController | null) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<AppleController | null>(null)
  const [status, setStatus] = useState<PlayStatus>('countdown')
  const [reason, setReason] = useState<PauseReason | null>(null)
  const [count, setCount] = useState<number | null>(3)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [remaining, setRemaining] = useState(settings.roundSeconds * 1000)
  const [toast, setToast] = useState<Toast | null>(null)
  const [found, setFound] = useState(false)
  const [mirror, setMirror] = useState(settings.showMirror)
  const durationMs = (FLAGS.durationSeconds ?? settings.roundSeconds) * 1000

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const round = new AppleRound({
      difficulty: settings.difficulty,
      durationMs,
      reach: new ReachModel(profile ?? defaultCalibration()),
      seed: FLAGS.seed ?? undefined,
    })
    const controller = new AppleController(session.adapter, round, { restReminderMs: settings.restReminderSeconds * 1000 })
    controllerRef.current = controller
    onController?.(controller)
    const phaser = createPhaserHost(host, 'apple', AppleScene, { controller, dpr: Math.min(2, window.devicePixelRatio || 1), debug: FLAGS.debug })
    const timers: ReturnType<typeof setTimeout>[] = []
    let toastId = 0
    const showToast = (kind: Toast['kind'], text: string, ms: number) => {
      const id = ++toastId
      setToast({ kind, text, id })
      timers.push(setTimeout(() => setToast((t) => (t?.id === id ? null : t)), ms))
    }
    const off = controller.subscribe((effect: ControllerEffect) => {
      switch (effect.type) {
        case 'collect':
          setScore(controller.round.score)
          setCombo(effect.combo)
          break
        case 'expire':
          setCombo(0)
          break
        case 'status':
          setStatus(effect.status)
          setReason(effect.reason)
          if (effect.status === 'playing') setFound(false)
          if (effect.status === 'paused' && effect.reason === 'tracking') sfx.hint()
          break
        case 'tracking-restored':
          setFound(true)
          break
        case 'posture-hint':
          sfx.hint()
          showToast('posture', effect.kind === 'lean' ? COPY.hints.lean : COPY.hints.shrug, 3800)
          break
        case 'rest-reminder':
          showToast('rest', COPY.hints.rest, 5000)
          break
        case 'end':
          setStatus('ended')
          timers.push(setTimeout(() => onEnd(effect.result), 1400))
          break
        default:
          break
      }
    })
    // 3 · 2 · 1 · 开始
    sfx.tick()
    for (const [i, value] of [[1, 2], [2, 1], [3, 0]] as const) {
      timers.push(setTimeout(() => {
        setCount(value)
        if (value > 0) sfx.tick()
        else sfx.go()
      }, i * 1000))
    }
    timers.push(setTimeout(() => {
      setCount(null)
      controller.startPlaying(performance.now())
    }, 3700))
    const clock = setInterval(() => setRemaining(Math.ceil(controller.round.remainingMs() / 250) * 250), 250)
    const onVisibility = () => document.hidden && controller.pause('hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      off()
      timers.forEach(clearTimeout)
      clearInterval(clock)
      document.removeEventListener('visibilitychange', onVisibility)
      onController?.(null)
      controller.destroy()
      phaser.destroy()
      controllerRef.current = null
    }
    // The round is created once per mount; settings changes start a new round via remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const togglePause = useCallback(() => {
    const c = controllerRef.current
    if (!c) return
    sfx.click()
    if (c.status === 'paused') c.resume(performance.now())
    else c.pause('user')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        e.preventDefault()
        togglePause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePause])

  const roundMs = durationMs
  const timeLeft = formatDuration(remaining)
  const paused = status === 'paused'
  const trackingLost = paused && reason === 'tracking'

  return (
    <div className="play" data-testid="apple-play" data-status={status} data-pause-reason={reason ?? ''}>
      <div className="play-canvas" ref={hostRef} />
      <div className="hud">
        <div className="hud-left">
          <div className="hud-card" aria-label={`得分 ${score}`}>
            <span className="hud-label">得分</span>
            <span className="hud-value" data-testid="hud-score">{score}</span>
          </div>
          {combo >= 2 && <div key={combo} className="combo-chip">连摘 ×{combo}</div>}
        </div>
        <div className="hud-card timer" aria-label={`剩余时间 ${timeLeft}`}>
          <div className="row"><span className="hud-label">剩余时间</span><span className="hud-value" style={{ fontSize: 34 }}>{timeLeft}</span></div>
          <div className="bar"><i style={{ width: `${(remaining / roundMs) * 100}%` }} /></div>
        </div>
        <div className="hud-right">
          <button className="btn btn-secondary btn-small" aria-pressed={mirror} onClick={() => setMirror((m) => !m)}>{mirror ? '隐藏小窗' : '显示小窗'}</button>
          <button className="btn btn-primary pause-btn" onClick={togglePause} disabled={status === 'countdown' || status === 'ended'} data-testid="pause-button">
            {paused ? '▶ 继续' : 'Ⅱ 暂停'}
          </button>
        </div>
      </div>
      {mirror && (
        <MirrorView className="mirror" adapter={session.adapter} stream={session.source.stream()} showVideo={session.source.kind === 'camera'} label="镜像" />
      )}
      {toast && !paused && (
        <div className={`toast ${toast.kind}`} role="status" key={toast.id}>
          <span aria-hidden="true">{toast.kind === 'posture' ? '🌿' : '☕'}</span>{toast.text}
        </div>
      )}
      {count !== null && (
        <div className="countdown" data-testid="countdown" aria-live="assertive">
          <span className="ready">准备好了吗？</span>
          <b key={count}>{count === 0 ? '开始！' : count}</b>
        </div>
      )}
      {trackingLost && (
        <div className="overlay" data-testid="tracking-lost">
          <div className="overlay-card" role="alertdialog" aria-label={COPY.hints.lostTitle}>
            <h2>{found ? '找到你了！' : COPY.hints.lostTitle}</h2>
            <p>{found ? COPY.hints.found : COPY.hints.lostText}</p>
            <MirrorView className="camera-view" adapter={session.adapter} stream={session.source.stream()} showVideo={session.source.kind === 'camera'} />
            <div className="overlay-actions" style={{ marginTop: 18 }}>
              <button className="btn btn-secondary" onClick={onExit}>返回游戏选择</button>
            </div>
          </div>
        </div>
      )}
      {paused && !trackingLost && (
        <div className="overlay" data-testid="paused">
          <div className="overlay-card" role="dialog" aria-label="已暂停">
            <h2>休息一下</h2>
            <p>{COPY.safety}</p>
            <div className="overlay-actions">
              <button className="btn btn-primary" onClick={togglePause} autoFocus>▶ 继续</button>
              <button className="btn btn-secondary" onClick={onRestart}>重新开始</button>
              <button className="btn btn-ghost" onClick={onExit}>返回游戏选择</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
