// Boating stroke detector and Archery draw detector: state machines, guards, debounce, pause gating.
// Round 1 (first human playtest): strokes must accept natural, imprecise sweeps.
// Round 2 (Archery final playtest): the shot is "bring the string hand back to the chest" after the hold;
// the bow arm (elbow angle, aiming moves) and a turned torso never block, pause or cancel anything.
import { describe, expect, it } from 'vitest'
import type { DrawState, MotionEvent, MotionFrame, Point, Side } from './contracts'
import { DRAW_CONFIG, DrawDetector, elbowAngleDeg } from './drawDetector'
import { MotionAdapter } from './MotionAdapter'
import { directorContext } from './session'
import { humanArcherFrames } from './humanArcher.fixture'
import { StrokeDetector } from './strokeDetector'
import { SyntheticPoseSource } from './synthetic'

const L_SHOULDER = { x: -0.375, y: 0 }
const R_SHOULDER = { x: 0.375, y: 0 }

/** Hand-made frame in body space. Elbows default to the shoulder–wrist midpoint pushed outward. */
function frame(at: number, wrists: Partial<Record<Side, Point>>, extra: Partial<MotionFrame> = {}): MotionFrame {
  const elbow = (side: Side, w: Point | undefined): Point | undefined => {
    if (!w) return undefined
    const s = side === 'left' ? L_SHOULDER : R_SHOULDER
    return { x: (s.x + w.x) / 2 + (side === 'left' ? -0.06 : 0.06), y: (s.y + w.y) / 2 }
  }
  return {
    timestamp: at,
    leftShoulder: L_SHOULDER, rightShoulder: R_SHOULDER,
    leftWrist: wrists.left, rightWrist: wrists.right,
    leftElbow: elbow('left', wrists.left), rightElbow: elbow('right', wrists.right),
    confidence: 1,
    tracking: { body: true, left: Boolean(wrists.left), right: Boolean(wrists.right) },
    posture: { torsoLean: false, shrug: false, shrugSide: null, leanDegrees: 0, shrugRatio: { left: 1, right: 1 } },
    framing: { bodyInFrame: true, leftHandVisible: true, rightHandVisible: true, distance: 'ok', roomToMove: true, hint: null, ready: true },
    source: 'synthetic',
    ...extra,
  }
}

type Pending = Omit<MotionEvent, 'id' | 'emittedAt'>

/**
 * Move the wrists along [ms, point] keyframes (linear), 30 fps; collect events. `wobble` perturbs the
 * right wrist per frame (natural up/down drift, tracking jitter).
 */
function drive(detector: { update(f: MotionFrame): Pending[] }, keys: [number, Partial<Record<Side, Point>>][], extra: (t: number) => Partial<MotionFrame> = () => ({}), wobble: (t: number) => Point = () => ({ x: 0, y: 0 })) {
  const events: Pending[] = []
  for (let k = 0; k < keys.length - 1; k += 1) {
    const [t0, a] = keys[k]
    const [t1, b] = keys[k + 1]
    for (let t = t0; t < t1; t += 33) {
      const u = (t - t0) / (t1 - t0)
      const lerp = (p?: Point, q?: Point) => (p && q ? { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u } : p ?? q)
      const r = lerp(a.right, b.right)
      const w = wobble(t)
      events.push(...detector.update(frame(t, { left: lerp(a.left, b.left), right: r && { x: r.x + w.x, y: r.y + w.y } }, extra(t))))
    }
  }
  return events
}
const strokesOf = (events: Pending[], type: 'STROKE_LEFT' | 'STROKE_RIGHT' = 'STROKE_RIGHT') => events.filter((e) => e.type === type)
/** the hold completed (DRAW_HOLD with progress 1) */
const armed = (events: Pending[]) => events.some((e) => e.type === 'DRAW_HOLD' && (e as Extract<MotionEvent, { type: 'DRAW_HOLD' }>).progress >= 1)

const NEUTRAL_R = { x: 0.15, y: 0.75 }
const OUT_R = { x: 0.9, y: 0.7 }
const NEUTRAL_L = { x: -0.15, y: 0.75 }

