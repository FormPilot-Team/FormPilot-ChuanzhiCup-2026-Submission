// The single motion pipeline: PoseSource → FrameBuilder → framing / posture / calibration →
// enabled detectors → (MotionFrame, MotionEvent[]) for the game. One source, one model, one loop.
import { Calibrator } from './calibration'
import type {
  CalibrationStatus, DrawOptions, DrawState, MotionAdapterApi, MotionCapability, MotionEvent, MotionFrame, MotionListener, MotionTarget,
  PostureFlags, Side, StrokeOptions, StrokeState,
} from './contracts'
import { DrawDetector } from './drawDetector'
import { StrokeDetector } from './strokeDetector'
import { FramingController } from './framing'
import { FrameBuilder, type BodyMeasures } from './frameBuilder'
import type { PoseSource, PoseSourceInfo, RawPoseSample } from './poseSource'
import { PostureMonitor, samePosture } from './posture'
import { TargetTracker, type TrackerSnapshot } from './targetTracker'

export const ADAPTER_CONFIG = Object.freeze({
  bodyLostMs: 400,
  bodyRestoreMs: 300,
  handLostMs: 300,
  handRestoreMs: 150,
  /** no camera frame for this long counts as tracking lost (stalled camera / hidden tab) */
  staleMs: 600,
})

type Pending = MotionEvent extends infer E ? (E extends MotionEvent ? Omit<E, 'id' | 'emittedAt'> : never) : never

class LossTracker {
  tracked = false
  private since?: number
  constructor(private readonly lostMs: number, private readonly restoreMs: number) {}

  /** Returns 'lost' / 'restored' when the debounced state flips. */
  update(visible: boolean, now: number): 'lost' | 'restored' | null {
    if (visible === this.tracked) {
      this.since = undefined
      return null
    }
    this.since ??= now
    if (now - this.since < (visible ? this.restoreMs : this.lostMs)) return null
    this.tracked = visible
    this.since = undefined
    return visible ? 'restored' : 'lost'
  }
}

export interface AdapterDiagnostics {
  source: PoseSourceInfo
  samples: number
  inferenceFps: number
  inferenceMsLast: number
  inferenceMsP50: number
  inferenceMsP95: number
  /** where pose inference runs: 'worker' (default) or 'main' */
  inferenceThread: PoseSourceInfo['inferenceThread']
  /** camera frames skipped while inference was busy (latest-frame-only, no queue) */
  framesDropped: number
  /** main-thread cost of turning one pose into a MotionFrame + events (ms, p95) */
  motionMsP95: number
  frameConfidence: number
  tracking: MotionFrame['tracking']
  posture: PostureFlags
  framing: MotionFrame['framing']
  measures: Pick<BodyMeasures, 'valid' | 'hipsValid' | 'scale' | 'shoulderWidth' | 'leanDeg' | 'shoulderTiltDeg' | 'earGap'> | null
  targets: TrackerSnapshot[]
  strokes: StrokeState | null
  draw: DrawState | null
  calibration: CalibrationStatus
  capabilities: MotionCapability[]
  detecting: boolean
  recentEvents: { type: string; at: number; detail: string }[]
}

export class MotionAdapter implements MotionAdapterApi {
  private readonly builder: FrameBuilder
  private readonly posture = new PostureMonitor()
  private readonly framing = new FramingController()
  private readonly calibrator = new Calibrator()
  private readonly tracker = new TargetTracker()
  private readonly strokes = new StrokeDetector()
  private readonly draw = new DrawDetector()
  private readonly listeners = new Set<MotionListener>()
  private readonly capabilities = new Set<MotionCapability>()
  private readonly body = new LossTracker(ADAPTER_CONFIG.bodyLostMs, ADAPTER_CONFIG.bodyRestoreMs)
  private readonly hands: Record<Side, LossTracker> = {
    left: new LossTracker(ADAPTER_CONFIG.handLostMs, ADAPTER_CONFIG.handRestoreMs),
    right: new LossTracker(ADAPTER_CONFIG.handLostMs, ADAPTER_CONFIG.handRestoreMs),
  }
  private pending: Pending[] = []
  private eventId = 0
  private latest: MotionFrame | null = null
  private latestMeasures: BodyMeasures | null = null
  private lastPosture: PostureFlags | null = null
  private unsubscribe?: () => void
  private watchdog?: ReturnType<typeof setInterval>
  private lastSampleAt = 0
  private sampleTimes: number[] = []
  private inferenceMs: number[] = []
  private motionMs: number[] = []
  private samples = 0
  private recent: AdapterDiagnostics['recentEvents'] = []
  private detecting = true

