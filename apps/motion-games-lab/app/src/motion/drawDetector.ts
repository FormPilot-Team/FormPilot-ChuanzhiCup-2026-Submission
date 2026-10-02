// Archery draw detector. Detector phases (the game adds HIT and RESET around them):
//
//   wait-ready ─(hands together in front of the chest, steady)─▶ ready ─(hands move apart)─▶ draw
//   draw ─(full draw)─▶ hold ─(steady for holdMs)─▶ armed ─(confirmed snap back of the string hand)─▶
//   RELEASE ─▶ cooldown ─▶ wait-ready
//
// Round-1 playtest fixes:
// 1. RELEASE is judged against the CONFIRMED peak draw, never a single frame. Both wrists are
//    median-filtered over three frames (so is every hold / drift / speed check); the peak is the highest filtered draw since HOLD began; a release
//    needs the filtered draw to fall below `peak − releaseTravel` on `releaseConfirmFrames` consecutive
//    frames spanning `releaseConfirmMs`, and it must happen within `releaseWindowMs` of leaving the peak
//    (a slow sink is lowering the bow, not letting go). Coming back above `peak − releaseTravel / 2`
//    resets the confirmation (hysteresis). Only an ARMED attempt (HOLD fully held = minimum hold time)
//    can release; one attempt releases at most once; a cooldown follows. Before: the "peak" was the
//    single highest raw sample of the last 450 ms, so one noisy frame (common when the string hand is
//    near the face) looked like a 0.22 drop and fired the arrow while the player was still drawing.
// 2. Guards no longer act on a single frame. A condition must persist (`guardSustainMs` for the elbow
//    checks, `postureSustainMs` for turned / hands low) before it becomes a guard; a guard pauses the hold instead of cancelling. Only "turned" / "hands low" cancel,
//    and only after persisting a further `guardCancelMs`. The bow-arm check is tiered: a mildly bent arm
//    only earns a soft hint (`hint`), a clearly bent arm held for 700 ms pauses the hold — before, any
//    2D elbow angle under 120° (perspective alone produces that) blocked and then cancelled the shot.
// Tracking loss cancels at once: losing the hands is never interpreted as letting go of the string.
// The release is a pose mapping (string hand returns quickly toward the bow hand), not finger detection.
// The draw amount is a wrist-separation proxy, never a horizontal-abduction angle.
// All values are lab engineering parameters awaiting more playtests.
import type { DrawCancelReason, DrawGuard, DrawHint, DrawOptions, DrawPhase, DrawState, MotionEvent, MotionFrame, Point, Side } from './contracts'

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
  /** release = the filtered draw falls this far below its confirmed peak (torso units, at least)… */
  releaseTravel: 0.2,
  /** …or this share of the draw goal, whichever is larger */
  releaseTravelShare: 0.3,
  /** …on this many consecutive frames, spanning at least this long… */
  releaseConfirmFrames: 2,
  releaseConfirmMs: 50,
  /** …within this time after the draw left its peak (slower = the bow was lowered: no shot) */
  releaseWindowMs: 450,
  /** "at the peak" band used to time the release (torso units below the peak) */
  peakBand: 0.06,
  armedTimeoutMs: 9000,
  attemptTimeoutMs: 20_000,
  cooldownMs: 900,
  /** a torso turn: projected shoulder width below this share of the frontal width (unchanged since Stage C–E) */
  turnRatio: 0.8,
  /** bow arm (2D elbow angle, deg): at or above `bowArmOkDeg` fine; below it a soft hint; below `bowArmBentDeg` a guard */
  bowArmOkDeg: 125,
  bowArmBentDeg: 95,
  /** the bow-arm check only applies once the bow is mostly drawn (the arm is extended by then) */
  bowArmFromRatio: 0.6,
  /** the string elbow must travel at least this far outward over a full draw, else "elbow-only" */
  drawElbowOutMin: 0.04,
  /** an elbow condition (bow arm bent, elbow-only draw) must persist this long before it pauses the hold */
  guardSustainMs: 700,
  /** a posture condition (turned, hands low) must persist this long (single frames never count) */
  postureSustainMs: 400,
  /** turned / hands-low: persisting this much longer cancels the attempt (no shot, no penalty) */
  guardCancelMs: 800,
})

type Pending = MotionEvent extends infer E ? (E extends MotionEvent ? Omit<E, 'id' | 'emittedAt'> : never) : never

