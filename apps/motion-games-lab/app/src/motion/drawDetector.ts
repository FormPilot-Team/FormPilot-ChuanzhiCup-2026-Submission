// Archery draw detector. Detector phases (the game adds HIT and RESET around them):
//
//   wait-ready ─(hands together in front of the chest, steady)─▶ ready ─(hands move apart)─▶ draw
//   draw ─(full draw, no guard)─▶ hold ─(steady for holdMs)─▶ armed ─(quick directional return of
//   the string hand)─▶ RELEASE ─▶ cooldown ─▶ wait-ready
//
// Guards (all lab engineering parameters awaiting human playtests):
// - torso rotation: a frontal camera cannot see a twist directly, but the projected shoulder width
//   shrinks; below turnRatio × the player's frontal width (a slow-adapting reference) the draw does
//   not progress.
// - elbow flexion: the bow arm must stay fairly straight; the string-hand elbow must travel outward
//   (a wrist flick produced by elbow bending alone does not count as drawing).
// - hands low: the bow is held at chest/shoulder height.
// A guard that persists for guardCancelMs cancels the attempt (no shot, no penalty). Tracking loss
// cancels immediately: losing the hands is never interpreted as letting go of the string.
// Debounce: the draw must exceed startDelta for startFrames frames; one attemptId releases at most
// once; after a release the hands must return to READY and a cooldown must pass.
// The release is a pose mapping (string hand returns quickly toward the bow hand), not finger
// detection. Draw amount is a wrist-separation proxy, never a horizontal-abduction angle.
import type { DrawCancelReason, DrawGuard, DrawOptions, DrawPhase, DrawState, MotionEvent, MotionFrame, Point, Side } from './contracts'

export const DRAW_CONFIG = Object.freeze({
  /** wrists this close (signed x separation, torso units) count as "hands together" */
  readySpanMax: 0.6,
  readySpanMin: -0.35,
  readyMs: 400,
  /** wrists inside this vertical band (torso units from the shoulder line) = bow at chest height */
  chestTop: -0.45,
  chestBottom: 1.05,
  /** a draw starts once the separation grows this much for startFrames frames */
  startDelta: 0.12,
  startFrames: 2,
  /** separation back within this of the READY separation = the player gave up drawing */
  dropBackDelta: 0.06,
  holdMinRatio: 0.85,
  /** either wrist drifting this far from the hold reference restarts the hold */
  holdDriftMax: 0.14,
  /**
   * either wrist travelling faster than this (torso units / s, net displacement over speedWindowMs)
   * is still drawing: the hold restarts. A net-displacement window ignores a hand tremor.
   */
  holdSpeedMax: 0.6,
  speedWindowMs: 300,
  /** rms bow/string-hand wobble that maps to stability 0 */
  stabilityScale: 0.09,
  stabilityWindowMs: 600,
  /** release = separation drops this much... */
  releaseTravel: 0.22,
  /** ...within this time, mostly by the string hand moving toward the bow */
  releaseWindowMs: 450,
  armedTimeoutMs: 9000,
  attemptTimeoutMs: 20_000,
  cooldownMs: 900,
  turnRatio: 0.8,
  bowElbowMinDeg: 120,
  drawElbowOutMin: 0.08,
  guardCancelMs: 600,
})

type Pending = MotionEvent extends infer E ? (E extends MotionEvent ? Omit<E, 'id' | 'emittedAt'> : never) : never

interface Sample {
  t: number
  span: number
  bow: Point
  draw: Point
}

interface Arms {
  bowWrist: Point
  drawWrist: Point
  bowElbow: Point
  drawElbow: Point
  bowShoulder: Point
  drawShoulder: Point
  shoulderWidth: number
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Interior angle at the elbow (180 = straight arm). */
export function elbowAngleDeg(shoulder: Point, elbow: Point, wrist: Point): number {
  const ax = shoulder.x - elbow.x
  const ay = shoulder.y - elbow.y
  const bx = wrist.x - elbow.x
  const by = wrist.y - elbow.y
  const d = Math.hypot(ax, ay) * Math.hypot(bx, by)
  if (d < 1e-9) return 180
  return (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / d))) * 180) / Math.PI
}

export const DEFAULT_DRAW_OPTIONS: DrawOptions = { drawSide: 'right', drawGoal: 0.6, holdMs: 900 }