describe('StrokeDetector (Boating, scheme A outward sweep)', () => {
  // reach = 0.28 shoulder widths × 0.75 = 0.21 torso units; NEUTRAL_R → OUT_R travels 0.75
  it('counts one stroke per outward sweep, ready from the very first frame (no "hold still" wait)', () => {
    const d = new StrokeDetector()
    const events = drive(d, [
      [0, { left: NEUTRAL_L, right: NEUTRAL_R }],
      [400, { left: NEUTRAL_L, right: OUT_R }], // moving straight away: counts
      [1000, { left: NEUTRAL_L, right: OUT_R }], // parked out: still only one stroke
      [1400, { left: NEUTRAL_L, right: NEUTRAL_R }],
      [1800, { left: NEUTRAL_L, right: OUT_R }],
      [2200, { left: NEUTRAL_L, right: NEUTRAL_R }],
    ])
    expect(strokesOf(events)).toHaveLength(2)
    expect(strokesOf(events, 'STROKE_LEFT')).toHaveLength(0)
    const first = strokesOf(events)[0] as Extract<MotionEvent, { type: 'STROKE_RIGHT' }>
    expect(first.amplitude).toBeGreaterThanOrEqual(0.28) // shoulder widths
    expect(d.state().right.strokes).toBe(2)
  })

  it('tolerant: an imprecise sweep still counts — up/down drift, a rising or sinking path, bent elbows, slow or quick', () => {
    const cases: { name: string; out: Point; ms: number; from?: Point; wobble?: (t: number) => Point }[] = [
      { name: 'wavy path', out: { x: 0.55, y: 0.7 }, ms: 600, wobble: (t) => ({ x: 0, y: 0.14 * Math.sin(t / 70) }) },
      { name: 'rising toward the shoulder', out: { x: 0.5, y: 0.25 }, ms: 500 },
      { name: 'sinking toward the hip', out: { x: 0.5, y: 1.05 }, ms: 500 },
      { name: 'slow (1.6 s)', out: { x: 0.5, y: 0.75 }, ms: 1600 },
      { name: 'quick (0.2 s)', out: { x: 0.5, y: 0.75 }, ms: 200 },
      { name: 'never reaching outside the shoulder', from: { x: 0.05, y: 0.75 }, out: { x: 0.33, y: 0.75 }, ms: 500 },
    ]
    for (const c of cases) {
      const d = new StrokeDetector()
      const from = c.from ?? NEUTRAL_R
      const events = drive(d, [[0, { right: from }], [300, { right: from }], [300 + c.ms, { right: c.out }], [900 + c.ms, { right: c.out }]], undefined, c.wobble)
      expect(strokesOf(events).length, c.name).toBe(1)
    }
  })

  it('a small natural deviation around the stroke line still succeeds exactly once', () => {
    const d = new StrokeDetector()
    // just past the line (0.24 vs 0.21 torso units), with ±0.02 jitter on top
    let k = 0
    const jitter = () => ({ x: ((k++ * 7919) % 11) / 11 * 0.04 - 0.02, y: 0 })
    const events = drive(d, [[0, { right: NEUTRAL_R }], [300, { right: NEUTRAL_R }], [700, { right: { x: 0.39, y: 0.75 } }], [1700, { right: { x: 0.39, y: 0.75 } }]], undefined, jitter)
    expect(strokesOf(events)).toHaveLength(1)
  })

  it('the return never counts as a second stroke; a half-way return followed by going out again does not either', () => {
    const d = new StrokeDetector()
    const events = drive(d, [
      [0, { right: NEUTRAL_R }],
      [400, { right: OUT_R }],
      [700, { right: { x: 0.85, y: 0.72 } }], // back only a little (well under half a stroke)
      [1000, { right: OUT_R }], // out again: no second stroke
      [1500, { right: NEUTRAL_R }], // the real return
      [1900, { right: NEUTRAL_R }],
    ])
    expect(strokesOf(events)).toHaveLength(1)
    expect(d.state().right.phase).toBe('ready')
  })

  it('tracking jitter does not trigger repeated strokes (noisy hand held out, single-frame spikes at rest)', () => {
    const d = new StrokeDetector()
    let k = 0
    const noise = () => ({ x: (((k++ * 7919) % 13) / 13 - 0.5) * 0.08, y: (((k * 104729) % 7) / 7 - 0.5) * 0.08 })
    const held = drive(d, [[0, { right: NEUTRAL_R }], [400, { right: OUT_R }], [3400, { right: OUT_R }]], undefined, noise)
    expect(strokesOf(held)).toHaveLength(1)

    const spikes = new StrokeDetector()
    const events: Pending[] = []
    for (let t = 0; t < 3000; t += 33) {
      // every 10th frame the detector "sees" the hand far out for one frame only
      const spike = Math.round(t / 33) % 10 === 5
      events.push(...spikes.update(frame(t, { right: spike ? OUT_R : NEUTRAL_R })))
    }
    expect(strokesOf(events)).toHaveLength(0)
  })

  it('a sweep that stops well short is not a stroke; a near miss earns the gentle "a bit further" hint', () => {
    const d = new StrokeDetector()
    const events = drive(d, [[0, { right: NEUTRAL_R }], [300, { right: NEUTRAL_R }], [600, { right: { x: 0.27, y: 0.74 } }], [1000, { right: NEUTRAL_R }]])
    expect(strokesOf(events)).toHaveLength(0)
    expect(events.find((e) => e.type === 'STROKE_CANCEL')).toMatchObject({ side: 'right', reason: 'too-small' })
  })

  it('waving with the hand clearly above the head does not count', () => {
    const waving = drive(new StrokeDetector(), [
      [0, { right: { x: 0.3, y: -0.9 } }],
      [400, { right: { x: 0.95, y: -0.9 } }],
      [800, { right: { x: 0.3, y: -0.9 } }],
      [1200, { right: { x: 0.95, y: -0.9 } }],
    ])
    expect(strokesOf(waving)).toHaveLength(0)
  })

  it('a hand that teleports out in one frame and stays is rejected as a detection jump', () => {
    const d = new StrokeDetector()
    drive(d, [[0, { right: NEUTRAL_R }], [600, { right: NEUTRAL_R }]])
    const events = [633, 666, 699, 732].flatMap((t) => d.update(frame(t, { right: OUT_R })))
    expect(strokesOf(events)).toHaveLength(0)
    expect(events.find((e) => e.type === 'STROKE_CANCEL')).toMatchObject({ reason: 'too-fast' })
  })

  it('losing the hand mid-stroke cancels it; pause cancels and requires a return first', () => {
    const d = new StrokeDetector()
    drive(d, [[0, { right: NEUTRAL_R }], [300, { right: NEUTRAL_R }], [400, { right: { x: 0.3, y: 0.74 } }]])
    const lost = d.update(frame(433, {}))
    expect(lost.find((e) => e.type === 'STROKE_CANCEL')).toMatchObject({ reason: 'tracking-lost' })

    const p = new StrokeDetector()
    drive(p, [[0, { right: NEUTRAL_R }], [300, { right: NEUTRAL_R }], [400, { right: { x: 0.3, y: 0.74 } }]])
    expect(p.cancelAll(433, 'paused').find((e) => e.type === 'STROKE_CANCEL')).toMatchObject({ reason: 'paused' })
    // still out at resume: continuing outward must NOT complete the cancelled stroke
    const after = drive(p, [[466, { right: { x: 0.3, y: 0.74 } }], [700, { right: OUT_R }]])
    expect(strokesOf(after)).toHaveLength(0)
  })

  it('scheme B (downward stroke) works the same way on the vertical axis', () => {
    const d = new StrokeDetector()
    d.configure({ scheme: 'down', amplitude: 0.4 })
    const events = drive(d, [
      [0, { right: { x: 0.45, y: 0.35 } }],
      [600, { right: { x: 0.45, y: 0.35 } }],
      [1000, { right: { x: 0.5, y: 1.05 } }],
      [1400, { right: { x: 0.45, y: 0.35 } }],
    ])
    expect(strokesOf(events)).toHaveLength(1)
  })

  it('alternating strokes through the real adapter with the synthetic paddler', () => {
    const source = new SyntheticPoseSource({ manual: true, seed: 3 })
    const adapter = new MotionAdapter(source, { watchdog: false })
    source.attach(directorContext(adapter))
    source.useBot('boating')
    void adapter.start()
    adapter.enable('strokes')
    const events: MotionEvent[] = []
    adapter.subscribe((_f, e) => events.push(...e))
    for (let t = 0; t <= 12_000; t += 33) source.emit(t)
    const sides = events.filter((e) => e.type === 'STROKE_LEFT' || e.type === 'STROKE_RIGHT').map((e) => e.type)
    expect(sides.length).toBeGreaterThanOrEqual(9)
    // strictly alternating, like the bot paddles
    for (let i = 1; i < sides.length; i += 1) expect(sides[i]).not.toBe(sides[i - 1])
  })
})

