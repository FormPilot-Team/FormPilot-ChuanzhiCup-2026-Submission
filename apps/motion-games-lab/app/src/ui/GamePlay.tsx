// Shared play screen for all three games: Phaser canvas + React HUD and overlays (countdown, pause,
// tracking lost, gentle hint pills, camera window). React only re-renders on game effects and a
// 4 Hz clock — never per pose frame. Each game supplies `mount` (its round, controller and scene).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { COPY } from '../data/games'
import type { MotionSession } from '../motion/session'
import { sfx } from '../shared/audio'
import { formatDuration, type GameId, type GameResult } from '../shared/metrics'
import type { PhaserHost } from '../shared/phaserHost'
import type { BaseEffect, PauseReason, PlayController, PlayStatus } from '../shared/play/PlayController'
import type { Settings } from '../shared/settings'
import { MirrorView } from './MirrorView'

type Toast = { kind: 'posture' | 'rest' | 'coach'; text: string; id: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyController = PlayController<any, any>

export interface PlayMount<C extends AnyController> {
  controller: C
  phaser: PhaserHost
}

export interface GamePlayProps<C extends AnyController> {
  gameId: GameId
  session: MotionSession
  settings: Settings
  durationMs: number
  mount: (host: HTMLDivElement) => PlayMount<C>
  comboLabel: (combo: number) => string
  /** extra HUD cards (distance, arrows…), re-rendered when the controller reports a HUD change */
  hud?: (controller: C) => ReactNode
  /** short live instruction under the HUD (e.g. the archery step), refreshed at 4 Hz */
  instruction?: (controller: C) => ReactNode
  onEnd: (result: GameResult) => void
  onRestart: () => void
  onExit: () => void
  onController?: (controller: AnyController | null) => void
}

export function GamePlay<C extends AnyController>(props: GamePlayProps<C>) {
  const { gameId, session, settings, durationMs, comboLabel, hud, instruction, onEnd, onRestart, onExit, onController } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<C | null>(null)
  const [controller, setController] = useState<C | null>(null)
  const [status, setStatus] = useState<PlayStatus>('countdown')
  const [reason, setReason] = useState<PauseReason | null>(null)
  const [count, setCount] = useState<number | null>(3)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [, setHudTick] = useState(0)
  const [remaining, setRemaining] = useState(durationMs)
  const [toast, setToast] = useState<Toast | null>(null)
  const [found, setFound] = useState(false)
  const [mirror, setMirror] = useState(settings.showMirror)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const { controller: c, phaser } = props.mount(host)
    controllerRef.current = c
    setController(c)
    onController?.(c)
    const timers: ReturnType<typeof setTimeout>[] = []
    let toastId = 0
    const showToast = (kind: Toast['kind'], text: string, ms: number) => {
      const id = ++toastId
      setToast({ kind, text, id })
      timers.push(setTimeout(() => setToast((t) => (t?.id === id ? null : t)), ms))
    }
    const off = c.subscribe((effect: BaseEffect | { type: string }) => {
      const e = effect as BaseEffect
      switch (e.type) {
        case 'hud':
          setScore(c.round.score)
          setCombo(c.round.combo)
          setHudTick((n) => n + 1)
          break
        case 'status':
          setStatus(e.status)
          setReason(e.reason)
          if (e.status === 'playing') setFound(false)
          if (e.status === 'paused') {
            if (e.reason === 'tracking') sfx.hint()
            else sfx.pause()
          }
          break
        case 'tracking-restored':
          setFound(true)
          break
        case 'posture-hint':
          sfx.hint()
          showToast('posture', e.kind === 'lean' ? COPY.hints.lean : COPY.hints.shrug, 3000)
          break
        case 'coach':
          showToast('coach', e.text, 3200)
          break
        case 'rest-reminder':
          showToast('rest', COPY.hints.rest, 4500)
          break
        case 'end':
          setStatus('ended')
          sfx.finish()
          timers.push(setTimeout(() => onEnd(e.result), 1400))
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
      c.startPlaying(performance.now())
    }, 3700))
    const clock = setInterval(() => setRemaining(Math.ceil(c.round.remainingMs() / 250) * 250), 250)
    const onVisibility = () => document.hidden && c.pause('hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      off()
      timers.forEach(clearTimeout)
      clearInterval(clock)
      document.removeEventListener('visibilitychange', onVisibility)
      onController?.(null)
      c.destroy()
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
    if (c.status === 'paused') {
      c.resume(performance.now())
      if ((c.status as PlayStatus) === 'playing') sfx.resume()
    } else c.pause('user')
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

  const timeLeft = formatDuration(remaining)
  const paused = status === 'paused'
  const trackingLost = paused && reason === 'tracking'

  return (
    <div className={`play play-${gameId}`} data-testid={`${gameId}-play`} data-status={status} data-pause-reason={reason ?? ''}>
      <div className="play-canvas" ref={hostRef} />
      <div className="hud">
        <div className="hud-left">
          <div className="hud-card" aria-label={`得分 ${score}`}>
            <span className="hud-label">得分</span>
            <span className="hud-value" data-testid="hud-score">{score}</span>
          </div>
          {controller && hud?.(controller)}
          {combo >= 2 && <div key={combo} className="combo-chip">{comboLabel(combo)}</div>}
        </div>
        <div className="hud-card timer" aria-label={`剩余时间 ${timeLeft}`}>
          <div className="row"><span className="hud-label">剩余时间</span><span className="hud-value" style={{ fontSize: 34 }}>{timeLeft}</span></div>
          <div className="bar"><i style={{ width: `${(remaining / durationMs) * 100}%` }} /></div>
        </div>
        <div className="hud-right">
          <button className="btn btn-secondary btn-small" aria-pressed={mirror} onClick={() => setMirror((m) => !m)}>{mirror ? '隐藏小窗' : '显示小窗'}</button>
          <button className="btn btn-primary pause-btn" onClick={togglePause} disabled={status === 'countdown' || status === 'ended'} data-testid="pause-button">
            {paused ? '▶ 继续' : 'Ⅱ 暂停'}
          </button>
        </div>
      </div>
      {controller && instruction && status === 'playing' && <Instruction render={() => instruction(controller)} />}
      {mirror && (
        <MirrorView className="mirror" adapter={session.adapter} stream={session.source.stream()} showVideo={session.source.kind === 'camera'} label="摄像头" />
      )}
      {toast && !paused && (
        <div className={`hint-pill ${toast.kind}`} role="status" key={toast.id} data-testid="hint-pill">
          <span aria-hidden="true">{toast.kind === 'posture' ? '🌿' : toast.kind === 'rest' ? '☕' : '💡'}</span>{toast.text}
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

/** Live instruction line, refreshed at 4 Hz (reads controller state; no per-frame renders). */
function Instruction({ render }: { render: () => ReactNode }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(timer)
  }, [])
  const content = render()
  if (!content) return null
  return <div className="instruction" data-testid="instruction">{content}</div>
}
