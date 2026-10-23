// 摄像头识别: live mirror + plain checklist (in frame / left hand / right hand / distance), then a short
// calibration (neutral posture, comfortable left and right reach). No technical values are shown.
import { useEffect, useRef, useState } from 'react'
import type { CalibrationProfile, CalibrationStatus, FramingState } from '../motion/contracts'
import type { MotionSession } from '../motion/session'
import type { GameId } from '../shared/metrics'
import { RaiseHandArt } from './Illustrations'
import { MirrorView } from './MirrorView'

const READY_HOLD_MS = 1200
const OFFER_FALLBACK_AFTER_MS = 20_000

const REACH_NOTE: Record<GameId, string> = {
  apple: '不用勉强，舒服就好。苹果会出现在你够得到的地方。',
  boating: '不用勉强，舒服就好。划船时手不用举这么高。',
  archery: '不用勉强，舒服就好。拉弓的幅度会按你的手臂来定。',
}

export function CameraStep({ session, starting, error, seated, gameId, onRetry, onBack, onReady }: {
  session: MotionSession | null
  starting: boolean
  error: { message: string; guidance: string } | null
  seated: boolean
  gameId: GameId
  onRetry: () => void
  onBack: () => void
  onReady: (profile: CalibrationProfile | null) => void
}) {
  const [framing, setFraming] = useState<FramingState | null>(null)
  const [calibration, setCalibration] = useState<CalibrationStatus | null>(null)
  const [calibrating, setCalibrating] = useState(false)
  const [offerFallback, setOfferFallback] = useState(false)
  const readySince = useRef<number | null>(null)
  const finished = useRef(false)

  useEffect(() => {
    if (!session) return
    const startedAt = performance.now()
    const timer = setInterval(() => {
      const frame = session.adapter.latestFrame()
      const now = performance.now()
      setFraming(frame?.framing ?? null)
      const status = session.adapter.calibration()
      setCalibration(status)
      if (!calibrating) {
        if (frame?.framing.ready) {
          readySince.current ??= now
          if (now - readySince.current >= READY_HOLD_MS) {
            session.adapter.startCalibration()
            setCalibrating(true)
          }
        } else readySince.current = null
        if (now - startedAt > OFFER_FALLBACK_AFTER_MS) setOfferFallback(true)
      } else if (status.step === 'done' && status.profile && !finished.current) {
        finished.current = true
        setTimeout(() => onReady(status.profile), 900)
      }
    }, 100)
    return () => clearInterval(timer)
  }, [session, calibrating, onReady])

  const status = [
    { label: '身体入镜', ok: Boolean(framing?.bodyInFrame), detail: framing?.bodyInFrame ? '' : '还没看到' },
    { label: '左手', ok: Boolean(framing?.leftHandVisible), detail: framing?.leftHandVisible ? '' : '还没看到' },
    { label: '右手', ok: Boolean(framing?.rightHandVisible), detail: framing?.rightHandVisible ? '' : '还没看到' },
    {
      label: '距离',
      ok: Boolean(framing && framing.distance !== 'too-close' && framing.distance !== 'unknown' && framing.roomToMove),
      detail: !framing || framing.distance === 'unknown' ? '' : framing.distance === 'too-close' || !framing.roomToMove ? '再往后一点' : framing.distance === 'too-far' ? '合适（可以再近一点）' : '合适',
    },
  ]

  return (
    <div className="page">
      <div className="camera-layout" data-testid="step-camera">
        <div className="camera-view">
          {session ? (
            <MirrorView adapter={session.adapter} stream={session.source.stream()} showVideo={session.source.kind === 'camera'} label={session.source.kind === 'synthetic' ? '自动测试画面' : '镜像画面'} />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', gap: 12 }}>
              {starting && <div style={{ display: 'grid', placeItems: 'center', gap: 16 }}><div className="spinner" /><span style={{ fontSize: 24 }}>正在打开摄像头…</span></div>}
            </div>
          )}
        </div>
        <aside className="camera-side">
          {error ? (
            <div className="error-card" role="alert">
              <b>{error.message}</b>
              <span>{error.guidance}</span>
              <div className="actions" style={{ marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={onBack}>← 上一步</button>
                <button className="btn btn-primary btn-small" onClick={onRetry}>重新检测</button>
              </div>
            </div>
          ) : calibrating && calibration ? (
            <Calibration
              status={calibration}
              seated={seated}
              note={REACH_NOTE[gameId]}
              onSkip={() => {
                // Skipping the neutral step skips calibration entirely (conservative default reach, no
                // posture baseline); skipping a reach step keeps the neutral posture just measured.
                if (calibration.step === 'neutral') {
                  finished.current = true
                  onReady(null)
                } else session?.adapter.startCalibration({ skipReach: true })
              }}
            />
          ) : (
            <>
              <ul className="status-list" aria-live="polite">
                {status.map((item) => (
                  <li key={item.label} className={item.ok ? 'ok' : ''}>
                    <span className="mark" aria-hidden="true">{item.ok ? '✓' : '…'}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    <span style={{ color: 'var(--ink-soft)', fontSize: 18 }}>{item.ok ? item.detail || '好' : item.detail}</span>
                  </li>
                ))}
              </ul>
              <div className={`big-hint${framing?.ready ? ' calm' : ''}`} aria-live="polite">
                {starting ? '正在打开摄像头…' : framing?.ready ? '很好，请保持不动…' : (framing?.hint ?? '请站到摄像头前')}
              </div>
              <div className="actions">
                <button className="btn btn-ghost" onClick={onBack}>← 上一步</button>
                {offerFallback && <button className="btn btn-secondary btn-small" onClick={() => onReady(null)}>仍然开始</button>}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

function Calibration({ status, seated, note, onSkip }: { status: CalibrationStatus; seated: boolean; note: string; onSkip: () => void }) {
  const step = status.step
  const side = step === 'reach-left' ? 'left' : step === 'reach-right' ? 'right' : 'none'
  const title = step === 'neutral' ? `双手自然放下，${seated ? '坐好' : '站好'}别动`
    : step === 'reach-left' ? '慢慢举起左手，举到舒服的高度，停一下'
      : step === 'reach-right' ? '再举起右手，举到舒服的高度，停一下'
        : '好了！马上开始'
  const raised = status.liveElevationDeg === null ? 0 : Math.min(1, status.liveElevationDeg / 180)
  return (
    <div className="calib" aria-live="polite" data-testid="calibration">
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <RaiseHandArt side={side} />
        <div>
          <h3>{step === 'neutral' ? '先认识一下你' : step === 'done' ? '准备完成' : '看看你能舒服地够到哪里'}</h3>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{title}</div>
        </div>
      </div>
      {(step === 'reach-left' || step === 'reach-right') && (
        <>
          <div style={{ marginTop: 14, fontSize: 18, color: 'var(--ink-soft)' }}>举手高度</div>
          <div className="bar"><i style={{ width: `${raised * 100}%`, background: side === 'left' ? 'var(--left)' : 'var(--right)' }} /></div>
          <div style={{ marginTop: 8, fontSize: 18, color: 'var(--ink-soft)' }}>保持住</div>
          <div className="bar"><i style={{ width: `${status.progress * 100}%` }} /></div>
          <p style={{ margin: '12px 0 0', color: 'var(--ink-soft)' }}>{note}</p>
        </>
      )}
      {step === 'neutral' && <div className="bar"><i style={{ width: `${status.progress * 100}%` }} /></div>}
      {step !== 'done' && (
        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onSkip}>跳过这一步</button>
      )}
    </div>
  )
}