// ---------- Archery (round 2: READY → DRAW → HOLD → RETURN_ARMED → FIRE) ----------

const R = { x: 0.375, y: 0 }
const Lsh = { x: -0.375, y: 0 }
const TOGETHER: Record<Side, Point> = { left: { x: -0.08, y: 0.38 }, right: { x: 0.08, y: 0.38 } }
const DRAWN: Record<Side, Point> = { left: { x: -1.3, y: 0.06 }, right: { x: 0.5, y: 0.04 } }
/** where the string hand comes back to: in front of the chest */
const CHEST = { x: 0.05, y: 0.3 }
const DRAW_ELBOW = { x: 0.98, y: 0.08 }
const HANGING: Record<Side, Point> = { left: { x: -0.5, y: 0.95 }, right: { x: 0.5, y: 0.95 } }
/** aim.y for a bow wrist at height y (bow shoulder at 0) */
const aimY = (y: number) => y - DRAW_CONFIG.aimRefBelowShoulder

type Fire = Extract<MotionEvent, { type: 'FIRE' }>
const firesOf = (events: Pending[]) => events.filter((e) => e.type === 'FIRE') as unknown as Fire[]
const cancelsOf = (events: Pending[]) => events.filter((e) => e.type === 'DRAW_CANCEL') as unknown as Extract<MotionEvent, { type: 'DRAW_CANCEL' }>[]
const lerp = (a: Point, b: Point, u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })

/** Archery frame: bow = left, string = right with an explicit elbow. */
function arms(at: number, left: Point, right: Point, opts: { rightElbow?: Point; leftElbow?: Point; shoulders?: [Point, Point] } = {}): MotionFrame {
  const f = frame(at, { left, right })
  f.leftElbow = opts.leftElbow ?? { x: (Lsh.x + left.x) / 2, y: (Lsh.y + left.y) / 2 + 0.02 }
  f.rightElbow = opts.rightElbow ?? { x: (R.x + right.x) / 2 + 0.06, y: (R.y + right.y) / 2 }
  if (opts.shoulders) [f.leftShoulder, f.rightShoulder] = opts.shoulders
  return f
}

