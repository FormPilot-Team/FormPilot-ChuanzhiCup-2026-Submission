// Archery draw detector. Detector phases (the game adds FIRE / HIT / RESET around them):
//
//   wait-ready ─(hands together in front of the chest, steady)─▶ ready ─(hands move apart)─▶ draw
//   draw ─(drawn apart, string hand out)─▶ hold ─(string hand settled for holdMs)─▶ armed (RETURN_ARMED)
//   armed ─(string hand brought clearly back toward the chest)─▶ FIRE ─▶ cooldown ─▶ wait-ready
//
// Final playtest redesign (round 2): the shot is no longer a "quick let-go of the string". Players did
// not understand it and could not fire a single arrow in three tries, and pose landmarks cannot see
// fingers anyway. The shot is now an explicit, slow-or-fast gesture: after the hold, bring the string
// hand back toward the chest. It fires once the string hand has come back `returnShare` of the way from
// its drawn position to where it started at READY (or `returnBaseMin`, whichever is larger) on
// `returnConfirmFrames` consecutive frames. No speed, no time window, no trajectory beyond "mostly
// sideways, not dropping the arm".
//
// The bow hand is the aiming input and is never a blocking condition: its height (relative to the bow
// shoulder) moves the reticle up and down. Sideways is deliberately not mapped: in the side-on range a
// sideways bow-hand move is pushing toward the target (no natural left / right), and the bow arm is
// often still extending when the hold begins, so a sideways reference made unexplained misses. The elbow
// angle of the bow arm, a slightly turned torso, a moving bow hand — none of them pause, reset or
// cancel anything any more; at most a soft hint after they have persisted. What still protects the
// game: no shot without DRAW → HOLD; hold jitter never fires (only a settled return does); tracking
// loss cancels; one shot per draw; READY again before the next draw; arms dropped to the sides (both
// hands far below the chest) cannot be a draw.
//
// The aim is locked when the return begins (the last frame before the string hand started to come
// back), so the move that fires the arrow cannot drag the reticle away.
// The draw amount is a wrist-separation proxy, never a horizontal-abduction angle.
// All values are lab engineering parameters awaiting the final playtest.
import type { DrawCancelReason, DrawCue, DrawGuard, DrawHint, DrawOptions, DrawPhase, DrawState, MotionEvent, MotionFrame, Point, Side } from './contracts'

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
  /** the hold needs the bow drawn to at least this share of the goal (stays held down to holdMinRatio) */
  holdMinRatio: 0.75,
  /** the string hand must be at least this far out from its READY position (torso units) — it has to have somewhere to come back from */
  drawHandOutMin: 0.15,
  /** show "pull the string hand out too" after the bow is drawn this long without it */
  pullOutCueMs: 600,
  /** after an early return, "wait for the circle" stays the instruction this long */
  earlyCueMs: 1800,
  /**
   * string hand travelling faster than this (torso units / s, net displacement over speedWindowMs) is
   * still moving: the hold timer pauses (it is never reset). The bow hand is free to aim.
   */
  holdSpeedMax: 0.6,
  speedWindowMs: 300,
  /** detrended rms bow-hand wobble that maps to stability 0 (a slow, deliberate aiming glide is not wobble) */
  stabilityScale: 0.07,
  stabilityWindowMs: 600,
  /** FIRE: the string hand has come back this share of the way from its drawn position to its READY position… */
  returnShare: 0.4,
  /** …measured against at least this distance (torso units), so a short draw still needs a clear move… */
  returnBaseMin: 0.3,
  /** …on this many consecutive frames */
  returnConfirmFrames: 3,
  /** from this share of the way the return has begun: the aim locks, the guide hides */
  returnStartShare: 0.12,
  /** the locked aim = mean aim over this window ending at the return onset (last frame the string hand was within returnOnsetBand of its peak) */
  aimLockWindowMs: 200,
  returnOnsetBand: 0.02,
  /** the return must be mostly sideways: vertical travel ≤ ratio × sideways travel + slack (a dropped arm is no shot) */
  returnVerticalRatio: 1.2,
  returnVerticalSlack: 0.1,
  /** aim: bow wrist this far below the bow shoulder (torso units) is dead centre */
  aimRefBelowShoulder: 0.05,
  armedTimeoutMs: 15_000,
  attemptTimeoutMs: 30_000,
  cooldownMs: 900,
  /**
   * both wrists lower than this (torso units below the shoulder line; arms hanging at the sides are at
   * ~0.95) = arms down, not a bow: no HOLD, no FIRE. Without it, dropping the arms from READY looks like
   * a full draw and raising them again like a return.
   */
  handsLowY: 0.78,
  /** hands-low must persist this long before it counts (single frames never do)… */
  postureSustainMs: 400,
  /** …and this much longer to end the attempt ("put the bow down": no shot, no penalty) */
  loweredCancelMs: 1000,
  /** soft hints only (they never change the state machine): a projected shoulder width below this share of the frontal width… */
  turnRatio: 0.8,
  /** …or a bow arm bent below this 2D elbow angle (deg)… */
  bowArmSoftDeg: 80,
  /** …persisting this long */
  softHintSustainMs: 3000,
})

