// Boating paddle strokes, one state machine per side:
//   wait ──(hand steady)──▶ ready ──(moves away from neutral)──▶ out ──(reaches amplitude)──▶ STROKE_x
//                             ▲                                   │                              │
//                             └──────(back near neutral)──── return ◀───────────────────────────┘
// The stroke counts at the "catch" (amplitude reached) so the boat answers while the hand is still
// moving; the hand must come back near its neutral before the next stroke can start (no double count).
//
// Scheme A 'sweep' (default): forearm sweeps outward to the side and back, elbows near the body.
// Scheme B 'down' (debug only): hand pulls down from chest height and back. Phase 0.5 froze both as
// candidates; A won for this game (see docs). Either is a 2D trajectory proxy for a paddle stroke —
// it is never reported as a shoulder internal/external rotation angle or ROM.
// All values are lab engineering parameters awaiting human playtests, not clinical values.
import type {
  MotionEvent, MotionFrame, Point, Side, StrokeCancelReason, StrokeOptions, StrokePhase, StrokeSideState, StrokeState,
} from './contracts'

export const STROKE_CONFIG = Object.freeze({
  defaultAmplitude: 0.32,
  /** displacement from neutral that starts a stroke */
  startBand: 0.08,
  /** back within this of neutral → re-armed */
  neutralBand: 0.12,
  /** hand steady (below this speed, torso units / s) this long → neutral found */
  steadySpeed: 0.7,
  readyMs: 300,
  /** start → catch faster than this = a detection jump, not a stroke */
  minCatchMs: 120,
  /** an outward phase longer than this is abandoned (hand parked away from neutral) */
  maxOutMs: 6000,
  /** a hand parked steadily away from neutral this long becomes the new neutral */
  rebaselineMs: 1500,
  /** slow upward drift of the neutral while the hand rests inside the band */
  neutralAdapt: 0.04,
  /** sweep: at the catch the wrist must be at least this far outside its shoulder (torso units) */
  sweepMinOutside: 0.12,
  /** down: at the catch the wrist must be at least this far below its shoulder line */
  downMinBelow: 0.75,
  /** wrist above the shoulder line by more than this is a wave, not a paddle stroke */
  raisedY: -0.1,
  /** shoulder width below this share of its recent reference = body turned; strokes wait */
  turnRatio: 0.78,
})

type Pending = MotionEvent extends infer E ? (E extends MotionEvent ? Omit<E, 'id' | 'emittedAt'> : never) : never

interface SideMachine {
  phase: StrokePhase
  neutral: number | null
  value: number | null
  steadySince: number | null
  startedAt: number
  peak: number
  cycleId: number
  lastAt: number
  lastStrokeAt: number
  strokes: number
}

const fresh = (): SideMachine => ({
  phase: 'wait', neutral: null, value: null, steadySince: null, startedAt: 0, peak: 0, cycleId: 0, lastAt: Number.NaN, lastStrokeAt: -Infinity, strokes: 0,
})

/** Signed displacement measure for a side: grows as the hand performs the stroke. */
export function strokeValue(scheme: StrokeOptions['scheme'], side: Side, shoulder: Point, wrist: Point): number {
  if (scheme === 'down') return wrist.y - shoulder.y
  const out = side === 'left' ? -1 : 1
  return out * (wrist.x - shoulder.x)
}

export class StrokeDetector {
  private options: StrokeOptions = { scheme: 'sweep', amplitude: STROKE_CONFIG.defaultAmplitude }
  private sides: Record<Side, SideMachine> = { left: fresh(), right: fresh() }
  private cycleCounter = 0
  private widthRef: number | null = null

  configure(options: Partial<StrokeOptions>): void {
    const schemeChanged = options.scheme !== undefined && options.scheme !== this.options.scheme
    this.options = { ...this.options, ...options }
    if (schemeChanged) this.sides = { left: fresh(), right: fresh() }
  }

  state(): StrokeState {
    return { options: { ...this.options }, left: this.sideState('left'), right: this.sideState('right') }
  }

  /** Pause / tracking loss: abandon strokes in progress; hands must return to neutral first. */
  cancelAll(timestamp: number, reason: StrokeCancelReason): Pending[] {
    const events: Pending[] = []
    for (const side of ['left', 'right'] as const) {
      const s = this.sides[side]
      if (s.phase === 'out') events.push({ type: 'STROKE_CANCEL', timestamp, side, cycleId: s.cycleId, reason })
      if (s.phase === 'out' || s.phase === 'ready') s.phase = 'return'
      s.steadySince = null
    }
    return events
  }