/** Bow elbow (left arm, shoulder → DRAWN.left) that makes the given 2D elbow angle. */
function bowElbowFor(angleDeg: number): Point {
  const half = Math.hypot(DRAWN.left.x - Lsh.x, DRAWN.left.y - Lsh.y) / 2
  const d = half * Math.tan(((180 - angleDeg) / 2) * (Math.PI / 180))
  return { x: (Lsh.x + DRAWN.left.x) / 2, y: (Lsh.y + DRAWN.left.y) / 2 + d }
}

interface ShootOptions {
  /** bow-hand wobble amplitude during the hold */
  wobble?: number
  /** bow elbow angle (deg) from half-way through the draw on */
  bowAngle?: number
  /** time spent drawn before the return (ms) */
  holdMs?: number
  /** the return: duration (ms), destination, and how far toward it (1 = all the way) */
  returnMs?: number
  returnTo?: Point
  returnShare?: number
  /** bow wrist during the hold (aiming), default DRAWN.left (+ wobble) */
  bowAt?: (t: number) => Point
  /** bow wrist while returning (default: wherever it was at the end of the hold) */
  bowOnReturn?: Point
  /** turn the torso during the hold */
  twist?: boolean
  /** state probe called after every frame */
  probe?: (d: DrawDetector, t: number) => void
}

/** A scripted archer: READY → draw apart → hold → bring the string hand back toward the chest. */
function shoot(d: DrawDetector, opts: ShootOptions = {}) {
  const events: Pending[] = []
  let t = 0
  const push = (f: MotionFrame) => {
    events.push(...d.update(f))
    opts.probe?.(d, t)
  }
  const leftElbow = (u: number) => (opts.bowAngle && u > 0.5 ? bowElbowFor(opts.bowAngle) : undefined)
  const shoulders = (on: boolean): [Point, Point] | undefined => (opts.twist && on ? [{ x: -0.25, y: 0 }, { x: 0.25, y: 0 }] : undefined)
  for (; t < 700; t += 33) push(arms(t, TOGETHER.left, TOGETHER.right))
  for (let u = 0; u <= 1; u += 0.08, t += 33) push(arms(t, lerp(TOGETHER.left, DRAWN.left, u), lerp(TOGETHER.right, DRAWN.right, u), { rightElbow: lerp({ x: 0.3, y: 0.22 }, DRAW_ELBOW, u), leftElbow: leftElbow(u) }))
  const holdStart = t
  const end = t + (opts.holdMs ?? 1600)
  let bow = DRAWN.left
  for (; t < end; t += 33) {
    const w = opts.wobble ? opts.wobble * Math.sin(t / 60) : 0
    const at = opts.bowAt ? opts.bowAt(t - holdStart) : DRAWN.left
    bow = { x: at.x, y: at.y + w }
    push(arms(t, bow, DRAWN.right, { rightElbow: DRAW_ELBOW, leftElbow: leftElbow(1), shoulders: shoulders(true) }))
  }
  const returnStart = t
  const to = lerp(DRAWN.right, opts.returnTo ?? CHEST, opts.returnShare ?? 1)
  const steps = Math.max(1, Math.round((opts.returnMs ?? 270) / 33))
  const bowFrom = bow
  for (let i = 1; i <= steps; i += 1, t += 33) {
    const u = i / steps
    push(arms(t, opts.bowOnReturn ? lerp(bowFrom, opts.bowOnReturn, u) : bowFrom, lerp(DRAWN.right, to, u), { leftElbow: leftElbow(1), shoulders: shoulders(true) }))
  }
  for (let i = 0; i < 20; i += 1, t += 33) push(arms(t, opts.bowOnReturn ?? bowFrom, to, { leftElbow: leftElbow(1), shoulders: shoulders(true) }))
  return { events, t, returnStart }
}

function detector(holdMs = 800): DrawDetector {
  const d = new DrawDetector()
  d.configure({ drawSide: 'right', drawGoal: 0.9, holdMs })
  return d
}

/** Record every distinct value a DrawState field takes while shooting. */
function seen<K extends keyof DrawState>(key: K) {
  const values: DrawState[K][] = []
  return { values, probe: (d: DrawDetector) => values.push(d.state()[key]) }
}