type Pending = MotionEvent extends infer E ? (E extends MotionEvent ? Omit<E, 'id' | 'emittedAt'> : never) : never

interface Sample {
  t: number
  /** median-filtered separation */
  span: number
  bow: Point
  /** string wrist, median-filtered then lightly smoothed */
  draw: Point
  aim: Point
}

interface Arms {
  bowWrist: Point
  drawWrist: Point
  bowElbow: Point
  bowShoulder: Point
  shoulderWidth: number
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
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

/** RMS distance of points from their own least-squares straight-line trend over time. */
export function detrendedRms(samples: readonly { t: number; p: Point }[]): number {
  const n = samples.length
  if (n < 3) return 0
  const mt = samples.reduce((a, s) => a + s.t, 0) / n
  const mx = samples.reduce((a, s) => a + s.p.x, 0) / n
  const my = samples.reduce((a, s) => a + s.p.y, 0) / n
  const vt = samples.reduce((a, s) => a + (s.t - mt) ** 2, 0)
  const bx = vt > 0 ? samples.reduce((a, s) => a + (s.t - mt) * (s.p.x - mx), 0) / vt : 0
  const by = vt > 0 ? samples.reduce((a, s) => a + (s.t - mt) * (s.p.y - my), 0) / vt : 0
  const sq = samples.reduce((a, s) => a + (s.p.x - mx - bx * (s.t - mt)) ** 2 + (s.p.y - my - by * (s.t - mt)) ** 2, 0)
  return Math.sqrt(sq / n)
}

export const DEFAULT_DRAW_OPTIONS: DrawOptions = { drawSide: 'right', drawGoal: 0.6, holdMs: 700 }

export class DrawDetector {
  private options: DrawOptions = { ...DEFAULT_DRAW_OPTIONS }
  private phase: DrawPhase = 'wait-ready'
  private since = 0
  private attemptId = 0
  private attemptCounter = 0
  private readySince: number | null = null
  private readySpan = 0
  /** string-hand x at READY: where "back to the chest" is */
  private readyDrawX = 0
  /** frontal shoulder width reference (soft "turned" hint only): follows widening at once, narrowing over ~15 s */
  private widthRef = 0
  private startFrames = 0
  private startedAt = 0
  private holdStart = 0
  private guard: DrawGuard = null
  private hint: DrawHint = null
  private cue: DrawCue = null
  private earlyAt: number | null = null
  /** after an early return: the lowest the string hand came back to (it must be pulled out again from there) */
  private rePullFrom: number | null = null
  private handsLowSince: number | null = null
  private bowArmSince: number | null = null
  private turnedSince: number | null = null
  private pullOutSince: number | null = null
  private bowAngle: number | null = null
  private lastAt: number | null = null
  private ratio = 0
  private holdProgress = 0
  private stability = 1
  private aim: Point = { x: 0, y: 0 }
  private samples: Sample[] = []
  /** last three wrist pairs: every judgement uses their per-coordinate median, so one glitched frame never counts */
  private wrists: { bow: Point; draw: Point }[] = []
  private drawSmooth: Point | null = null
  // return → fire
  /** most outward string-hand sample since HOLD (in hold) / since ARMED (in armed) */
  private peak: Sample | null = null
  private lock: { aim: Point; stability: number; span: number; at: number } | null = null
  private returnProgress = 0
  private returnFrames = 0

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
      lockedAim: this.lock ? { ...this.lock.aim } : null,
      returnProgress: this.phase === 'armed' ? clamp(this.returnProgress / DRAW_CONFIG.returnShare, 0, 1) : 0,
      returning: this.phase === 'armed' && this.lock !== null,
      armedMs: this.phase === 'armed' && this.lastAt !== null ? this.lastAt - this.since : 0,
      guard: this.guard,
      hint: this.hint,
      cue: this.cue,
      bowElbowDeg: this.bowAngle,
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
    const rawArms = this.arms(frame)
    if (!rawArms) {
      // tracking loss: cancel, never a shot
      const events = this.active() ? [this.cancelEvent(now, 'tracking-lost')] : []
      if (this.phase !== 'cooldown') this.toWaitReady()
      this.ratio = 0
      this.wrists = []
      this.drawSmooth = null
      return events
    }
    this.wrists.push({ bow: rawArms.bowWrist, draw: rawArms.drawWrist })
    if (this.wrists.length > 3) this.wrists.shift()
    const med = (pick: (w: { bow: Point; draw: Point }) => number) => median3(this.wrists.map(pick))
    const drawMed = { x: med((w) => w.draw.x), y: med((w) => w.draw.y) }
    this.drawSmooth = this.drawSmooth ? { x: this.drawSmooth.x + 0.5 * (drawMed.x - this.drawSmooth.x), y: this.drawSmooth.y + 0.5 * (drawMed.y - this.drawSmooth.y) } : drawMed
    const arms: Arms = { ...rawArms, bowWrist: { x: med((w) => w.bow.x), y: med((w) => w.bow.y) }, drawWrist: { ...this.drawSmooth } }
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
        this.readyDrawX = arms.drawWrist.x
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
    if (span - this.readySpan < c.startDelta * 0.5) this.readyDrawX = arms.drawWrist.x
    this.startFrames = span - this.readySpan > c.startDelta ? this.startFrames + 1 : 0
    if (this.startFrames < c.startFrames) return []
    this.phase = 'draw'
    this.since = now
    this.startedAt = now
    this.attemptId = ++this.attemptCounter
    this.resetAttempt()
    return [{ type: 'DRAW_START', timestamp: now, side: this.options.drawSide, attemptId: this.attemptId }]
  }

