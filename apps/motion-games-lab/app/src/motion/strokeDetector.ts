// Boating paddle strokes, one state machine per side (Round-1 playtest rewrite):
//
//   READY ──(hand moves outward from its neutral)──▶ OUTWARD ──(travelled `amplitude`)──▶ STROKE event
//     ▲                                                 │ (falls back early: quietly READY again)     │
//     └─────────(hand came back toward the body by half a stroke)──── RETURN ◀───────────────────────┘
//
// Design rule from the playtest: this is a game control, not a measurement exam. A stroke depends only
// on the wrist's movement along one axis (outward for scheme A), how far it travelled relative to the
// player's own shoulder width, its direction, and basic tracking. There is no "hold still first" wait,
// no required end position outside the shoulder, no torso-turn or elbow rule, and the hand may wander up
// and down, bend the elbow and move at any comfortable speed. The neutral is simply where the hand has
// recently been closest to the body (a lower envelope), so it adapts to each player automatically.
//
// No double counts: after a stroke the hand must come back by half a stroke (hysteresis, far larger than
// tracking jitter) before the next one can start, and moving inward can never start a stroke. A stroke
// must also take a minimum time and stay past the line for two frames, so a one-frame detection jump
// does not count.
//
// Scheme A 'sweep' (default): hands sweep outward to the sides and back. Scheme B 'down' (debug only):
// hand pulls down and back. Either is a 2D trajectory proxy for a paddle stroke — never reported as a
// shoulder rotation angle or ROM. All values are lab engineering parameters awaiting more playtests.
import type {
  MotionEvent, MotionFrame, Point, Side, StrokeCancelReason, StrokeOptions, StrokePhase, StrokeSideState, StrokeState,
} from './contracts'

export const STROKE_CONFIG = Object.freeze({
  /** default stroke size, in shoulder widths of the player */
  defaultAmplitude: 0.28,
  /** movement beyond the neutral that starts a stroke (shoulder widths) */
  startBand: 0.06,
  /** after a stroke, coming back by this share of the stroke re-arms the side */
  returnShare: 0.5,
  /** the stroke line must be crossed on this many consecutive frames (a one-frame jump is not a stroke) */
  confirmFrames: 2,
  /** start → stroke faster than this is a detection jump (a one-frame jump confirms after ~66 ms) */
  minCatchMs: 70,
  /** an outward movement that stalls this long without counting re-bases the neutral there */
  maxOutMs: 5000,
  /** after a stroke, a hand parked out this long re-arms where it is */
  rebaselineMs: 1200,
  /** the neutral is the lowest value seen over this window (it follows the hand slowly upward) */
  neutralWindowMs: 1500,
  /** an outward movement that got at least this share of the way counts as "almost": a gentle hint */
  nearMissShare: 0.45,
  /** scheme A: a wrist clearly above the head is waving, not paddling (torso units above the shoulder line) */
  overheadY: -0.6,
  /** shoulder width (torso units) before the first frontal reading */
  defaultShoulderWidth: 0.75,
})

type Pending = MotionEvent extends infer E ? (E extends MotionEvent ? Omit<E, 'id' | 'emittedAt'> : never) : never

interface SideMachine {
  phase: StrokePhase
  neutral: number | null
  value: number | null
  history: { t: number; v: number }[]
  startedAt: number
  peak: number
  confirm: number
  cycleId: number
  lastStrokeAt: number
  strokes: number
}

const fresh = (): SideMachine => ({
  phase: 'wait', neutral: null, value: null, history: [], startedAt: 0, peak: 0, confirm: 0, cycleId: 0, lastStrokeAt: -Infinity, strokes: 0,
})

/** Signed displacement measure for a side: grows as the hand performs the stroke (torso units). */
export function strokeValue(scheme: StrokeOptions['scheme'], side: Side, shoulder: Point, wrist: Point): number {
  if (scheme === 'down') return wrist.y - shoulder.y
  const out = side === 'left' ? -1 : 1
  return out * (wrist.x - shoulder.x)
}

export class StrokeDetector {
  private options: StrokeOptions = { scheme: 'sweep', amplitude: STROKE_CONFIG.defaultAmplitude }
  private sides: Record<Side, SideMachine> = { left: fresh(), right: fresh() }
  private cycleCounter = 0
  /** frontal shoulder width: follows widening at once, narrowing only slowly (a turn must not shrink strokes) */
  private widthRef: number | null = null

  configure(options: Partial<StrokeOptions>): void {
    const schemeChanged = options.scheme !== undefined && options.scheme !== this.options.scheme
    this.options = { ...this.options, ...options }
    if (schemeChanged) this.sides = { left: fresh(), right: fresh() }
  }

  /** Stroke length in torso units for the current player. */
  reach(): number {
    return this.options.amplitude * (this.widthRef ?? STROKE_CONFIG.defaultShoulderWidth)
  }

  state(): StrokeState {
    return { options: { ...this.options }, reach: this.reach(), left: this.sideState('left'), right: this.sideState('right') }
  }

  /** Pause / tracking loss: abandon strokes in progress; a hand must come back before the next stroke. */
  cancelAll(timestamp: number, reason: StrokeCancelReason): Pending[] {
    const events: Pending[] = []
    for (const side of ['left', 'right'] as const) {
      const s = this.sides[side]
      if (s.phase === 'out') events.push({ type: 'STROKE_CANCEL', timestamp, side, cycleId: s.cycleId, reason })
      if (s.phase === 'out' || s.phase === 'ready') {
        s.phase = 'return'
        s.peak = s.value ?? s.peak
      }
      s.confirm = 0
    }
    return events
  }