  constructor(readonly source: PoseSource, private readonly options: { watchdog?: boolean } = {}) {
    this.builder = new FrameBuilder(source.kind)
  }

  async start(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = this.source.onSample((sample) => this.process(sample))
    await this.source.start()
    this.lastSampleAt = performance.now()
    if (this.options.watchdog !== false) {
      this.watchdog = setInterval(() => {
        const now = performance.now()
        if (this.body.tracked && now - this.lastSampleAt > ADAPTER_CONFIG.staleMs) {
          this.process({ timestamp: now, frameTime: now, landmarks: null, imageWidth: 16, imageHeight: 9, inferenceMs: 0, stale: true })
        }
      }, 150)
    }
  }

  stop(): void {
    clearInterval(this.watchdog)
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.source.stop()
    this.listeners.clear()
  }

  subscribe(listener: MotionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  enable(capability: MotionCapability): void {
    this.capabilities.add(capability)
  }

  configureStrokes(options: Partial<StrokeOptions>): void {
    this.strokes.configure(options)
  }

  strokeState(): StrokeState {
    return this.strokes.state()
  }

  configureDraw(options: Partial<DrawOptions>): void {
    this.draw.configure(options)
  }

  drawState(): DrawState {
    return this.draw.state()
  }

  setTargets(targets: readonly MotionTarget[]): void {
    this.pending.push(...this.tracker.setTargets(targets, this.latest))
  }

  getTargets(): readonly MotionTarget[] {
    return this.tracker.getTargets()
  }

  targetProgress(targetId: number): number {
    return this.tracker.progress(targetId)
  }

  resetAttempts(reason: string): void {
    const at = this.latest?.timestamp ?? performance.now()
    this.pending.push(...this.tracker.cancelAll(at), ...this.strokes.cancelAll(at, 'paused'), ...this.draw.cancelAll(at, 'paused'))
    this.recent.unshift({ type: 'RESET', at: Math.round(at), detail: reason })
  }

  setDetectionActive(active: boolean): void {
    if (this.detecting && !active) {
      const at = this.latest?.timestamp ?? performance.now()
      this.pending.push(...this.tracker.cancelAll(at), ...this.strokes.cancelAll(at, 'paused'), ...this.draw.cancelAll(at, 'paused'))
    }
    this.detecting = active
  }

  startCalibration(options?: { skipReach?: boolean }): void {
    this.calibrator.start(options)
  }

  calibration(): CalibrationStatus {
    return this.calibrator.status()
  }

  latestFrame(): MotionFrame | null {
    return this.latest
  }

  diagnostics(): AdapterDiagnostics {
    const now = performance.now()
    const recentSamples = this.sampleTimes.filter((t) => now - t <= 2000)
    const sorted = [...this.inferenceMs].sort((a, b) => a - b)
    const motion = [...this.motionMs].sort((a, b) => a - b)
    const m = this.latestMeasures
    const source = this.source.info()
    return {
      source,
      samples: this.samples,
      inferenceFps: recentSamples.length > 1 ? ((recentSamples.length - 1) * 1000) / (recentSamples[recentSamples.length - 1] - recentSamples[0]) : 0,
      inferenceMsLast: this.inferenceMs[this.inferenceMs.length - 1] ?? 0,
      inferenceMsP50: sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.5)] : 0,
      inferenceMsP95: sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)] : 0,
      inferenceThread: source.inferenceThread,
      framesDropped: source.framesDropped,
      motionMsP95: motion.length ? motion[Math.floor((motion.length - 1) * 0.95)] : 0,
      frameConfidence: this.latest?.confidence ?? 0,
      tracking: this.latest?.tracking ?? { body: false, left: false, right: false },
      posture: this.latest?.posture ?? { torsoLean: false, shrug: false, shrugSide: null, leanDegrees: null, shrugRatio: { left: null, right: null } },
      framing: this.latest?.framing ?? { bodyInFrame: false, leftHandVisible: false, rightHandVisible: false, distance: 'unknown', roomToMove: false, hint: null, ready: false },
      measures: m ? { valid: m.valid, hipsValid: m.hipsValid, scale: m.scale, shoulderWidth: m.shoulderWidth, leanDeg: m.leanDeg, shoulderTiltDeg: m.shoulderTiltDeg, earGap: m.earGap } : null,
      targets: this.tracker.snapshot(),
      strokes: this.capabilities.has('strokes') ? this.strokes.state() : null,
      draw: this.capabilities.has('draw') ? this.draw.state() : null,
      calibration: this.calibrator.status(),
      capabilities: [...this.capabilities],
      detecting: this.detecting,
      recentEvents: this.recent,
    }
  }

  /** Public for synthetic/manual sources and tests; camera sources call it through onSample. */
  process(sample: RawPoseSample): void {
    const started = performance.now()
    if (!sample.stale) {
      this.lastSampleAt = performance.now()
      this.samples += 1
      this.sampleTimes.push(performance.now())
      if (this.sampleTimes.length > 120) this.sampleTimes.shift()
      this.inferenceMs.push(sample.inferenceMs)
      if (this.inferenceMs.length > 300) this.inferenceMs.shift()
    }
    const { frame, measures } = this.builder.build(sample)
    const now = frame.timestamp
    frame.framing = this.framing.update(measures, now)
    frame.posture = this.posture.update(frame, measures)

    const bodyChange = this.body.update(frame.tracking.body, now)
    if (bodyChange) this.pending.push({ type: bodyChange === 'lost' ? 'TRACKING_LOST' : 'TRACKING_RESTORED', timestamp: now, scope: 'body' })
    for (const side of ['left', 'right'] as const) {
      const change = this.hands[side].update(frame.tracking[side], now)
      if (change) this.pending.push({ type: change === 'lost' ? 'TRACKING_LOST' : 'TRACKING_RESTORED', timestamp: now, scope: side })
    }
    if (bodyChange === 'lost') {
      this.pending.push(...this.tracker.cancelAll(now), ...this.strokes.cancelAll(now, 'tracking-lost'), ...this.draw.cancelAll(now, 'tracking-lost'))
    }

    if (this.lastPosture && !samePosture(this.lastPosture, frame.posture)) {
      this.pending.push({ type: 'POSTURE_CHANGED', timestamp: now, posture: frame.posture })
    }
    this.lastPosture = frame.posture

    if (this.calibrator.update(frame, measures)) this.posture.setBaseline(this.calibrator.postureBaseline())
    if (this.body.tracked && this.detecting) {
      if (this.capabilities.has('targets')) this.pending.push(...this.tracker.update(frame))
      if (this.capabilities.has('strokes')) this.pending.push(...this.strokes.update(frame))
      if (this.capabilities.has('draw')) this.pending.push(...this.draw.update(frame))
    }

    this.latest = frame
    this.latestMeasures = measures
    const emittedAt = performance.now()
    const events = this.pending.map((event) => ({ ...event, id: ++this.eventId, emittedAt }) as MotionEvent)
    this.pending = []
    for (const event of events) {
      if (event.type === 'TARGET_HOLD' && !event.completed) continue
      this.recent.unshift({ type: event.type, at: Math.round(event.timestamp), detail: describe(event) })
    }
    if (this.recent.length > 14) this.recent.length = 14
    for (const listener of this.listeners) listener(frame, events)
    this.motionMs.push(performance.now() - started)
    if (this.motionMs.length > 300) this.motionMs.shift()
  }
}