  private updateActive(arms: Arms, span: number, now: number, dt: number): Pending[] {
    const c = DRAW_CONFIG
    const side = this.options.drawSide
    const out = side === 'right' ? 1 : -1
    this.ratio = Math.max(0, (span - this.readySpan) / this.options.drawGoal)
    // string-hand speed only (net displacement over the window): the bow hand is free to aim
    const back = this.samples.find((s) => now - s.t <= c.speedWindowMs)
    const drawSpeed = back && now - back.t >= c.speedWindowMs * 0.5 ? (dist(arms.drawWrist, back.draw) * 1000) / (now - back.t) : 0
    this.aim = this.aimOf(arms)
    const sample: Sample = { t: now, span, bow: { ...arms.bowWrist }, draw: { ...arms.drawWrist }, aim: { ...this.aim } }
    this.samples.push(sample)
    while (this.samples.length && now - this.samples[0].t > c.stabilityWindowMs + 300) this.samples.shift()
    this.updateHints(arms, now)

    if (now - this.startedAt > c.attemptTimeoutMs) return this.cancel(now, 'timeout')
    // arms dropped to the sides: not a bow. Pauses the hold, blocks FIRE, and after a while ends the attempt.
    const low = arms.bowWrist.y > c.handsLowY && arms.drawWrist.y > c.handsLowY
    this.handsLowSince = low ? this.handsLowSince ?? now : null
    this.guard = this.handsLowSince !== null && now - this.handsLowSince >= c.postureSustainMs ? 'hands-low' : null
    if (this.guard && now - this.handsLowSince! >= c.postureSustainMs + c.loweredCancelMs) return this.cancel(now, 'lowered')

    const drawOut = out * (arms.drawWrist.x - this.readyDrawX)
    if (this.phase === 'draw') {
      if (span - this.readySpan < c.dropBackDelta) return this.cancel(now, this.earlyAt !== null ? 'early-return' : 'lowered')
      const drawn = this.ratio >= 1
      if (this.rePullFrom !== null) this.rePullFrom = Math.min(this.rePullFrom, drawOut)
      const handOut = drawOut >= c.drawHandOutMin && (this.rePullFrom === null || drawOut >= this.rePullFrom + c.drawHandOutMin)
      this.pullOutSince = drawn && !handOut ? this.pullOutSince ?? now : null
      this.cue = this.earlyAt !== null && now - this.earlyAt < c.earlyCueMs ? 'early-return'
        : this.pullOutSince !== null && now - this.pullOutSince >= c.pullOutCueMs ? 'pull-string-out' : null
      if (!drawn || !handOut || low) return []
      this.phase = 'hold'
      this.since = now
      this.holdStart = now
      this.holdProgress = 0
      this.cue = null
      this.pullOutSince = null
      this.rePullFrom = null
      this.peak = sample
      return [{ type: 'DRAW_HOLD', timestamp: now, side, attemptId: this.attemptId, progress: 0, stability: this.stability }]
    }

    if (out * (sample.draw.x - this.peak!.draw.x) >= 0) this.peak = sample
    const base = Math.max(c.returnBaseMin, out * (this.peak!.draw.x - this.readyDrawX))
    this.returnProgress = Math.max(0, out * (this.peak!.draw.x - sample.draw.x)) / base

    if (this.phase === 'hold') {
      this.stability = this.steadiness(now)
      if (this.returnProgress >= c.returnShare) {
        // brought back before the hold was complete: no shot, draw again
        this.phase = 'draw'
        this.since = now
        this.holdProgress = 0
        this.returnProgress = 0
        this.earlyAt = now
        this.rePullFrom = out * (sample.draw.x - this.readyDrawX)
        this.cue = 'early-return'
        this.peak = null
        return []
      }
      if (this.ratio < c.holdMinRatio) {
        this.phase = 'draw'
        this.holdProgress = 0
        this.returnProgress = 0
        this.peak = null
        return []
      }
      // the hold timer runs while the string hand is settled; it pauses (never resets) otherwise
      if (low || drawSpeed > c.holdSpeedMax) this.holdStart += dt
      this.holdProgress = clamp((now - this.holdStart) / this.options.holdMs, 0, 1)
      if (this.holdProgress < 1) return []
      this.phase = 'armed'
      this.since = now
      this.peak = sample
      this.lock = null
      this.returnProgress = 0
      this.returnFrames = 0
      return [{ type: 'DRAW_HOLD', timestamp: now, side, attemptId: this.attemptId, progress: 1, stability: this.stability }]
    }

    // RETURN_ARMED: wait for the string hand to come back toward the chest
    this.holdProgress = 1
    if (now - this.since > c.armedTimeoutMs) return this.cancel(now, 'timeout')
    if (this.returnProgress < c.returnStartShare) {
      // not returning (yet, or any more): the aim follows the bow hand, nothing is locked
      this.lock = null
      this.stability = this.steadiness(now)
    } else if (!this.lock) {
      this.lock = this.lockAim(now, out)
      this.stability = this.lock.stability
    }
    const travel = out * (this.peak!.draw.x - sample.draw.x)
    const drop = Math.abs(sample.draw.y - this.peak!.draw.y)
    const sideways = drop <= c.returnVerticalRatio * travel + c.returnVerticalSlack
    const fire = this.returnProgress >= c.returnShare && sideways && !low
    this.returnFrames = fire ? this.returnFrames + 1 : 0
    if (this.returnFrames < c.returnConfirmFrames || !this.lock) return []
    const drawAmount = this.lock.span - this.readySpan
    const event: Pending = {
      type: 'FIRE', timestamp: now, side, attemptId: this.attemptId, drawAmount, holdStability: this.lock.stability,
      drawRatio: drawAmount / this.options.drawGoal, aim: { ...this.lock.aim }, returnMs: now - this.lock.at,
    }
    this.phase = 'cooldown'
    this.since = now
    this.peak = null
    this.returnProgress = 0
    this.returnFrames = 0
    this.cue = null
    return [event]
  }