describe('DrawDetector — FIRE by bringing the string hand back to the chest', () => {
  it('runs READY → DRAW → HOLD → RETURN_ARMED → FIRE and fires exactly once', () => {
    const d = detector()
    const { events } = shoot(d)
    expect(events.map((e) => e.type)).toEqual(['DRAW_START', 'DRAW_HOLD', 'DRAW_HOLD', 'FIRE'])
    const fire = firesOf(events)[0]
    expect(fire.drawRatio).toBeGreaterThan(1)
    expect(fire.holdStability).toBeGreaterThan(0.9)
    expect(Math.abs(fire.aim.x)).toBeLessThan(0.02)
    expect(Math.abs(fire.aim.y - aimY(DRAWN.left.y))).toBeLessThan(0.02)
    expect(d.state().phase).toBe('cooldown')
  })

  it('a slow, natural return fires too — there is no 450 ms window and no speed threshold', () => {
    for (const returnMs of [1200, 2500, 6000]) {
      const d = detector()
      const { events, returnStart } = shoot(d, { returnMs })
      const fires = firesOf(events)
      expect(fires, `${returnMs} ms return`).toHaveLength(1)
      expect(fires[0].timestamp - returnStart, `${returnMs} ms return`).toBeGreaterThan(450)
      expect(cancelsOf(events)).toHaveLength(0)
    }
  })

  it('a partial return is enough: half of the way back fires, a quarter does not', () => {
    expect(firesOf(shoot(detector(), { returnShare: 0.25 }).events)).toHaveLength(0)
    expect(firesOf(shoot(detector(), { returnShare: 0.5 }).events)).toHaveLength(1)
  })

  it('tolerant return: drifting up or down a little, a bent elbow, the bow hand still aiming', () => {
    for (const returnTo of [{ x: 0.0, y: -0.15 }, { x: 0.05, y: 0.45 }, { x: 0.15, y: 0.2 }]) {
      const d = detector()
      const { events } = shoot(d, { returnTo, bowOnReturn: { x: -1.25, y: 0.12 } })
      expect(firesOf(events), JSON.stringify(returnTo)).toHaveLength(1)
    }
  })

  it('no FIRE before HOLD: coming back before the circle is full is not a shot, and says why', () => {
    const d = detector()
    const cues = seen('cue')
    const { events, t } = shoot(d, { holdMs: 200, probe: cues.probe })
    expect(firesOf(events)).toHaveLength(0)
    expect(armed(events)).toBe(false)
    expect(cues.values).toContain('early-return')
    // putting the bow down after that ends the attempt with the same reason (no penalty)
    const after: Pending[] = []
    let u = t
    for (let i = 0; i < 20; i += 1, u += 33) after.push(...d.update(arms(u, TOGETHER.left, TOGETHER.right)))
    expect(cancelsOf(after)[0]).toMatchObject({ reason: 'early-return' })
    expect(firesOf(after)).toHaveLength(0)
  })

  it('an early return can be corrected without starting over: pull out again, hold, return → one shot', () => {
    const d = detector()
    const events: Pending[] = []
    let t = 0
    for (; t < 700; t += 33) events.push(...d.update(arms(t, TOGETHER.left, TOGETHER.right)))
    for (let u = 0; u <= 1; u += 0.08, t += 33) events.push(...d.update(arms(t, lerp(TOGETHER.left, DRAWN.left, u), lerp(TOGETHER.right, DRAWN.right, u))))
    for (let i = 0; i < 6; i += 1, t += 33) events.push(...d.update(arms(t, DRAWN.left, DRAWN.right)))
    for (let i = 1; i <= 8; i += 1, t += 33) events.push(...d.update(arms(t, DRAWN.left, lerp(DRAWN.right, CHEST, i / 8))))
    expect(d.state().phase).toBe('draw')
    for (let i = 1; i <= 8; i += 1, t += 33) events.push(...d.update(arms(t, DRAWN.left, lerp(CHEST, DRAWN.right, i / 8))))
    for (let i = 0; i < 50; i += 1, t += 33) events.push(...d.update(arms(t, DRAWN.left, DRAWN.right)))
    for (let i = 1; i <= 10; i += 1, t += 33) events.push(...d.update(arms(t, DRAWN.left, lerp(DRAWN.right, CHEST, i / 10))))
    expect(firesOf(events)).toHaveLength(1)
    expect(new Set(events.filter((e) => e.type === 'DRAW_START').map((e) => (e as unknown as { attemptId: number }).attemptId)).size).toBe(1)
  })

  it('jitter while drawing and holding never fires (±0.05 noise, one-frame glitches toward the bow)', () => {
    const d = detector()
    const events: Pending[] = []
    let t = 0
    for (; t < 700; t += 33) events.push(...d.update(arms(t, TOGETHER.left, TOGETHER.right)))
    for (let u = 0; u <= 1; u += 0.05, t += 33) {
      const j = ((Math.round(t / 33) * 7919) % 11) / 11 * 0.1 - 0.05
      events.push(...d.update(arms(t, lerp(TOGETHER.left, DRAWN.left, u), { x: lerp(TOGETHER.right, DRAWN.right, u).x + j, y: DRAWN.right.y })))
    }
    for (const end = t + 5000; t < end; t += 33) {
      const k = Math.round(t / 33)
      const j = ((k * 7919) % 11) / 11 * 0.1 - 0.05
      const glitch = k % 9 === 0 ? -0.35 : 0
      events.push(...d.update(arms(t, { x: DRAWN.left.x + j, y: DRAWN.left.y - j }, { x: DRAWN.right.x + j + glitch, y: DRAWN.right.y + j })))
    }
    expect(armed(events)).toBe(true)
    expect(firesOf(events)).toHaveLength(0)
    expect(d.state().phase).toBe('armed')
  })

  it('tracking loss while armed cancels and is never a shot, even if the hand reappears at the chest', () => {
    const d = detector()
    const events: Pending[] = []
    let t = 0
    for (; t < 700; t += 33) events.push(...d.update(arms(t, TOGETHER.left, TOGETHER.right)))
    for (let k = 0; k <= 1; k += 0.08, t += 33) events.push(...d.update(arms(t, lerp(TOGETHER.left, DRAWN.left, k), lerp(TOGETHER.right, DRAWN.right, k))))
    for (const end = t + 1600; t < end; t += 33) events.push(...d.update(arms(t, DRAWN.left, DRAWN.right)))
    expect(d.state().phase).toBe('armed')
    events.push(...d.update(frame(t, { left: DRAWN.left }))) // string hand lost
    for (let i = 0; i < 20; i += 1) events.push(...d.update(arms((t += 33), DRAWN.left, CHEST)))
    expect(firesOf(events)).toHaveLength(0)
    expect(cancelsOf(events)[0]).toMatchObject({ reason: 'tracking-lost' })
  })

  it('one draw shoots one arrow; no second arrow before the hands are back together (RESET)', () => {
    const d = detector()
    const first = shoot(d)
    let t = first.t
    const after: Pending[] = []
    // the string hand flaps out and back, the bow stays up: no new draw, no second arrow
    for (let i = 0; i < 90; i += 1, t += 33) after.push(...d.update(arms(t, DRAWN.left, i % 12 < 6 ? DRAWN.right : CHEST)))
    expect(firesOf([...first.events, ...after])).toHaveLength(1)
    expect(after.some((e) => e.type === 'DRAW_START')).toBe(false)
    // hands together again → the next arrow works
    for (let i = 0; i < 30; i += 1, t += 33) after.push(...d.update(arms(t, TOGETHER.left, TOGETHER.right)))
    for (let k = 0; k <= 1; k += 0.08, t += 33) after.push(...d.update(arms(t, lerp(TOGETHER.left, DRAWN.left, k), lerp(TOGETHER.right, DRAWN.right, k))))
    for (let i = 0; i < 50; i += 1, t += 33) after.push(...d.update(arms(t, DRAWN.left, DRAWN.right)))
    for (let i = 1; i <= 10; i += 1, t += 33) after.push(...d.update(arms(t, DRAWN.left, lerp(DRAWN.right, CHEST, i / 10))))
    expect(firesOf(after)).toHaveLength(1)
  })

  it('tracking loss mid-draw cancels; the next draw needs READY again', () => {
    const d = detector()
    let t = 0
    for (; t < 700; t += 33) d.update(arms(t, TOGETHER.left, TOGETHER.right))
    const events: Pending[] = []
    for (let u = 0; u <= 0.6; u += 0.1, t += 33) events.push(...d.update(arms(t, lerp(TOGETHER.left, DRAWN.left, u), lerp(TOGETHER.right, DRAWN.right, u))))
    expect(events.some((e) => e.type === 'DRAW_START')).toBe(true)
    events.push(...d.update(frame(t, { left: DRAWN.left })))
    expect(cancelsOf(events)[0]).toMatchObject({ reason: 'tracking-lost' })
    expect(d.state().phase).toBe('wait-ready')
    const later: Pending[] = []
    for (let i = 0; i < 40; i += 1, t += 33) later.push(...d.update(arms(t, DRAWN.left, DRAWN.right)))
    expect(later.some((e) => e.type === 'DRAW_START')).toBe(false)
  })

  it('arms dropped to the sides are not a draw, and raising them back to the chest is not a shot', () => {
    const d = new DrawDetector()
    d.configure({ drawSide: 'right', drawGoal: 0.55, holdMs: 800 }) // a real goal: hanging arms span more than it
    const events: Pending[] = []
    let t = 0
    for (; t < 700; t += 33) events.push(...d.update(arms(t, TOGETHER.left, TOGETHER.right)))
    for (let k = 0; k <= 1; k += 0.1, t += 33) events.push(...d.update(arms(t, lerp(TOGETHER.left, HANGING.left, k), lerp(TOGETHER.right, HANGING.right, k))))
    for (const end = t + 2500; t < end; t += 33) events.push(...d.update(arms(t, HANGING.left, HANGING.right)))
    for (let k = 0; k <= 1; k += 0.1, t += 33) events.push(...d.update(arms(t, lerp(HANGING.left, TOGETHER.left, k), lerp(HANGING.right, TOGETHER.right, k))))
    expect(firesOf(events)).toHaveLength(0)
    expect(armed(events)).toBe(false)
  })

  it('dropping the string arm down to the side after the hold is not a shot (the return must be mostly sideways)', () => {
    const d = detector()
    const { events } = shoot(d, { returnTo: { x: 0.2, y: 0.9 }, returnMs: 700 })
    expect(firesOf(events)).toHaveLength(0)
  })

  it('pause gating through the adapter cancels the attempt and nothing fires while paused', () => {
    const source = new SyntheticPoseSource({ manual: true, seed: 5 })
    const adapter = new MotionAdapter(source, { watchdog: false })
    source.attach(directorContext(adapter))
    source.useBot('archery')
    void adapter.start()
    adapter.enable('draw')
    adapter.configureDraw({ drawSide: 'right', drawGoal: 0.9, holdMs: 900 })
    const events: MotionEvent[] = []
    adapter.subscribe((_f, e) => events.push(...e))
    let t = 0
    while (adapter.drawState().phase !== 'hold' && t < 10_000) source.emit((t += 33))
    expect(adapter.drawState().phase).toBe('hold')
    adapter.setDetectionActive(false)
    for (let i = 0; i < 90; i += 1) source.emit((t += 33))
    expect(events.some((e) => e.type === 'FIRE')).toBe(false)
    expect(events.find((e) => e.type === 'DRAW_CANCEL')).toMatchObject({ reason: 'paused' })
    adapter.setDetectionActive(true)
    while (!events.some((e) => e.type === 'FIRE') && t < 30_000) source.emit((t += 33))
    const fires = events.filter((e) => e.type === 'FIRE') as Fire[]
    expect(fires).toHaveLength(1)
    expect(new Set(fires.map((e) => e.attemptId)).size).toBe(fires.length)
  })
})

