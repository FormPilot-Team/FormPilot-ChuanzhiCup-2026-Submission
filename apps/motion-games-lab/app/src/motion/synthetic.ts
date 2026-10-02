// Synthetic pose source for automated replay tests. A virtual player is rendered into the same
// 33-point landmark format MediaPipe produces, so FrameBuilder, framing, posture, calibration and
// every detector (targets, strokes, draw) run unchanged. This proves game/pipeline logic only — it is
// NOT evidence that real people are recognised reliably (that still needs camera tests with people).
import type { CalibrationStatus, DrawState, MotionTarget, Point, Side, StrokeState } from './contracts'
import { LM } from './frameBuilder'
import type { PoseSource, PoseSourceInfo, RawPoseSample, SampleListener } from './poseSource'
import type { PoseLandmark } from './vendor/poseTypes'
import { mulberry32 } from '../shared/random'

export interface ActorState {
  present: boolean
  hands: Record<Side, boolean>
  /** side lean of the upper body, degrees (+ = toward screen right) */
  leanDeg: number
  /** 0..1 shoulder elevation (shrug) */
  shrug: number
  /** torso twist, degrees: the projected shoulder width shrinks by cos(twist) */
  twistDeg: number
}

const ASPECT = 16 / 9
const ORIGIN = { x: 0.5 * ASPECT, y: 0.44 }
const TORSO = 0.23
export const SHOULDER_HALF = 0.375
const REST: Record<Side, Point> = { left: { x: -0.5, y: 0.98 }, right: { x: 0.5, y: 0.98 } }
const SPEED = 2.4 // torso lengths per second

export class SyntheticActor {
  state: ActorState = { present: true, hands: { left: true, right: true }, leanDeg: 0, shrug: 0, twistDeg: 0 }
  wrist: Record<Side, Point> = { left: { ...REST.left }, right: { ...REST.right } }
  goal: Record<Side, Point> = { left: { ...REST.left }, right: { ...REST.right } }
  /** explicit elbow target (e.g. the string arm of a drawn bow); null = natural, slightly bent arm */
  elbowGoal: Record<Side, Point | null> = { left: null, right: null }
  /** multiplies the hand speed (a quick release, a slow lowering) */
  speed: Record<Side, number> = { left: 1, right: 1 }
  private elbow: Record<Side, Point | null> = { left: null, right: null }
  private readonly random: () => number

  constructor(seed = 7) {
    this.random = mulberry32(seed)
  }

  rest(side: Side): void {
    this.goal[side] = { ...REST[side] }
    this.elbowGoal[side] = null
  }

  shoulder(side: Side): Point {
    const half = SHOULDER_HALF * Math.cos((this.state.twistDeg * Math.PI) / 180)
    return { x: side === 'left' ? -half : half, y: -0.25 * this.state.shrug }
  }