  /**
   * Lock the aim as the return begins: find the onset (the last frame the string hand was still at its
   * peak) and average the aim over the short window before it, so a bow hand that moves together with
   * the return cannot drag the arrow along.
   */
  private lockAim(now: number, out: number): { aim: Point; stability: number; span: number; at: number } {
    const c = DRAW_CONFIG
    const peakX = this.peak!.draw.x
    let onset = this.samples[this.samples.length - 1]
    for (let i = this.samples.length - 1; i >= 0; i -= 1) {
      if (out * (peakX - this.samples[i].draw.x) <= c.returnOnsetBand) {
        onset = this.samples[i]
        break
      }
    }
    const window = this.samples.filter((s) => s.t <= onset.t && onset.t - s.t <= c.aimLockWindowMs && s.t >= this.holdStart)
    const list = window.length ? window : [onset]
    const aim = { x: list.reduce((a, s) => a + s.aim.x, 0) / list.length, y: list.reduce((a, s) => a + s.aim.y, 0) / list.length }
    return { aim, stability: this.steadiness(onset.t), span: onset.span, at: now }
  }

  /** Bow hand → aim (torso units): its height against the bow shoulder (+ = lower). x stays 0 (see header). */
  private aimOf(arms: Arms): Point {
    return { x: 0, y: arms.bowWrist.y - (arms.bowShoulder.y + DRAW_CONFIG.aimRefBelowShoulder) }
  }