describe('DrawDetector — the bow arm is never a blocking condition', () => {
  it('slightly and moderately bent bow arms change nothing: same shot, no guard, no hint', () => {
    for (const angle of [150, 118, 100, 88]) {
      const d = detector()
      expect(Math.round(elbowAngleDeg(Lsh, bowElbowFor(angle), DRAWN.left))).toBe(angle)
      const guards = seen('guard')
      const hints = seen('hint')
      const { events } = shoot(d, { bowAngle: angle, probe: (x) => { guards.probe(x); hints.probe(x) } })
      expect(firesOf(events), `${angle}°`).toHaveLength(1)
      expect(cancelsOf(events), `${angle}°`).toHaveLength(0)
      expect(guards.values.every((g) => g === null), `${angle}°`).toBe(true)
      expect(hints.values.every((h) => h === null), `${angle}°`).toBe(true)
    }
  })

  it('a very bent bow arm held for a long time earns at most a soft hint — the hold and the shot are unaffected', () => {
    const straight = shoot(detector())
    const d = detector()
    const hints = seen('hint')
    const holds = seen('holdProgress')
    const { events } = shoot(d, { bowAngle: 60, holdMs: 4000, probe: (x) => { hints.probe(x); holds.probe(x) } })
    expect(firesOf(events)).toHaveLength(1)
    expect(cancelsOf(events)).toHaveLength(0)
    expect(hints.values).toContain('bow-arm-straighter')
    // hint only after it persisted (≥ 3 s): never in the first second of the hold
    expect(hints.values.slice(0, 50).every((h) => h === null)).toBe(true)
    // the hold completed as fast as with a straight arm
    const armedAt = (ev: Pending[]) => ev.find((e) => e.type === 'DRAW_HOLD' && (e as unknown as { progress: number }).progress >= 1)!.timestamp
    expect(armedAt(events)).toBe(armedAt(straight.events))
    expect(holds.values.some((p) => p >= 1)).toBe(true)
  })

  it('a turned torso is only a soft hint (no pause, no cancel); the shot still goes', () => {
    const d = detector()
    const hints = seen('hint')
    const { events } = shoot(d, { twist: true, holdMs: 4000, probe: hints.probe })
    expect(firesOf(events)).toHaveLength(1)
    expect(cancelsOf(events)).toHaveLength(0)
    expect(hints.values).toContain('turned')
  })

  it('a string hand that never moves out (bow arm alone) holds nothing and says "pull the string hand out"', () => {
    const d = detector()
    const events: Pending[] = []
    const cues: DrawState['cue'][] = []
    let t = 0
    for (; t < 700; t += 33) events.push(...d.update(arms(t, TOGETHER.left, TOGETHER.right)))
    for (let k = 0; k <= 1; k += 0.08, t += 33) events.push(...d.update(arms(t, lerp(TOGETHER.left, DRAWN.left, k), TOGETHER.right)))
    for (let i = 0; i < 60; i += 1, t += 33) {
      events.push(...d.update(arms(t, DRAWN.left, TOGETHER.right)))
      cues.push(d.state().cue)
    }
    expect(armed(events)).toBe(false)
    expect(cues).toContain('pull-string-out')
    // pulling it out then works normally
    for (let i = 1; i <= 8; i += 1, t += 33) events.push(...d.update(arms(t, DRAWN.left, lerp(TOGETHER.right, DRAWN.right, i / 8))))
    for (let i = 0; i < 50; i += 1, t += 33) events.push(...d.update(arms(t, DRAWN.left, DRAWN.right)))
    for (let i = 1; i <= 10; i += 1, t += 33) events.push(...d.update(arms(t, DRAWN.left, lerp(DRAWN.right, CHEST, i / 10))))
    expect(firesOf(events)).toHaveLength(1)
  })
})

