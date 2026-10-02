// Display-side smoothing (never used for game decisions). Two layers:
// 1. One Euro (Casiez et al. 2012), run once per POSE sample with the real sample timing: calm when the
//    hand rests, little lag when it moves.
// 2. A render-rate follower: every rendered frame the visual position eases toward the latest filtered
//    pose, carried forward by its recent velocity for at most one pose interval. A 30 Hz pose therefore
//    becomes continuous motion at 60–240 Hz instead of a 30 Hz staircase (the Round-1 playtest complaint).
// Hit-testing and every detector keep using the unsmoothed motion data.
import type { Point } from '../motion/contracts'

class LowPass {
  private value: number | null = null
  filter(x: number, alpha: number): number {
    this.value = this.value === null ? x : this.value + alpha * (x - this.value)
    return this.value
  }
  last(): number | null {
    return this.value
  }
  reset(): void {
    this.value = null
  }
}

const alphaFor = (cutoffHz: number, dtS: number) => 1 / (1 + 1 / (2 * Math.PI * cutoffHz * dtS))

export class OneEuro2D {
  private readonly x = new LowPass()
  private readonly y = new LowPass()
  private readonly dx = new LowPass()
  private readonly dy = new LowPass()
  private lastAt: number | null = null
  private prev: Point | null = null

  /** beta is per "speed unit per second" after speedScale (cursors pass torso units) */
  constructor(private readonly minCutoffHz = 0.6, private readonly beta = 8, private readonly derivativeCutoffHz = 0.6) {}

  reset(): void {
    this.x.reset()
    this.y.reset()
    this.dx.reset()
    this.dy.reset()
    this.lastAt = null
    this.prev = null
  }

  /** `p` in any unit (screen pixels here); `speedScale` converts speed into "units per second" for beta. */
  filter(p: Point, nowMs: number, speedScale = 1): Point {
    const dt = this.lastAt === null ? 1 / 60 : Math.max(1e-3, (nowMs - this.lastAt) / 1000)
    this.lastAt = nowMs
    if (!this.prev) {
      this.prev = { ...p }
      this.x.filter(p.x, 1)
      this.y.filter(p.y, 1)
      return { ...p }
    }
    const ad = alphaFor(this.derivativeCutoffHz, dt)
    const vx = this.dx.filter((p.x - (this.x.last() ?? p.x)) / dt, ad)
    const vy = this.dy.filter((p.y - (this.y.last() ?? p.y)) / dt, ad)
    const speed = Math.hypot(vx, vy) * speedScale
    const a = alphaFor(this.minCutoffHz + this.beta * speed, dt)
    const out = { x: this.x.filter(p.x, a), y: this.y.filter(p.y, a) }
    this.prev = out
    return out
  }
}

/** Frame-rate independent easing factor for one rendered frame of `dtMs` with time constant `tauMs`. */
export function easeFactor(dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return 1
  return 1 - Math.exp(-Math.max(0, dtMs) / tauMs)
}

/** Scalar that eases toward a target every rendered frame (oar sweep, bow flex, track fill…). */
export class Follow1D {
  value: number | null = null
  private lastAt: number | null = null

  constructor(private readonly tauMs = 45) {}

  step(target: number, nowMs: number): number {
    const dt = this.lastAt === null ? 0 : nowMs - this.lastAt
    this.lastAt = nowMs
    this.value = this.value === null ? target : this.value + (target - this.value) * easeFactor(dt, this.tauMs)
    return this.value
  }

  /** Jump to a value (a new attempt starts from rest, not from the last one). */
  snap(value: number, nowMs: number): void {
    this.value = value
    this.lastAt = nowMs
  }

  reset(): void {
    this.value = null
    this.lastAt = null
  }
}

export const POSE_FOLLOW = Object.freeze({
  /** time constant of the per-frame easing toward the predicted pose position (ms) */
  tauMs: 15,
  /** carry the last velocity forward at most this long after a pose sample (≈ one 30 Hz interval) */
  maxPredictMs: 40,
  /** share of the elapsed time that is predicted (1 = exactly the time since the sample) */
  predictGain: 1,
  /** smoothing of the per-sample velocity estimate (0..1, higher = more responsive) */
  velocityAlpha: 0.5,
})

/**
 * Pose-rate input → render-rate visual position. `push` once per pose sample (its timestamp),
 * `sample` once per rendered frame.
 */
export class PoseFollower2D {
  private readonly euro = new OneEuro2D()
  private target: Point | null = null
  private velocity: Point = { x: 0, y: 0 }
  private targetAt = 0
  private pushedAt = 0
  private visual: Point | null = null
  private lastFrame: number | null = null

  constructor(private readonly config: typeof POSE_FOLLOW = POSE_FOLLOW) {}

  reset(): void {
    this.euro.reset()
    this.target = null
    this.visual = null
    this.velocity = { x: 0, y: 0 }
    this.lastFrame = null
  }

  /** A new pose sample. `sampleAtMs` = its capture timestamp; `nowMs` = arrival (render clock). */
  push(p: Point, sampleAtMs: number, nowMs: number, speedScale = 1): void {
    const filtered = this.euro.filter(p, sampleAtMs, speedScale)
    if (this.target && sampleAtMs > this.targetAt) {
      const dt = (sampleAtMs - this.targetAt) / 1000
      const a = this.config.velocityAlpha
      const vx = (filtered.x - this.target.x) / dt
      const vy = (filtered.y - this.target.y) / dt
      this.velocity = dt < 0.2 ? { x: this.velocity.x + a * (vx - this.velocity.x), y: this.velocity.y + a * (vy - this.velocity.y) } : { x: 0, y: 0 }
    }
    this.target = filtered
    this.targetAt = sampleAtMs
    this.pushedAt = nowMs
  }

  /** Visual position for a frame rendered at `nowMs`, or null before the first sample. */
  sample(nowMs: number): Point | null {
    if (!this.target) return null
    const ahead = Math.min(this.config.maxPredictMs, Math.max(0, nowMs - this.pushedAt)) * this.config.predictGain / 1000
    const goal = { x: this.target.x + this.velocity.x * ahead, y: this.target.y + this.velocity.y * ahead }
    const dt = this.lastFrame === null ? 0 : nowMs - this.lastFrame
    this.lastFrame = nowMs
    if (!this.visual) this.visual = { ...goal }
    else {
      const k = easeFactor(dt, this.config.tauMs)
      this.visual = { x: this.visual.x + (goal.x - this.visual.x) * k, y: this.visual.y + (goal.y - this.visual.y) * k }
    }
    return { ...this.visual }
  }
}