  /** 1 = steady. Detrended RMS wobble of the bow hand over the window ending at `until`, since the hold began. */
  private steadiness(until: number): number {
    const c = DRAW_CONFIG
    const window = this.samples.filter((s) => s.t <= until && until - s.t <= c.stabilityWindowMs && s.t >= this.holdStart - 1)
    // too few samples yet (the hold just began): nothing to judge, assume steady
    if (window.length < 4) return 1
    const wobble = detrendedRms(window.map((s) => ({ t: s.t, p: s.bow })))
    return clamp(1 - wobble / c.stabilityScale, 0, 1)
  }

  /** Soft hints never change the state machine; they only appear after persisting `softHintSustainMs`. */
  private updateHints(arms: Arms, now: number): void {
    const c = DRAW_CONFIG
    const drawnEnough = this.phase !== 'draw' || this.ratio >= 0.6
    const bent = drawnEnough && (this.bowAngle ?? 180) < c.bowArmSoftDeg
    const turned = this.widthRef > 0 && arms.shoulderWidth < this.widthRef * c.turnRatio
    this.bowArmSince = bent ? this.bowArmSince ?? now : null
    this.turnedSince = turned ? this.turnedSince ?? now : null
    const persisted = (since: number | null) => since !== null && now - since >= c.softHintSustainMs
    this.hint = persisted(this.turnedSince) ? 'turned' : persisted(this.bowArmSince) ? 'bow-arm-straighter' : null
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
    if (!d.wrist || !d.shoulder || !b.wrist || !b.elbow || !b.shoulder) return null
    return {
      drawWrist: d.wrist,
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

  private resetAttempt(): void {
    this.guard = null
    this.hint = null
    this.cue = null
    this.earlyAt = null
    this.rePullFrom = null
    this.handsLowSince = null
    this.bowArmSince = null
    this.turnedSince = null
    this.pullOutSince = null
    this.samples = []
    this.holdProgress = 0
    this.stability = 1
    this.aim = { x: 0, y: 0 }
    this.peak = null
    this.lock = null
    this.returnProgress = 0
    this.returnFrames = 0
  }

  private toWaitReady(): void {
    this.phase = 'wait-ready'
    this.readySince = null
    this.ratio = 0
    this.resetAttempt()
  }
}