describe('DrawDetector — aiming with the bow hand, and aim locking', () => {
  it('moving the bow hand moves the aim (its height) and never pauses, resets or cancels the hold', () => {
    const still = shoot(detector())
    const d = detector()
    const samples: { t: number; aim: Point; phase: string; guard: unknown; cue: unknown }[] = []
    // slow aiming sweep: up 0.15, down 0.2, sideways a little
    const bowAt = (ms: number) => ({ x: DRAWN.left.x + 0.08 * Math.sin(ms / 400), y: DRAWN.left.y + 0.18 * Math.sin(ms / 300) })
    const { events } = shoot(d, { bowAt, probe: (x, t) => { const s = x.state(); samples.push({ t, aim: s.aim, phase: s.phase, guard: s.guard, cue: s.cue }) } })
    const armedAt = (ev: Pending[]) => ev.find((e) => e.type === 'DRAW_HOLD' && (e as unknown as { progress: number }).progress >= 1)!.timestamp
    expect(armedAt(events)).toBe(armedAt(still.events))
    expect(firesOf(events)).toHaveLength(1)
    expect(cancelsOf(events)).toHaveLength(0)
    expect(samples.every((s) => s.guard === null && s.cue === null)).toBe(true)
    const aiming = samples.filter((s) => s.phase === 'hold' || s.phase === 'armed')
    const ys = aiming.map((s) => s.aim.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.25) // the reticle really travels with the hand
    // the reticle height follows the hand all the way: its extremes are the hand's extremes
    expect(Math.abs(Math.max(...ys) - aimY(DRAWN.left.y + 0.18))).toBeLessThan(0.03)
    expect(Math.abs(Math.min(...ys) - aimY(DRAWN.left.y - 0.18))).toBeLessThan(0.03)
    expect(aiming.every((s) => s.aim.x === 0)).toBe(true) // sideways is not mapped (side-on range)
  })

  it('the arrow uses the aim locked when the return began, not where the bow hand went while returning', () => {
    // aim high during the hold, then the bow hand sags while the string hand comes back
    const high = { x: DRAWN.left.x, y: -0.12 }
    const d = detector()
    const locked = seen('lockedAim')
    const { events } = shoot(d, { bowAt: () => high, bowOnReturn: { x: -1.2, y: 0.45 }, returnMs: 600, probe: locked.probe })
    const fire = firesOf(events)[0]
    expect(fire).toBeDefined()
    expect(Math.abs(fire.aim.y - aimY(high.y))).toBeLessThan(0.03)
    expect(locked.values.some((v) => v !== null)).toBe(true)
    // without the lock the sag would have moved the aim by far more than a ring
    expect(aimY(0.45) - aimY(high.y)).toBeGreaterThan(0.5)
  })

  it('a wobbly hold lowers stability; a slow deliberate aiming glide does not', () => {
    const steady = firesOf(shoot(detector()).events)[0]
    const wobbly = firesOf(shoot(detector(), { wobble: 0.05 }).events)[0]
    const glide = firesOf(shoot(detector(), { bowAt: (ms) => ({ x: DRAWN.left.x, y: DRAWN.left.y - 0.12 * Math.min(1, ms / 1600) }) }).events)[0]
    expect(wobbly.holdStability).toBeLessThan(steady.holdStability - 0.2)
    expect(glide.holdStability).toBeGreaterThan(0.9)
  })
})