export class DrawDetector {
  private options: DrawOptions = { ...DEFAULT_DRAW_OPTIONS }
  private phase: DrawPhase = 'wait-ready'
  private since = 0
  private attemptId = 0
  private attemptCounter = 0
  private readySince: number | null = null
  private readySpan = 0
  /** frontal shoulder width reference: follows widening at once, narrowing only over ~15 s */
  private widthRef = 0
  private drawElbow0: Point = { x: 0, y: 0 }
  private startFrames = 0
  private startedAt = 0
  private holdStart = 0
  private holdRef: { bow: Point; draw: Point } | null = null
  private armedPeak = 0
  private guard: DrawGuard = null
  private guardSince: number | null = null
  private lastAt: number | null = null
  private ratio = 0
  private holdProgress = 0
  private stability = 1
  private aim: Point = { x: 0, y: 0 }
  private samples: Sample[] = []

  configure(options: Partial<DrawOptions>): void {
    const sideChanged = options.drawSide !== undefined && options.drawSide !== this.options.drawSide
    this.options = { ...this.options, ...options }
    if (sideChanged) this.toWaitReady()
  }

  state(): DrawState {
    return {
      options: { ...this.options },
      phase: this.phase,
      attemptId: this.attemptId,
      drawRatio: this.ratio,
      holdProgress: this.holdProgress,
      stability: this.stability,
      aim: { ...this.aim },
      guard: this.guard,
      readyProgress: this.phase === 'wait-ready' && this.readySince !== null && this.lastAt !== null
        ? Math.min(1, (this.lastAt - this.readySince) / DRAW_CONFIG.readyMs)
        : this.phase === 'wait-ready' || this.phase === 'cooldown' ? 0 : 1,
    }
  }

  /** Pause: abandon any attempt; the player starts again from READY. */
  cancelAll(timestamp: number, reason: DrawCancelReason): Pending[] {
    const events: Pending[] = []
    if (this.active()) events.push(this.cancelEvent(timestamp, reason))
    this.toWaitReady()
    return events
  }

  update(frame: MotionFrame): Pending[] {
    const now = frame.timestamp
    const dt = this.lastAt === null ? 0 : now - this.lastAt
    this.lastAt = now
    const arms = this.arms(frame)
    if (!arms) {
      const events = this.active() ? [this.cancelEvent(now, 'tracking-lost')] : []
      if (this.phase !== 'cooldown') this.toWaitReady()
      this.ratio = 0
      return events
    }
    const c = DRAW_CONFIG
    const span = this.span(arms)
    this.widthRef = this.widthRef === 0 ? arms.shoulderWidth : this.widthRef + (arms.shoulderWidth > this.widthRef ? 0.2 : 0.002) * (arms.shoulderWidth - this.widthRef)
    switch (this.phase) {
      case 'cooldown':
        if (now - this.since >= c.cooldownMs) this.toWaitReady()
        return []
      case 'wait-ready':
        return this.updateWaitReady(arms, span, now)
      case 'ready':
        return this.updateReady(arms, span, now)
      default:
        return this.updateActive(arms, span, now, dt)
    }
  }

  private updateWaitReady(arms: Arms, span: number, now: number): Pending[] {
    this.ratio = 0
    if (this.readyPose(arms, span)) {
      this.readySince ??= now
      if (now - this.readySince >= DRAW_CONFIG.readyMs) {
        this.phase = 'ready'
        this.since = now
        this.readySpan = span
        this.drawElbow0 = { ...arms.drawElbow }
        this.startFrames = 0
      }
    } else this.readySince = null
    return []
  }

  private updateReady(arms: Arms, span: number, now: number): Pending[] {
    const c = DRAW_CONFIG
    this.ratio = 0
    if (!this.inChestBand(arms)) {
      this.toWaitReady()
      return []
    }
    // Keep the reference fresh while the hands rest together.
    if (span < this.readySpan) this.readySpan = span
    else if (span - this.readySpan < c.startDelta * 0.5) this.readySpan += 0.1 * (span - this.readySpan)
    if (span - this.readySpan < c.startDelta * 0.5) this.drawElbow0 = { ...arms.drawElbow }
    this.startFrames = span - this.readySpan > c.startDelta ? this.startFrames + 1 : 0
    if (this.startFrames < c.startFrames) return []
    this.phase = 'draw'
    this.since = now
    this.startedAt = now
    this.attemptId = ++this.attemptCounter
    this.guard = null
    this.guardSince = null
    this.samples = []
    return [{ type: 'DRAW_START', timestamp: now, side: this.options.drawSide, attemptId: this.attemptId }]
  }