interface Sample {
  t: number
  /** median-filtered separation */
  span: number
  /** unfiltered separation of this frame */
  raw: number
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
const median3 = (values: number[]) => {
  if (values.length < 3) return values[values.length - 1]
  const [a, b, c] = values.slice(-3)
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
}

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

type GuardKind = Exclude<DrawGuard, null>

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
  private guard: DrawGuard = null
  private hint: DrawHint = null
  /** when each raw guard condition started (it only becomes a guard after guardSustainMs) */
  private conditionSince: Partial<Record<GuardKind, number>> = {}
  private guardSince: number | null = null
  private bowAngle: number | null = null
  private lastAt: number | null = null
  private lastRawSpan = 0
  private ratio = 0
  private holdProgress = 0
  private stability = 1
  private aim: Point = { x: 0, y: 0 }
  private samples: Sample[] = []
  /** last three wrist pairs: every judgement uses their per-coordinate median, so one glitched frame never counts */
  private wrists: { bow: Point; draw: Point }[] = []
  // release confirmation
  private peak = 0
  private peakSample: Sample | null = null
  private nearPeakAt = 0
  /** last sample still at the peak: aim and steadiness are read here, just before the release */
  private nearPeakSample: Sample | null = null
  private releaseFrames = 0
  private releaseSince: number | null = null

  configure(options: Partial<DrawOptions>): void {
    const sideChanged = options.drawSide !== undefined && options.drawSide !== this.options.drawSide
    this.options = { ...this.options, ...options }
    if (sideChanged) this.toWaitReady()
  }

  /** Drop below the confirmed peak that counts as letting go (torso units). */
  releaseTravel(): number {
    return Math.max(DRAW_CONFIG.releaseTravel, DRAW_CONFIG.releaseTravelShare * this.options.drawGoal)
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
      hint: this.hint,
      readyProgress: this.phase === 'wait-ready' && this.readySince !== null && this.lastAt !== null
        ? Math.min(1, (this.lastAt - this.readySince) / DRAW_CONFIG.readyMs)
        : this.phase === 'wait-ready' || this.phase === 'cooldown' ? 0 : 1,
      peakRatio: this.peak > 0 ? (this.peak - this.readySpan) / this.options.drawGoal : 0,
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
    const rawArms = this.arms(frame)
    if (!rawArms) {
      // tracking loss: cancel, never a release
      const events = this.active() ? [this.cancelEvent(now, 'tracking-lost')] : []
      if (this.phase !== 'cooldown') this.toWaitReady()
      this.ratio = 0
      this.wrists = []
      return events
    }
    this.wrists.push({ bow: rawArms.bowWrist, draw: rawArms.drawWrist })
    if (this.wrists.length > 3) this.wrists.shift()
    const med = (pick: (w: { bow: Point; draw: Point }) => number) => median3(this.wrists.map(pick))
    const arms: Arms = {
      ...rawArms,
      bowWrist: { x: med((w) => w.bow.x), y: med((w) => w.bow.y) },
      drawWrist: { x: med((w) => w.draw.x), y: med((w) => w.draw.y) },
    }
    this.lastRawSpan = this.span(rawArms)
    const span = this.span(arms)
    this.widthRef = this.widthRef === 0 ? arms.shoulderWidth : this.widthRef + (arms.shoulderWidth > this.widthRef ? 0.2 : 0.002) * (arms.shoulderWidth - this.widthRef)
    const angle = elbowAngleDeg(arms.bowShoulder, arms.bowElbow, arms.bowWrist)
    this.bowAngle = this.bowAngle === null ? angle : this.bowAngle + 0.35 * (angle - this.bowAngle)
    switch (this.phase) {
      case 'cooldown':
        if (now - this.since >= DRAW_CONFIG.cooldownMs) this.toWaitReady()
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
    this.hint = null
    this.conditionSince = {}
    this.guardSince = null
    this.samples = []
    this.peak = 0
    this.peakSample = null
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
    const sample: Sample = { t: now, span, raw: this.lastRawSpan, bow: { ...arms.bowWrist }, draw: { ...arms.drawWrist } }
    this.samples.push(sample)
    while (this.samples.length && now - this.samples[0].t > Math.max(c.stabilityWindowMs, c.releaseWindowMs) + 300) this.samples.shift()

    if (now - this.startedAt > c.attemptTimeoutMs) return this.cancel(now, 'timeout')
    const guard = this.evaluateGuard(arms, now)
    this.guard = guard
    if (guard === 'turned' || guard === 'hands-low') {
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
        this.trackPeak(sample, true)
        return [{ type: 'DRAW_HOLD', timestamp: now, side, attemptId: this.attemptId, progress: 0, stability: this.stability }]
      }
      return []
    }

    const ref = this.holdRef!
    this.aim = { x: arms.bowWrist.x - ref.bow.x, y: arms.bowWrist.y - ref.bow.y }
    this.stability = this.steadiness(now)

    if (this.phase === 'hold') {
      this.trackPeak(sample, false)
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
      this.releaseFrames = 0
      this.releaseSince = null
      return [{ type: 'DRAW_HOLD', timestamp: now, side, attemptId: this.attemptId, progress: 1, stability: this.stability }]
    }

    // ARMED: wait for a confirmed, quick snap back below the confirmed peak
    this.holdProgress = 1
    if (now - this.since > c.armedTimeoutMs) return this.cancel(now, 'timeout')
    this.trackPeak(sample, false)
    const travel = this.releaseTravel()
    const below = span < this.peak - travel
    if (below) {
      this.releaseFrames += 1
      this.releaseSince ??= now
    } else if (span > this.peak - travel * 0.5) {
      this.releaseFrames = 0
      this.releaseSince = null
    }
    if (!below || this.releaseFrames < c.releaseConfirmFrames || now - (this.releaseSince ?? now) < c.releaseConfirmMs) return []
    const peakSample = this.nearPeakSample ?? this.peakSample ?? sample
    // the string hand (not the bow hand) must have done most of the travel, toward the bow
    const out = side === 'right' ? 1 : -1
    const drawMove = out * (peakSample.draw.x - arms.drawWrist.x)
    const quick = (this.releaseSince ?? now) - this.nearPeakAt <= c.releaseWindowMs
    if (!quick) return this.cancel(now, 'lowered') // a slow sink: the bow was lowered, no shot
    if (guard || drawMove < (this.peak - span) * 0.5) {
      // not a release (e.g. the bow hand dropped); start counting again from here
      this.releaseFrames = 0
      this.releaseSince = null
      return []
    }
    const holdStability = this.steadiness(peakSample.t)
    const aim = { x: peakSample.bow.x - ref.bow.x, y: peakSample.bow.y - ref.bow.y }
    const drawAmount = this.peak - this.readySpan
    const event: Pending = {
      type: 'RELEASE', timestamp: now, side, attemptId: this.attemptId, drawAmount, holdStability,
      drawRatio: drawAmount / this.options.drawGoal, aim, releaseMs: now - this.nearPeakAt,
    }
    this.phase = 'cooldown'
    this.since = now
    this.holdRef = null
    this.peak = 0
    this.peakSample = null
    return [event]
  }

