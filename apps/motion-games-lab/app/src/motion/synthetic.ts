// Synthetic pose source for automated replay tests. A virtual player is rendered into the same
// 33-point landmark format MediaPipe produces, so FrameBuilder, framing, posture, calibration and
// target detection all run unchanged. This proves game/pipeline logic only — it is NOT evidence
// that real people are recognised reliably (that still needs camera tests with people).
import type { CalibrationStatus, MotionTarget, Point, Side } from './contracts'
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
}

const ASPECT = 16 / 9
const ORIGIN = { x: 0.5 * ASPECT, y: 0.44 }
const TORSO = 0.23
const SHOULDER_HALF = 0.375
const REST: Record<Side, Point> = { left: { x: -0.5, y: 0.98 }, right: { x: 0.5, y: 0.98 } }
const SPEED = 2.4 // torso lengths per second

export class SyntheticActor {
  state: ActorState = { present: true, hands: { left: true, right: true }, leanDeg: 0, shrug: 0 }
  wrist: Record<Side, Point> = { left: { ...REST.left }, right: { ...REST.right } }
  goal: Record<Side, Point> = { left: { ...REST.left }, right: { ...REST.right } }
  private readonly random: () => number

  constructor(seed = 7) {
    this.random = mulberry32(seed)
  }

  rest(side: Side): void {
    this.goal[side] = { ...REST[side] }
  }

  step(dtMs: number): void {
    const maxStep = (SPEED * dtMs) / 1000
    for (const side of ['left', 'right'] as const) {
      const w = this.wrist[side]
      const g = this.goal[side]
      const d = Math.hypot(g.x - w.x, g.y - w.y)
      const k = d <= maxStep ? 1 : maxStep / d
      this.wrist[side] = { x: w.x + (g.x - w.x) * k, y: w.y + (g.y - w.y) * k }
    }
  }

  /** Raw, unmirrored, normalised landmarks like PoseLandmarker output. */
  landmarks(): PoseLandmark[] | null {
    if (!this.state.present) return null
    const s = this.state
    const lift = 0.25 * s.shrug
    const body: Partial<Record<number, Point>> = {
      [LM.nose]: { x: 0, y: -0.55 },
      [LM.leftEar]: { x: -0.16, y: -0.5 },
      [LM.rightEar]: { x: 0.16, y: -0.5 },
      [LM.leftShoulder]: { x: -SHOULDER_HALF, y: -lift },
      [LM.rightShoulder]: { x: SHOULDER_HALF, y: -lift },
      [LM.leftHip]: { x: -0.28, y: 1 },
      [LM.rightHip]: { x: 0.28, y: 1 },
    }
    for (const side of ['left', 'right'] as const) {
      const shoulder = body[side === 'left' ? LM.leftShoulder : LM.rightShoulder]!
      const wrist = this.wrist[side]
      const mid = { x: (shoulder.x + wrist.x) / 2, y: (shoulder.y + wrist.y) / 2 }
      const len = Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y) || 1
      // bend the elbow slightly outward so the arm never degenerates into a line
      const outward = side === 'left' ? -1 : 1
      const normal = { x: -(wrist.y - shoulder.y) / len, y: (wrist.x - shoulder.x) / len }
      const sign = normal.x * outward >= 0 ? 1 : -1
      body[side === 'left' ? LM.leftElbow : LM.rightElbow] = { x: mid.x + normal.x * 0.08 * sign, y: mid.y + normal.y * 0.08 * sign }
      body[side === 'left' ? LM.leftWrist : LM.rightWrist] = wrist
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

export interface DirectorContext {
  calibration(): CalibrationStatus
  targets(): readonly MotionTarget[]
}

/**
 * The scripted "player" for Apple: follows calibration prompts, then reaches for each apple with
 * the hand on that side, waits, and returns to rest. Options make it imperfect on purpose.
 */
export class AppleBot {
  paused = false
  /** ignore every Nth new target (lets it expire) — 0 = never */
  missEvery = 0
  reachDeg = 140
  private seenTargets = new Set<number>()
  private ignored = new Set<number>()
  private restUntil = 0
  private lastTarget: number | null = null

  update(now: number, ctx: DirectorContext, actor: SyntheticActor): void {
    if (this.paused) return
    const calibration = ctx.calibration()
    if (calibration.step === 'neutral') {
      actor.rest('left')
      actor.rest('right')
      return
    }
    if (calibration.step === 'reach-left' || calibration.step === 'reach-right') {
      const side: Side = calibration.step === 'reach-left' ? 'left' : 'right'
      const other: Side = side === 'left' ? 'right' : 'left'
      const phi = (this.reachDeg * Math.PI) / 180
      const sx = side === 'left' ? -SHOULDER_HALF : SHOULDER_HALF
      // direction rotated outward from "straight down" by phi; y is down-positive, so cos(140°) < 0 is above the shoulder
      actor.goal[side] = { x: sx + (side === 'left' ? -1 : 1) * Math.sin(phi), y: Math.cos(phi) }
      actor.rest(other)
      return
    }
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
    actor.goal[side] = { ...target.center }
    actor.rest(other)
  }
}

/** Real-time synthetic source (setInterval at ~30 Hz) or manual stepping for unit tests. */
export class SyntheticPoseSource implements PoseSource {
  readonly kind = 'synthetic' as const
  readonly actor: SyntheticActor
  readonly bot = new AppleBot()
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