  private updateActive(arms: Arms, span: number, now: number, dt: number): Pending[] {
    const c = DRAW_CONFIG
    const side = this.options.drawSide
    this.ratio = Math.max(0, (span - this.readySpan) / this.options.drawGoal)
    const back = this.samples.find((s) => now - s.t <= c.speedWindowMs)
    const speed = back && now - back.t >= c.speedWindowMs * 0.5
      ? (Math.max(dist(arms.bowWrist, back.bow), dist(arms.drawWrist, back.draw)) * 1000) / (now - back.t)
      : 0
    this.samples.push({ t: now, span, bow: { ...arms.bowWrist }, draw: { ...arms.drawWrist } })
    while (this.samples.length && now - this.samples[0].t > Math.max(c.stabilityWindowMs, c.releaseWindowMs) + 200) this.samples.shift()

    if (now - this.startedAt > c.attemptTimeoutMs) return this.cancel(now, 'timeout')
    const guard = this.evaluateGuard(arms)
    this.guard = guard
    if (guard) {
      this.guardSince ??= now
      if (now - this.guardSince >= c.guardCancelMs) return this.cancel(now, guard)
    } else this.guardSince = null

    if (this.phase === 'draw') {
      if (span - this.readySpan < c.dropBackDelta) return this.cancel(now, 'lowered')
      if (this.ratio >= 1 && !guard) {
        this.phase = 'hold'
        this.since = now
        this.holdStart = now
        this.holdProgress = 0
        this.holdRef = { bow: { ...arms.bowWrist }, draw: { ...arms.drawWrist } }
        return [{ type: 'DRAW_HOLD', timestamp: now, side, attemptId: this.attemptId, progress: 0, stability: this.stability }]
      }
      return []
    }

    const ref = this.holdRef!
    this.aim = { x: arms.bowWrist.x - ref.bow.x, y: arms.bowWrist.y - ref.bow.y }
    this.stability = this.steadiness(now)

    if (this.phase === 'hold') {
      if (this.ratio < c.holdMinRatio) {
        this.phase = 'draw'
        this.holdProgress = 0
        return []
      }
      if (guard) {
        this.holdStart += dt // a guard pauses the hold instead of counting it
      } else if (speed > c.holdSpeedMax || Math.max(dist(arms.bowWrist, ref.bow), dist(arms.drawWrist, ref.draw)) > c.holdDriftMax) {
        // still settling (or drifted away): the aim reference follows, the hold starts over
        this.holdRef = { bow: { ...arms.bowWrist }, draw: { ...arms.drawWrist } }
        this.holdStart = now
        this.aim = { x: 0, y: 0 }
        this.stability = 1
      }
      this.holdProgress = Math.max(0, Math.min(1, (now - this.holdStart) / this.options.holdMs))
      if (this.holdProgress < 1) return []
      this.phase = 'armed'
      this.since = now
      this.armedPeak = span
      return [{ type: 'DRAW_HOLD', timestamp: now, side, attemptId: this.attemptId, progress: 1, stability: this.stability }]
    }

    // armed: wait for a quick, directional return of the string hand
    this.holdProgress = 1
    if (now - this.since > c.armedTimeoutMs) return this.cancel(now, 'timeout')
    this.armedPeak = Math.max(this.armedPeak, span)
    const recent = this.samples.filter((s) => now - s.t <= c.releaseWindowMs)
    const peakSample = recent.reduce((best, s) => (s.span > best.span ? s : best), recent[0])
    const quickDrop = peakSample.span - span
    if (quickDrop >= c.releaseTravel && !guard) {
      const out = side === 'right' ? 1 : -1
      const drawMove = out * (peakSample.draw.x - arms.drawWrist.x)
      if (drawMove >= quickDrop * 0.5) {
        const holdStability = this.steadiness(peakSample.t)
        const aim = { x: peakSample.bow.x - ref.bow.x, y: peakSample.bow.y - ref.bow.y }
        const drawAmount = this.armedPeak - this.readySpan
        const event: Pending = {
          type: 'RELEASE', timestamp: now, side, attemptId: this.attemptId, drawAmount, holdStability,
          drawRatio: drawAmount / this.options.drawGoal, aim, releaseMs: now - peakSample.t,
        }
        this.phase = 'cooldown'
        this.since = now
        this.holdRef = null
        return [event]
      }
    }
    // the separation sank slowly instead of snapping back: the bow was lowered, no shot
    if (this.armedPeak - span >= c.releaseTravel && quickDrop < c.releaseTravel * 0.6) return this.cancel(now, 'lowered')
    return []
  }

