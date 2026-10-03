// Test fixture. Human-like first-time archer (synthetic, seeded): what the round-2 playtest described — the bow arm at
// its personal limit and still bent, the bow hand moving to aim, landmark jitter, a modest string-hand
// pull, slow and imperfect returns, a slightly turned torso on some shots. Not real data.
import type { MotionFrame, Point } from './contracts'

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface HumanShotPlan {
  bowTo: Point
  bowElbowDeg: number
  stringTo: Point
  drawMs: number
  aimMs: number
  aimAmp: number
  returnMs: number
  returnTo: Point
  turn: number
}

export function humanArcherFrames(seed: number, shots = 5): { frames: MotionFrame[]; plans: HumanShotPlan[] } {
  const rnd = mulberry(seed)
  const r = (lo: number, hi: number) => lo + (hi - lo) * rnd()
  const jitter = () => (rnd() - 0.5) * 0.04 // ±0.02 torso units per frame
  const frames: MotionFrame[] = []
  const plans: HumanShotPlan[] = []
  let t = 0
  const lerp = (a: Point, b: Point, u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
  const ease = (u: number) => u * u * (3 - 2 * u)
  /** elbow that makes the given 2D interior angle between shoulder and wrist (bent downward) */
  const elbowFor = (s: Point, w: Point, deg: number) => {
    const half = Math.hypot(w.x - s.x, w.y - s.y) / 2
    const d = half * Math.tan(((180 - deg) / 2) * (Math.PI / 180))
    const len = half * 2 || 1
    const n = { x: -(w.y - s.y) / len, y: (w.x - s.x) / len }
    const sign = n.y >= 0 ? 1 : -1
    return { x: (s.x + w.x) / 2 + n.x * d * sign, y: (s.y + w.y) / 2 + n.y * d * sign }
  }
  const push = (left: Point, right: Point, bowDeg: number, turn: number) => {
    const half = 0.375 * (1 - turn)
    const ls = { x: -half, y: 0 }
    const rs = { x: half, y: 0 }
    const l = { x: left.x + jitter(), y: left.y + jitter() }
    const rr = { x: right.x + jitter(), y: right.y + jitter() }
    frames.push({
      timestamp: t,
      leftShoulder: ls, rightShoulder: rs, leftWrist: l, rightWrist: rr,
      leftElbow: elbowFor(ls, l, bowDeg), rightElbow: { x: (rs.x + rr.x) / 2 + 0.05, y: (rs.y + rr.y) / 2 + 0.06 },
      confidence: 0.9, tracking: { body: true, left: true, right: true },
      posture: { torsoLean: false, shrug: false, shrugSide: null, leanDegrees: 0, shrugRatio: { left: 1, right: 1 } },
      framing: { bodyInFrame: true, leftHandVisible: true, rightHandVisible: true, distance: 'ok', roomToMove: true, hint: null, ready: true },
      source: 'camera',
    } as MotionFrame)
    t += 33
  }
  const chestL = { x: -0.07, y: 0.4 }
  const chestR = { x: 0.07, y: 0.4 }
  for (let s = 0; s < shots; s += 1) {
    const plan: HumanShotPlan = {
      bowTo: { x: r(-1.05, -0.85), y: r(0.02, 0.22) },
      bowElbowDeg: r(112, 145),
      stringTo: { x: r(0.26, 0.36), y: r(0.05, 0.2) },
      drawMs: r(800, 1500),
      aimMs: r(1400, 2600),
      aimAmp: r(0.04, 0.09),
      returnMs: r(700, 2000),
      returnTo: { x: r(-0.02, 0.12), y: r(0.2, 0.45) },
      turn: s % 2 === 1 ? r(0.08, 0.15) : 0,
    }
    plans.push(plan)
    // hands together at the chest
    for (let k = 0; k < 30; k += 1) push(chestL, chestR, 70, 0)
    // draw (the bow arm bends less as it extends, but never becomes straight)
    const nDraw = Math.round(plan.drawMs / 33)
    for (let k = 1; k <= nDraw; k += 1) {
      const u = ease(k / nDraw)
      push(lerp(chestL, plan.bowTo, u), lerp(chestR, plan.stringTo, u), 70 + (plan.bowElbowDeg - 70) * u, plan.turn * u)
    }
    // hold and aim: the bow hand moves up and down slowly
    const nAim = Math.round(plan.aimMs / 33)
    const phase = r(0, Math.PI * 2)
    let bow = plan.bowTo
    for (let k = 0; k < nAim; k += 1) {
      bow = { x: plan.bowTo.x + 0.03 * Math.sin(k / 23 + phase), y: plan.bowTo.y + plan.aimAmp * Math.sin(k / 15 + phase) }
      push(bow, plan.stringTo, plan.bowElbowDeg, plan.turn)
    }
    // slow, imperfect return toward the chest (the bow hand sags a little meanwhile)
    const nRet = Math.round(plan.returnMs / 33)
    const sag = { x: bow.x + 0.05, y: bow.y + r(0.05, 0.2) }
    for (let k = 1; k <= nRet; k += 1) {
      const u = ease(k / nRet)
      push(lerp(bow, sag, u), lerp(plan.stringTo, plan.returnTo, u), plan.bowElbowDeg, plan.turn)
    }
    for (let k = 0; k < 15; k += 1) push(sag, plan.returnTo, plan.bowElbowDeg, plan.turn)
    // bow hand comes in too: back to the chest for the next arrow
    for (let k = 1; k <= 20; k += 1) push(lerp(sag, chestL, k / 20), lerp(plan.returnTo, chestR, k / 20), 70, plan.turn * (1 - k / 20))
  }
  for (let k = 0; k < 30; k += 1) push(chestL, chestR, 70, 0)
  return { frames, plans }
}