describe('DrawDetector — a first-time player (human-like replay of the round-2 playtest)', () => {
  it('20 seeded sessions × 5 arrows: every arrow fires, nothing nags about the bow arm, nothing blocks', () => {
    // bow arm at its limit and bent 112–145°, aiming moves, ±0.02 jitter, a short string-hand pull,
    // slow (0.7–2 s) imperfect returns with a sagging bow hand, a slightly turned torso on every 2nd arrow.
    // The round-1 detector fired 31 / 100 of these (3 sessions with no arrow at all, every miss a
    // "slow sink = lowered" cancel) and showed the bow-arm hint on 41 % of active frames.
    for (let seed = 1; seed <= 20; seed += 1) {
      const d = new DrawDetector()
      d.configure({ drawSide: 'right', drawGoal: 0.55, holdMs: 700 })
      const { frames } = humanArcherFrames(seed, 5)
      const events: Pending[] = []
      let nagged = 0
      for (const f of frames) {
        events.push(...d.update(f))
        if (d.state().hint === 'bow-arm-straighter' || d.state().guard) nagged += 1
      }
      expect(firesOf(events), `seed ${seed}`).toHaveLength(5)
      expect(cancelsOf(events), `seed ${seed}`).toHaveLength(0)
      expect(nagged, `seed ${seed}`).toBe(0)
    }
  })
})