  /** 1 = steady. RMS wobble of both wrists over the window ending at `until`. */
  private steadiness(until: number): number {
    const c = DRAW_CONFIG
    const window = this.samples.filter((s) => s.t <= until && until - s.t <= c.stabilityWindowMs && s.t >= this.holdStart - 1)
    // too few settled samples yet (the hold just (re)started): nothing to judge, assume steady
    if (window.length < 3) return 1
    const rms = (points: Point[]) => {
      const mx = points.reduce((a, p) => a + p.x, 0) / points.length
      const my = points.reduce((a, p) => a + p.y, 0) / points.length
      return Math.sqrt(points.reduce((a, p) => a + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / points.length)
    }
    const wobble = Math.max(rms(window.map((s) => s.bow)), 0.6 * rms(window.map((s) => s.draw)))
    return Math.max(0, Math.min(1, 1 - wobble / c.stabilityScale))
  }

  private evaluateGuard(arms: Arms): DrawGuard {
    const c = DRAW_CONFIG
    if (this.widthRef > 0 && arms.shoulderWidth < this.widthRef * c.turnRatio) return 'turned'
    if (arms.bowWrist.y > c.chestBottom + 0.1 && arms.drawWrist.y > c.chestBottom + 0.1) return 'hands-low'
    if (this.ratio >= 0.6 && elbowAngleDeg(arms.bowShoulder, arms.bowElbow, arms.bowWrist) < c.bowElbowMinDeg) return 'bow-arm-bent'
    const out = this.options.drawSide === 'right' ? 1 : -1
    if (this.ratio >= 0.8 && out * (arms.drawElbow.x - this.drawElbow0.x) < c.drawElbowOutMin) return 'elbow-only'
    return null
  }

  private readyPose(arms: Arms, span: number): boolean {
    const c = DRAW_CONFIG
    return span <= c.readySpanMax && span >= c.readySpanMin && this.inChestBand(arms)
  }

  private inChestBand(arms: Arms): boolean {
    const c = DRAW_CONFIG
    const ok = (p: Point) => p.y >= c.chestTop && p.y <= c.chestBottom
    return ok(arms.bowWrist) && ok(arms.drawWrist)
  }

  /** Signed separation along x: grows when the string hand moves to its own side, away from the bow hand. */
  private span(arms: Arms): number {
    const out = this.options.drawSide === 'right' ? 1 : -1
    return out * (arms.drawWrist.x - arms.bowWrist.x)
  }

  private arms(frame: MotionFrame): Arms | null {
    const draw: Side = this.options.drawSide
    const pick = (side: Side) => side === 'left'
      ? { wrist: frame.leftWrist, elbow: frame.leftElbow, shoulder: frame.leftShoulder }
      : { wrist: frame.rightWrist, elbow: frame.rightElbow, shoulder: frame.rightShoulder }
    if (!frame.tracking.body || !frame.tracking.left || !frame.tracking.right) return null
    const d = pick(draw)
    const b = pick(draw === 'left' ? 'right' : 'left')
    if (!d.wrist || !d.elbow || !d.shoulder || !b.wrist || !b.elbow || !b.shoulder) return null
    return {
      drawWrist: d.wrist, drawElbow: d.elbow, drawShoulder: d.shoulder,
      bowWrist: b.wrist, bowElbow: b.elbow, bowShoulder: b.shoulder,
      shoulderWidth: Math.abs(d.shoulder.x - b.shoulder.x),
    }
  }

  private active(): boolean {
    return this.phase === 'draw' || this.phase === 'hold' || this.phase === 'armed'
  }

  private cancel(now: number, reason: DrawCancelReason): Pending[] {
    const event = this.cancelEvent(now, reason)
    this.toWaitReady()
    return [event]
  }

  private cancelEvent(now: number, reason: DrawCancelReason): Pending {
    return { type: 'DRAW_CANCEL', timestamp: now, side: this.options.drawSide, attemptId: this.attemptId, reason }
  }

  private toWaitReady(): void {
    this.phase = 'wait-ready'
    this.readySince = null
    this.holdRef = null
    this.holdProgress = 0
    this.ratio = 0
    this.guard = null
    this.guardSince = null
    this.samples = []
    this.stability = 1
    this.aim = { x: 0, y: 0 }
  }
}