  step(dtMs: number): void {
    for (const side of ['left', 'right'] as const) {
      const maxStep = (SPEED * this.speed[side] * dtMs) / 1000
      const move = (from: Point, to: Point): Point => {
        const d = Math.hypot(to.x - from.x, to.y - from.y)
        const k = d <= maxStep ? 1 : maxStep / d
        return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }
      }
      this.wrist[side] = move(this.wrist[side], this.goal[side])
      const elbowGoal = this.elbowGoal[side]
      this.elbow[side] = elbowGoal ? move(this.elbow[side] ?? this.naturalElbow(side), elbowGoal) : null
    }
  }

  private naturalElbow(side: Side): Point {
    const shoulder = this.shoulder(side)
    const wrist = this.wrist[side]
    const mid = { x: (shoulder.x + wrist.x) / 2, y: (shoulder.y + wrist.y) / 2 }
    const len = Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y) || 1
    // bend the elbow slightly outward so the arm never degenerates into a line
    const outward = side === 'left' ? -1 : 1
    const normal = { x: -(wrist.y - shoulder.y) / len, y: (wrist.x - shoulder.x) / len }
    const sign = normal.x * outward >= 0 ? 1 : -1
    return { x: mid.x + normal.x * 0.08 * sign, y: mid.y + normal.y * 0.08 * sign }
  }

  /** Raw, unmirrored, normalised landmarks like PoseLandmarker output. */
  landmarks(): PoseLandmark[] | null {
    if (!this.state.present) return null
    const s = this.state
    const twist = Math.cos((s.twistDeg * Math.PI) / 180)
    const body: Partial<Record<number, Point>> = {
      [LM.nose]: { x: 0, y: -0.55 },
      [LM.leftEar]: { x: -0.16 * twist, y: -0.5 },
      [LM.rightEar]: { x: 0.16 * twist, y: -0.5 },
      [LM.leftShoulder]: this.shoulder('left'),
      [LM.rightShoulder]: this.shoulder('right'),
      [LM.leftHip]: { x: -0.28, y: 1 },
      [LM.rightHip]: { x: 0.28, y: 1 },
    }
    for (const side of ['left', 'right'] as const) {
      body[side === 'left' ? LM.leftElbow : LM.rightElbow] = this.elbow[side] ?? this.naturalElbow(side)
      body[side === 'left' ? LM.leftWrist : LM.rightWrist] = this.wrist[side]
    }
    // lean: rotate everything above the hips around the hip midpoint
    const theta = (s.leanDeg * Math.PI) / 180
    const pivot = { x: 0, y: 1 }
    const rotate = (p: Point): Point => {
      const dx = p.x - pivot.x
      const dy = p.y - pivot.y
      return { x: pivot.x + dx * Math.cos(theta) - dy * Math.sin(theta), y: pivot.y + dx * Math.sin(theta) + dy * Math.cos(theta) }
    }
    const noise = () => (this.random() - 0.5) * 0.004
    const out: PoseLandmark[] = []
    for (let i = 0; i < 33; i += 1) {
      const isHip = i === LM.leftHip || i === LM.rightHip
      const p = body[i] ? (isHip ? body[i]! : rotate(body[i]!)) : fallbackPoint(i)
      const iso = { x: ORIGIN.x + p.x * TORSO, y: ORIGIN.y + p.y * TORSO }
      const hiddenHand = (!s.hands.left && (i === LM.leftWrist || i === LM.leftElbow)) || (!s.hands.right && (i === LM.rightWrist || i === LM.rightElbow))
      out.push({ x: 1 - iso.x / ASPECT + noise(), y: iso.y + noise(), z: 0, visibility: hiddenHand ? 0.08 : body[i] ? 0.96 : 0.6 })
    }
    return out
  }
}

function fallbackPoint(index: number): Point {
  // eyes / mouth / fingers / legs: plausible but unused positions
  if (index <= 10) return { x: (index % 2 ? -1 : 1) * 0.06, y: -0.58 }
  if (index <= 22) return { x: (index % 2 ? -0.6 : 0.6), y: 1.05 }
  return { x: (index % 2 ? -0.25 : 0.25), y: 1.6 + (index - 25) * 0.2 }
}

/** What a scripted player may observe: prompts, targets and detector states — never game internals. */
export interface DirectorContext {
  calibration(): CalibrationStatus
  targets(): readonly MotionTarget[]
  strokes(): StrokeState
  draw(): DrawState
}

export type BotKind = 'apple' | 'boating' | 'archery'

/** A scripted player. `missEvery` makes it imperfect on purpose (0 = never). */
export interface Bot {
  paused: boolean
  missEvery: number
  update(now: number, ctx: DirectorContext, actor: SyntheticActor): void
}

/** Shared by every bot: follow the calibration prompts (hands down, then raise left, then right). */
function followCalibration(ctx: DirectorContext, actor: SyntheticActor, reachDeg: number): boolean {
  const calibration = ctx.calibration()
  if (calibration.step === 'neutral') {
    actor.rest('left')
    actor.rest('right')
    return true
  }
  if (calibration.step === 'reach-left' || calibration.step === 'reach-right') {
    const side: Side = calibration.step === 'reach-left' ? 'left' : 'right'
    const other: Side = side === 'left' ? 'right' : 'left'
    const phi = (reachDeg * Math.PI) / 180
    const sx = side === 'left' ? -SHOULDER_HALF : SHOULDER_HALF
    // direction rotated outward from "straight down" by phi; y is down-positive, so cos(140°) < 0 is above the shoulder
    actor.goal[side] = { x: sx + (side === 'left' ? -1 : 1) * Math.sin(phi), y: Math.cos(phi) }
    actor.rest(other)
    return true
  }
  return false
}