function describe(event: MotionEvent): string {
  switch (event.type) {
    case 'TARGET_ENTER': return `#${event.targetId} ${event.side} attempt ${event.attemptId}`
    case 'TARGET_HOLD': return `#${event.targetId} ${event.side} complete`
    case 'TARGET_EXIT': return `#${event.targetId} ${event.side} ${event.reason}${event.completed ? ' (done)' : ''}`
    case 'TRACKING_LOST':
    case 'TRACKING_RESTORED': return event.scope
    case 'POSTURE_CHANGED': return `lean=${event.posture.torsoLean} shrug=${event.posture.shrugSide ?? 'no'}`
    case 'STROKE_LEFT':
    case 'STROKE_RIGHT': return `#${event.cycleId} amp ${event.amplitude.toFixed(2)} ${Math.round(event.durationMs)} ms`
    case 'STROKE_CANCEL': return `${event.side} #${event.cycleId} ${event.reason}`
    case 'DRAW_START': return `${event.side} attempt ${event.attemptId}`
    case 'DRAW_HOLD': return `#${event.attemptId} ${event.progress >= 1 ? 'armed' : 'hold'} stab ${event.stability.toFixed(2)}`
    case 'RELEASE': return `#${event.attemptId} draw ${event.drawRatio.toFixed(2)} stab ${event.holdStability.toFixed(2)}`
    case 'DRAW_CANCEL': return `#${event.attemptId} ${event.reason}`
    default: return ''
  }
}
