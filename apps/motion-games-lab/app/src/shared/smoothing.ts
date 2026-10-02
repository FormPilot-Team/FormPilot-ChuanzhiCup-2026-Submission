// Display-side smoothing for cursors (One Euro filter, Casiez et al. 2012). The pose pipeline already
// filters landmarks; this only turns ~30 Hz pose updates into a calm cursor on a 60–240 Hz display:
// strong smoothing when the hand rests (no jitter), almost none when it moves fast (no lag).
// Hit-testing never uses these smoothed values.
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