  /**
   * Confirmed peak = highest median-filtered draw since HOLD began. nearPeakAt / nearPeakSample = the
   * last frame whose own (unfiltered) draw was still at the peak — the moment just before letting go,
   * where aim and steadiness are read (the median lags a frame and would already include the snap).
   */
  private trackPeak(sample: Sample, reset: boolean): void {
    if (reset || sample.span >= this.peak) {
      this.peak = sample.span
      this.peakSample = sample
    }
    if (sample.raw >= this.peak - DRAW_CONFIG.peakBand) {
      this.nearPeakAt = sample.t
      this.nearPeakSample = sample
    }
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

  /** Raw conditions → a guard only once one has persisted `guardSustainMs`; also sets the soft hint. */
  private evaluateGuard(arms: Arms, now: number): DrawGuard {
    const c = DRAW_CONFIG
    const out = this.options.drawSide === 'right' ? 1 : -1
    const angle = this.bowAngle ?? 180
    const armRelevant = this.ratio >= c.bowArmFromRatio
    const conditions: Record<GuardKind, boolean> = {
      turned: this.widthRef > 0 && arms.shoulderWidth < this.widthRef * c.turnRatio,
      'hands-low': arms.bowWrist.y > c.chestBottom + 0.1 && arms.drawWrist.y > c.chestBottom + 0.1,
      'bow-arm-bent': armRelevant && angle < c.bowArmBentDeg,
      'elbow-only': this.ratio >= 0.8 && out * (arms.drawElbow.x - this.drawElbow0.x) < c.drawElbowOutMin,
    }
    this.hint = armRelevant && angle < c.bowArmOkDeg && !conditions['bow-arm-bent'] ? 'bow-arm-straighter' : null
    let active: DrawGuard = null
    for (const kind of ['turned', 'hands-low', 'bow-arm-bent', 'elbow-only'] as const) {
      if (!conditions[kind]) {
        delete this.conditionSince[kind]
        continue
      }
      const since = (this.conditionSince[kind] ??= now)
      const sustain = kind === 'turned' || kind === 'hands-low' ? c.postureSustainMs : c.guardSustainMs
      if (active === null && now - since >= sustain) active = kind
    }
    return active
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
    this.hint = null
    this.conditionSince = {}
    this.guardSince = null
    this.samples = []
    this.stability = 1
    this.aim = { x: 0, y: 0 }
    this.peak = 0
    this.peakSample = null
    this.nearPeakSample = null
    this.releaseFrames = 0
    this.releaseSince = null
  }
}
