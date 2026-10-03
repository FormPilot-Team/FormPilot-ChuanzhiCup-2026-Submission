// Developer panel, only with ?debug=1. Shows what the normal UI must never show: FPS, detector
// confidence, tracking/posture/framing internals, per-side target state, thresholds, motion events.
import { useEffect, useState } from 'react'
import { CALIBRATION_CONFIG } from '../motion/calibration'
import { FRAME_CONFIG } from '../motion/frameBuilder'
import { ADAPTER_CONFIG, type AdapterDiagnostics } from '../motion/MotionAdapter'
import type { MotionSession } from '../motion/session'
import { POSTURE_CONFIG } from '../motion/posture'
import { TARGET_CONFIG } from '../motion/targetTracker'
import { DRAW_CONFIG } from '../motion/drawDetector'
import { STROKE_CONFIG } from '../motion/strokeDetector'
import { perf, percentile } from '../shared/perf'
import type { AnyController } from './GamePlay'

const f = (v: number | null | undefined, digits = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits))

export function DebugPanel({ session, controller }: { session: MotionSession | null; controller: AnyController | null }) {
  const [open, setOpen] = useState(true)
  const [d, setD] = useState<AdapterDiagnostics | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => {
      setD(session?.adapter.diagnostics() ?? null)
      tick((n) => n + 1)
    }, 250)
    return () => clearInterval(timer)
  }, [session])
  if (!open) return <button className="debug-toggle" onClick={() => setOpen(true)}>debug ▸</button>
  const latency = controller?.feedbackLatencies ?? []
  return (
    <aside className="debug-panel" data-testid="debug-panel">
      <button style={{ float: 'right' }} onClick={() => setOpen(false)}>×</button>
      <h4>performance</h4>
      <table><tbody>
        <tr><td>render fps (avg 5 s)</td><td>{f(perf.renderFps(), 1)}</td></tr>
        <tr><td>frame ms p95 / max (5 s)</td><td data-testid="debug-frame-time">{f(perf.frameTimeP95(), 1)} / {f(perf.frameTimeMax(), 1)}</td></tr>
        <tr><td>frames &gt;33 ms (5 s)</td><td>{perf.slowFrames(33)}</td></tr>
        <tr><td>inference thread</td><td data-testid="debug-inference-thread">{d?.inferenceThread ?? '—'}{d?.source.workerFallback ? ` (${d.source.workerFallback})` : ''}</td></tr>
        <tr><td>inference fps</td><td>{f(d?.inferenceFps, 1)}</td></tr>
        <tr><td>inference ms last / p50 / p95</td><td>{f(d?.inferenceMsLast, 1)} / {f(d?.inferenceMsP50, 1)} / {f(d?.inferenceMsP95, 1)}</td></tr>
        <tr><td>main-thread pose ms p95</td><td>{f(d?.motionMsP95, 2)}</td></tr>
        <tr><td>camera frames skipped</td><td>{d?.framesDropped ?? '—'}</td></tr>
        <tr><td>frame→render ms p50 / p95</td><td>{f(percentile(controller?.frameLatencies ?? [], 0.5), 0)} / {f(percentile(controller?.frameLatencies ?? [], 0.95), 0)}</td></tr>
        <tr><td>event→render ms p50 / p95</td><td>{f(percentile(latency, 0.5), 0)} / {f(percentile(latency, 0.95), 0)}</td></tr>
        <tr><td>long tasks</td><td>{perf.longTasks} ({f(perf.longTaskMs, 0)} ms)</td></tr>
        <tr><td>JS heap MB</td><td>{f(perf.heapMB(), 1)}</td></tr>
      </tbody></table>
      <h4>detector</h4>
      <table><tbody>
        <tr><td>source / delegate</td><td>{d?.source.kind} / {d?.source.delegate}</td></tr>
        <tr><td>camera</td><td>{d?.source.cameraWidth}×{d?.source.cameraHeight} @ {f(d?.source.cameraFrameRate, 0)}</td></tr>
        <tr><td>confidence</td><td>{f(d?.frameConfidence)}</td></tr>
        <tr><td>tracking body/L/R</td><td>{d ? `${+d.tracking.body}/${+d.tracking.left}/${+d.tracking.right}` : '—'}</td></tr>
        <tr><td>torso scale / hips</td><td>{f(d?.measures?.scale, 3)} / {d?.measures?.hipsValid ? 'yes' : 'no'}</td></tr>
        <tr><td>lean° / tilt°</td><td>{f(d?.measures?.leanDeg, 1)} / {f(d?.measures?.shoulderTiltDeg, 1)}</td></tr>
        <tr><td>posture lean / shrug</td><td>{d ? `${d.posture.torsoLean} / ${d.posture.shrugSide ?? 'no'}` : '—'}</td></tr>
        <tr><td>shrug ratio L / R</td><td>{f(d?.posture.shrugRatio.left)} / {f(d?.posture.shrugRatio.right)}</td></tr>
        <tr><td>framing</td><td>{d ? `${d.framing.ready ? 'ready' : 'not ready'} · ${d.framing.distance}` : '—'}</td></tr>
      </tbody></table>
      <h4>state machine</h4>
      <table><tbody>
        <tr><td>calibration</td><td>{d?.calibration.step} {f(d?.calibration.progress)}</td></tr>
        <tr><td>game status</td><td>{controller ? `${controller.status}${controller.pauseReason ? ` (${controller.pauseReason})` : ''}` : '—'}</td></tr>
        {d?.targets.map((t) => (
          <tr key={t.targetId}><td>target #{t.targetId}</td><td>L {t.left} · R {t.right} · {f(t.progress)}</td></tr>
        ))}
        {controller?.debugRows().map(([k, v]) => (
          <tr key={k}><td>{k}</td><td>{v}</td></tr>
        ))}
      </tbody></table>
      <h4>thresholds</h4>
      <table><tbody>
        <tr><td>visibility / wrist</td><td>{FRAME_CONFIG.minVisibility} / {FRAME_CONFIG.minWristVisibility}</td></tr>
        <tr><td>filter median / ema</td><td>{FRAME_CONFIG.filter.medianWindow} / {FRAME_CONFIG.filter.emaAlpha}</td></tr>
        <tr><td>wrist jump / s</td><td>{FRAME_CONFIG.maxWristSpeed}</td></tr>
        <tr><td>exit margin / max gap</td><td>{TARGET_CONFIG.exitMargin} / {TARGET_CONFIG.maxGapMs} ms</td></tr>
        <tr><td>lost / restore ms</td><td>{ADAPTER_CONFIG.bodyLostMs} / {ADAPTER_CONFIG.bodyRestoreMs}</td></tr>
        <tr><td>lean on/off °</td><td>{POSTURE_CONFIG.leanOnDeg} / {POSTURE_CONFIG.leanOffDeg}</td></tr>
        <tr><td>shrug on/off</td><td>{POSTURE_CONFIG.shrugOnRatio} / {POSTURE_CONFIG.shrugOffRatio}</td></tr>
        <tr><td>calib neutral / hold ms</td><td>{CALIBRATION_CONFIG.neutralMs} / {CALIBRATION_CONFIG.reachHoldMs}</td></tr>
        <tr><td>stroke start / return (SW / share)</td><td>{STROKE_CONFIG.startBand} / {STROKE_CONFIG.returnShare}</td></tr>
        <tr><td>stroke min catch / confirm</td><td>{STROKE_CONFIG.minCatchMs} ms / {STROKE_CONFIG.confirmFrames} frames</td></tr>
        <tr><td>draw start / string out min</td><td>{DRAW_CONFIG.startDelta} / {DRAW_CONFIG.drawHandOutMin}</td></tr>
        <tr><td>return share / base min / confirm</td><td>{DRAW_CONFIG.returnShare} / {DRAW_CONFIG.returnBaseMin} / {DRAW_CONFIG.returnConfirmFrames} fr</td></tr>
        <tr><td>soft hints: turn / bow elbow° / sustain</td><td>{DRAW_CONFIG.turnRatio} / {DRAW_CONFIG.bowArmSoftDeg} / {DRAW_CONFIG.softHintSustainMs} ms</td></tr>
      </tbody></table>
      <h4>motion events</h4>
      {d?.recentEvents.map((e, i) => (
        <div key={`${e.at}-${i}`} className="ev">{e.at} {e.type} {e.detail}</div>
      ))}
    </aside>
  )
}