/**
 * Apple: reaches for each apple with the hand on that side, waits, and returns to rest. The wrist is
 * aimed so that the palm-centre estimate (wrist + 0.3 × forearm) lands on the apple.
 */
export class AppleBot implements Bot {
  paused = false
  missEvery = 0
  reachDeg = 140
  private seenTargets = new Set<number>()
  private ignored = new Set<number>()
  private restUntil = 0
  private lastTarget: number | null = null

  update(now: number, ctx: DirectorContext, actor: SyntheticActor): void {
    if (this.paused || followCalibration(ctx, actor, this.reachDeg)) return
    const targets = ctx.targets()
    for (const t of targets) {
      if (this.seenTargets.has(t.id)) continue
      this.seenTargets.add(t.id)
      if (this.missEvery > 0 && this.seenTargets.size % this.missEvery === 0) this.ignored.add(t.id)
    }
    const target = targets.find((t) => !this.ignored.has(t.id))
    if (!target) {
      if (this.lastTarget !== null) this.restUntil = now + 250
      this.lastTarget = null
      actor.rest('left')
      actor.rest('right')
      return
    }
    if (now < this.restUntil) return
    this.lastTarget = target.id
    const side: Side = target.center.x < 0 ? 'left' : 'right'
    const other: Side = side === 'left' ? 'right' : 'left'
    const shoulder = actor.shoulder(side)
    // natural elbow ≈ shoulder–wrist midpoint, so hand ≈ wrist + 0.15 × (wrist − shoulder)
    actor.goal[side] = { x: shoulder.x + (target.center.x - shoulder.x) / 1.15, y: shoulder.y + (target.center.y - shoulder.y) / 1.15 }
    actor.rest(other)
  }
}

/** Boating: alternating paddle strokes (scheme-aware), one side at a time, with a steady rhythm. */
export class BoatBot implements Bot {
  paused = false
  /** every Nth stroke is deliberately too small (it must not count) */
  missEvery = 0
  /** time per stroke (ms): outward ~45 %, back and rest ~55 % */
  periodMs = 1100
  private side: Side = 'left'
  private phaseUntil = 0
  private stage: 'neutral' | 'out' = 'neutral'
  private count = 0

  update(now: number, ctx: DirectorContext, actor: SyntheticActor): void {
    if (this.paused || followCalibration(ctx, actor, 140)) return
    const scheme = ctx.strokes().options.scheme
    const neutral = (side: Side): Point => (scheme === 'down'
      ? { x: side === 'left' ? -0.45 : 0.45, y: 0.35 }
      : { x: side === 'left' ? -0.15 : 0.15, y: 0.75 })
    const outward = (side: Side, small: boolean): Point => (scheme === 'down'
      ? { x: side === 'left' ? -0.5 : 0.5, y: small ? 0.45 : 1.08 }
      : { x: (side === 'left' ? -1 : 1) * (small ? 0.42 : 0.88), y: 0.68 })
    actor.elbowGoal.left = null
    actor.elbowGoal.right = null
    if (now < this.phaseUntil) return
    const other: Side = this.side === 'left' ? 'right' : 'left'
    if (this.stage === 'neutral') {
      this.count += 1
      const small = this.missEvery > 0 && this.count % this.missEvery === 0
      actor.goal[this.side] = outward(this.side, small)
      actor.goal[other] = neutral(other)
      this.stage = 'out'
      this.phaseUntil = now + this.periodMs * 0.45
    } else {
      actor.goal[this.side] = neutral(this.side)
      this.stage = 'neutral'
      this.phaseUntil = now + this.periodMs * 0.55
      this.side = other
    }
  }
}

