// Display smoothing must (1) calm a resting hand, (2) not make a moving hand feel late (the Stage B
// body outline was rejected for that) and (3) — Round-1 playtest — turn 30 Hz pose updates into smooth
// motion at the display rate instead of a 30 Hz staircase.
import { describe, expect, it } from 'vitest'
import { mulberry32 } from './random'
import { Follow1D, OneEuro2D, PoseFollower2D } from './smoothing'

const RENDER_HZ = 240
const POSE_EVERY = 8 // 240 / 8 = 30 Hz pose

/** Pose updates at 30 Hz (with a little arrival jitter), drawn at 240 Hz — the playtest laptop. */
function run(position: (t: number) => number, noise: number, seconds: number) {
  const follower = new PoseFollower2D()
  const random = mulberry32(3)
  const out: { t: number; raw: number; shown: number }[] = []
  for (let frame = 0; frame < seconds * RENDER_HZ; frame += 1) {
    const t = frame / RENDER_HZ
    if (frame % POSE_EVERY === 0) {
      const sampleAt = t * 1000 - 20 - random() * 4 // capture → arrival ≈ 20–24 ms
      follower.push({ x: position(sampleAt / 1000) + (random() - 0.5) * 2 * noise, y: 0 }, sampleAt, t * 1000)
    }
    out.push({ t, raw: position(t), shown: follower.sample(t * 1000)!.x })
  }
  return out
}

/** The pre-fix cursor: One Euro evaluated every rendered frame on the held 30 Hz value. */
function runOld(position: (t: number) => number, seconds: number) {
  const filter = new OneEuro2D()
  const out: number[] = []
  let latest = position(0)
  for (let frame = 0; frame < seconds * RENDER_HZ; frame += 1) {
    const t = frame / RENDER_HZ
    if (frame % POSE_EVERY === 0) latest = position(t)
    out.push(filter.filter({ x: latest, y: 0 }, t * 1000, 1).x)
  }
  return out
}

const std = (values: number[]) => {
  const m = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length)
}
/** Coefficient of variation of the per-frame movement: 0 = perfectly even motion. */
const unevenness = (xs: number[]) => {
  const steps = xs.slice(1).map((x, i) => Math.abs(x - xs[i]))
  return std(steps) / (steps.reduce((a, b) => a + b, 0) / steps.length)
}

describe('display smoothing (display only — hit tests use raw motion data)', () => {
  it('a resting hand with pose jitter becomes much calmer on screen', () => {
    const rest = run(() => 0, 0.02, 4).slice(RENDER_HZ)
    const rawJitter = 0.02 / Math.sqrt(3)
    expect(std(rest.map((s) => s.shown))).toBeLessThan(rawJitter * 0.55)
  })

  it('a moving hand trails the true hand by about the camera pipeline delay, not more', () => {
    // samples are already 20–24 ms old on arrival; on top the cursor adds what the pre-fix One Euro cursor
    // added (≤ 25 ms moving fast, ≤ 35 ms moving slowly, where it smooths more on purpose)
    for (const [speed, maxLagMs] of [[2, 47], [0.5, 60]] as const) {
      const moving = run((t) => speed * t, 0, 3).slice(RENDER_HZ)
      const meanLag = moving.reduce((a, s) => a + s.raw - s.shown, 0) / moving.length
      expect((meanLag / speed) * 1000).toBeLessThan(maxLagMs)
    }
  })

  it('30 Hz poses become even motion at 240 Hz (the old cursor moved in 30 Hz jumps)', () => {
    const moving = run((t) => 1.5 * t, 0, 3).slice(RENDER_HZ).map((s) => s.shown)
    const old = runOld((t) => 1.5 * t, 3).slice(RENDER_HZ)
    expect(unevenness(moving)).toBeLessThan(0.25)
    expect(unevenness(old)).toBeGreaterThan(1)
  })

  it('stopping does not overshoot visibly', () => {
    const stopAt = 1.5
    const path = (t: number) => (t < stopAt ? 1.5 * t : 1.5 * stopAt)
    const shown = run(path, 0, 3).map((s) => s.shown)
    expect(Math.max(...shown) - 1.5 * stopAt).toBeLessThan(0.02)
  })

  it('Follow1D eases at the same speed whatever the frame rate', () => {
    for (const hz of [60, 144, 240]) {
      const f = new Follow1D(45)
      f.snap(0, 0)
      let v = 0
      for (let t = 1000 / hz; t <= 100 + 1e-6; t += 1000 / hz) v = f.step(1, t)
      expect(v).toBeGreaterThan(0.85)
      expect(v).toBeLessThan(0.93)
    }
  })
})
