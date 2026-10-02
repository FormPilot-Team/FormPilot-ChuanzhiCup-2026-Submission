// Cursor smoothing must calm a resting hand without making a moving hand feel late
// (the Stage B body outline was rejected for feeling stiff and delayed).
import { describe, expect, it } from 'vitest'
import { mulberry32 } from './random'
import { OneEuro2D } from './smoothing'

/** Pose updates arrive at 30 Hz, the cursor is drawn at 120 Hz (the measured render rate). */
function run(position: (t: number) => number, noise: number, seconds: number) {
  const filter = new OneEuro2D()
  const random = mulberry32(3)
  const out: { t: number; raw: number; shown: number }[] = []
  let latest = position(0)
  for (let frame = 0; frame < seconds * 120; frame += 1) {
    const t = frame / 120
    if (frame % 4 === 0) latest = position(t) + (random() - 0.5) * 2 * noise
    out.push({ t, raw: position(t), shown: filter.filter({ x: latest, y: 0 }, t * 1000, 1).x })
  }
  return out
}

const std = (values: number[]) => {
  const m = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length)
}

describe('cursor smoothing (One Euro, display only)', () => {
  it('a resting hand with pose jitter becomes much calmer on screen', () => {
    const rest = run(() => 0, 0.02, 4).slice(120)
    const rawJitter = 0.02 / Math.sqrt(3)
    expect(std(rest.map((s) => s.shown))).toBeLessThan(rawJitter * 0.55)
  })

  it('a moving hand trails by about one pose frame at most (the 30 Hz input itself accounts for ~17 ms)', () => {
    for (const [speed, maxLagMs] of [[2, 25], [0.5, 35]] as const) {
      const moving = run((t) => speed * t, 0, 3).slice(120)
      const meanLag = moving.reduce((a, s) => a + s.raw - s.shown, 0) / moving.length
      expect((meanLag / speed) * 1000).toBeLessThan(maxLagMs)
    }
  })
})