  update(frame: MotionFrame): Pending[] {
    const events: Pending[] = []
    const now = frame.timestamp
    const c = STROKE_CONFIG
    let turned = false
    if (frame.leftShoulder && frame.rightShoulder) {
      const width = Math.abs(frame.rightShoulder.x - frame.leftShoulder.x)
      // The reference follows widening fast and narrowing very slowly, so a turn shows up as a drop.
      this.widthRef = this.widthRef === null ? width : this.widthRef + (width > this.widthRef ? 0.2 : 0.002) * (width - this.widthRef)
      turned = width < this.widthRef * c.turnRatio
    }
    for (const side of ['left', 'right'] as const) {
      const s = this.sides[side]
      const shoulder = side === 'left' ? frame.leftShoulder : frame.rightShoulder
      const wrist = side === 'left' ? frame.leftWrist : frame.rightWrist
      if (!frame.tracking.body || !frame.tracking[side] || !shoulder || !wrist) {
        if (s.phase === 'out') events.push({ type: 'STROKE_CANCEL', timestamp: now, side, cycleId: s.cycleId, reason: 'tracking-lost' })
        s.phase = 'wait'
        s.value = null
        s.steadySince = null
        s.lastAt = Number.NaN
        continue
      }
      const v = strokeValue(this.options.scheme, side, shoulder, wrist)
      const dt = Number.isFinite(s.lastAt) ? (now - s.lastAt) / 1000 : 0
      const speed = dt > 0 && s.value !== null ? Math.abs(v - s.value) / dt : 0
      s.value = v
      s.lastAt = now
      const steady = speed < c.steadySpeed
      const raised = wrist.y < c.raisedY
      if (steady && !raised) s.steadySince ??= now
      else s.steadySince = null
      const steadyFor = s.steadySince === null ? 0 : now - s.steadySince

      if (s.phase === 'wait') {
        if (steadyFor >= c.readyMs && !turned) {
          s.neutral = v
          s.phase = 'ready'
        }
        continue
      }
      const neutral = s.neutral ?? v
      if (s.phase === 'ready') {
        // lower envelope follows immediately; inside the band the neutral drifts slowly
        if (v < neutral) s.neutral = v
        else if (v - neutral < c.neutralBand) s.neutral = neutral + c.neutralAdapt * (v - neutral)
        if (!raised && !turned && v - (s.neutral ?? v) > c.startBand) {
          s.phase = 'out'
          s.startedAt = now
          s.peak = v
          s.cycleId = ++this.cycleCounter
        }
        continue
      }
      if (s.phase === 'out') {
        s.peak = Math.max(s.peak, v)
        const displacement = v - neutral
        const cancel = (reason: StrokeCancelReason, next: StrokePhase) => {
          events.push({ type: 'STROKE_CANCEL', timestamp: now, side, cycleId: s.cycleId, reason })
          s.phase = next
        }
        if (raised) cancel('raised', 'return')
        else if (turned) cancel('turned', 'return')
        else if (displacement >= this.options.amplitude && this.endPoseOk(v)) {
          const durationMs = now - s.startedAt
          if (durationMs < c.minCatchMs) cancel('too-fast', 'return')
          else {
            s.strokes += 1
            s.lastStrokeAt = now
            s.phase = 'return'
            events.push({ type: side === 'left' ? 'STROKE_LEFT' : 'STROKE_RIGHT', timestamp: now, cycleId: s.cycleId, amplitude: displacement, durationMs })
          }
        } else if (displacement < c.startBand * 0.6) cancel('too-small', 'ready')
        else if (now - s.startedAt > c.maxOutMs) cancel('too-slow', 'return')
        continue
      }
      // return: wait for the hand to come back near its neutral before re-arming
      if (v < neutral) s.neutral = v
      if (v - (s.neutral ?? v) <= c.neutralBand) s.phase = 'ready'
      else if (steadyFor >= c.rebaselineMs) {
        s.neutral = v
        s.phase = 'ready'
      }
    }
    return events
  }

  private endPoseOk(v: number): boolean {
    return this.options.scheme === 'down' ? v >= STROKE_CONFIG.downMinBelow : v >= STROKE_CONFIG.sweepMinOutside
  }

  private sideState(side: Side): StrokeSideState {
    const s = this.sides[side]
    const displacement = s.value !== null && s.neutral !== null ? s.value - s.neutral : null
    return {
      phase: s.phase,
      progress: displacement === null ? 0 : Math.max(0, Math.min(1, displacement / this.options.amplitude)),
      displacement,
      lastStrokeAt: s.lastStrokeAt,
      strokes: s.strokes,
    }
  }
}