/** Archery: hands together → draw apart (bow arm straight, string elbow out) → hold → snap back. */
export class ArcheryBot implements Bot {
  paused = false
  /** every Nth shot wobbles during the hold (lower stability → outer rings) */
  missEvery = 0
  private shots = 0
  private lastAttempt = -1
  private releaseAt: number | null = null

  update(now: number, ctx: DirectorContext, actor: SyntheticActor): void {
    if (this.paused || followCalibration(ctx, actor, 140)) return
    const state = ctx.draw()
    const draw = state.options.drawSide
    const bow: Side = draw === 'left' ? 'right' : 'left'
    const out = draw === 'right' ? 1 : -1
    actor.speed[draw] = 1
    switch (state.phase) {
      case 'wait-ready':
      case 'cooldown':
        actor.goal[bow] = { x: -out * 0.08, y: 0.38 }
        actor.goal[draw] = { x: out * 0.08, y: 0.38 }
        actor.elbowGoal[bow] = null
        actor.elbowGoal[draw] = null
        this.releaseAt = null
        return
      case 'ready':
      case 'draw':
        if (state.phase === 'draw' && state.attemptId !== this.lastAttempt) {
          this.lastAttempt = state.attemptId
          this.shots += 1
        }
        actor.goal[bow] = { x: -out * 1.3, y: 0.06 }
        actor.goal[draw] = { x: out * 0.5, y: 0.04 }
        actor.elbowGoal[draw] = { x: out * 0.98, y: 0.08 }
        return
      case 'hold':
      case 'armed': {
        const wobbly = this.missEvery > 0 && this.shots % this.missEvery === 0
        actor.goal[bow] = { x: -out * 1.3, y: 0.06 + (wobbly ? 0.05 * Math.sin(now / 90) : 0) }
        if (state.phase === 'hold') return
        this.releaseAt ??= now + 250
        if (now >= this.releaseAt) {
          actor.speed[draw] = 1.8
          actor.goal[draw] = { x: -out * 0.2, y: 0.12 }
          actor.elbowGoal[draw] = null
        }
        return
      }
    }
  }
}

/** Real-time synthetic source (setInterval at ~30 Hz) or manual stepping for unit tests. */
export class SyntheticPoseSource implements PoseSource {
  readonly kind = 'synthetic' as const
  readonly actor: SyntheticActor
  readonly bots: Record<BotKind, Bot> = { apple: new AppleBot(), boating: new BoatBot(), archery: new ArcheryBot() }
  private botKind: BotKind = 'apple'
  private readonly listeners = new Set<SampleListener>()
  private timer?: ReturnType<typeof setInterval>
  private context?: DirectorContext
  private lastStep = 0

  constructor(private readonly options: { seed?: number; manual?: boolean; frameMs?: number } = {}) {
    this.actor = new SyntheticActor(options.seed ?? 7)
  }

  attach(context: DirectorContext): void {
    this.context = context
  }

  /** The scripted player for the game being played (Apple by default). */
  get bot(): Bot {
    return this.bots[this.botKind]
  }

  useBot(kind: BotKind): void {
    this.botKind = kind
  }

  async start(): Promise<void> {
    if (this.options.manual) return
    this.lastStep = performance.now()
    this.timer = setInterval(() => this.emit(performance.now()), this.options.frameMs ?? 33)
  }

  stop(): void {
    clearInterval(this.timer)
  }

  onSample(listener: SampleListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  stream(): MediaStream | null {
    return null
  }

  info(): PoseSourceInfo {
    return { kind: 'synthetic', delegate: 'none', model: 'synthetic-actor', cameraWidth: 1280, cameraHeight: 720, cameraFrameRate: 1000 / (this.options.frameMs ?? 33) }
  }

  /** Advance the actor to `now` and emit one landmark sample. */
  emit(now: number): void {
    const dt = this.lastStep ? Math.min(100, now - this.lastStep) : 0
    this.lastStep = now
    if (this.context) this.bot.update(now, this.context, this.actor)
    this.actor.step(dt)
    const sample: RawPoseSample = { timestamp: now, frameTime: now, landmarks: this.actor.landmarks(), imageWidth: 1280, imageHeight: 720, inferenceMs: 0 }
    for (const listener of this.listeners) listener(sample)
  }
}