  update(frame: MotionFrame): Pending[] {
    const events: Pending[] = []
    const now = frame.timestamp
    const c = STROKE_CONFIG
    if (frame.leftShoulder && frame.rightShoulder) {
      const width = Math.abs(frame.rightShoulder.x - frame.leftShoulder.x)
      this.widthRef = this.widthRef === null ? width : this.widthRef + (width > this.widthRef ? 0.2 : 0.002) * (width - this.widthRef)
    }
    const reach = this.reach()
    const startBand = c.startBand * (this.widthRef ?? c.defaultShoulderWidth)
    for (const side of ['left', 'right'] as const) {
      const s = this.sides[side]
      const shoulder = side === 'left' ? frame.leftShoulder : frame.rightShoulder
      const wrist = side === 'left' ? frame.leftWrist : frame.rightWrist
      if (!frame.tracking.body || !frame.tracking[side] || !shoulder || !wrist) {
        // tracking loss is never a stroke; the side simply starts over when the hand is back
        if (s.phase === 'out') events.push({ type: 'STROKE_CANCEL', timestamp: now, side, cycleId: s.cycleId, reason: 'tracking-lost' })
        s.phase = 'wait'
        s.value = null
        s.neutral = null
        s.history = []
        s.confirm = 0
        continue
      }
      const v = strokeValue(this.options.scheme, side, shoulder, wrist)
      s.value = v
      s.history.push({ t: now, v })
      while (s.history.length && now - s.history[0].t > c.neutralWindowMs) s.history.shift()
      const overhead = this.options.scheme === 'sweep' && wrist.y < c.overheadY

      if (s.phase === 'wait') {
        // first tracked frame: ready at once, wherever the hand is
        s.neutral = v
        s.phase = 'ready'
        continue
      }
      if (s.phase === 'ready') {
        // neutral = lower envelope of the recent hand positions (adapts to each player and posture)
        s.neutral = Math.min(...s.history.map((h) => h.v))
        if (!overhead && v - s.neutral > startBand) {
          s.phase = 'out'
          s.startedAt = now
          s.peak = v
          s.confirm = 0
          s.cycleId = ++this.cycleCounter
        }
        continue
      }
      const neutral = s.neutral ?? v
      if (s.phase === 'out') {
        s.peak = Math.max(s.peak, v)
        const displacement = v - neutral
        if (overhead) {
          events.push({ type: 'STROKE_CANCEL', timestamp: now, side, cycleId: s.cycleId, reason: 'raised' })
          this.toReturn(s)
          continue
        }
        if (displacement >= reach) {
          s.confirm += 1
          if (s.confirm < c.confirmFrames) continue
          const durationMs = now - s.startedAt
          if (durationMs < c.minCatchMs) {
            events.push({ type: 'STROKE_CANCEL', timestamp: now, side, cycleId: s.cycleId, reason: 'too-fast' })
            this.toReturn(s)
            continue
          }
          s.strokes += 1
          s.lastStrokeAt = now
          this.toReturn(s)
          events.push({ type: side === 'left' ? 'STROKE_LEFT' : 'STROKE_RIGHT', timestamp: now, cycleId: s.cycleId, amplitude: displacement / (this.widthRef ?? c.defaultShoulderWidth), durationMs })
          continue
        }
        s.confirm = 0
        if (displacement < startBand * 0.5) {
          // came back before the stroke line: not a stroke; a real attempt that got close earns a hint
          if (s.peak - neutral >= reach * c.nearMissShare) events.push({ type: 'STROKE_CANCEL', timestamp: now, side, cycleId: s.cycleId, reason: 'too-small' })
          s.phase = 'ready'
        } else if (now - s.startedAt > c.maxOutMs) {
          s.phase = 'ready'
          s.history = [{ t: now, v }]
          s.neutral = v
        }
        continue
      }
      // RETURN: re-arm once the hand has come back toward the body by half a stroke
      s.peak = Math.max(s.peak, v)
      const steadyOut = s.history.length > 1 && now - s.history[0].t >= c.rebaselineMs * 0.9
        && Math.max(...s.history.map((h) => h.v)) - Math.min(...s.history.map((h) => h.v)) < startBand
        && now - s.lastStrokeAt >= c.rebaselineMs
      if (s.peak - v >= reach * c.returnShare || steadyOut) {
        s.phase = 'ready'
        s.history = [{ t: now, v }]
        s.neutral = v
      }
    }
    return events
  }

  private toReturn(s: SideMachine): void {
    s.phase = 'return'
    s.peak = s.value ?? s.peak
    s.confirm = 0
  }

  private sideState(side: Side): StrokeSideState {
    const s = this.sides[side]
    const displacement = s.value !== null && s.neutral !== null ? s.value - s.neutral : null
    // the same measure in every phase, so the track fills going out and drains coming back
    const progress = displacement === null ? 0 : Math.max(0, Math.min(1, displacement / this.reach()))
    return { phase: s.phase, progress, displacement, lastStrokeAt: s.lastStrokeAt, strokes: s.strokes }
  }
}
