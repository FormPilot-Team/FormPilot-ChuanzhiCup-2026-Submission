// Boating stroke detector and Archery draw detector: state machines, guards, debounce, pause gating.
// Round 1 (first human playtest): strokes must accept natural, imprecise sweeps; archery must not fire
// while the player is still drawing, and a slightly bent bow arm must not block the game.
import { describe, expect, it } from 'vitest'
import type { MotionEvent, MotionFrame, Point, Side } from './contracts'
import { DrawDetector, elbowAngleDeg } from './drawDetector'
import { MotionAdapter } from './MotionAdapter'
import { directorContext } from './session'
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

// ---------- Archery ----------

const R = { x: 0.375, y: 0 }
const Lsh = { x: -0.375, y: 0 }
const TOGETHER: Record<Side, Point> = { left: { x: -0.08, y: 0.38 }, right: { x: 0.08, y: 0.38 } }
const DRAWN: Record<Side, Point> = { left: { x: -1.3, y: 0.06 }, right: { x: 0.5, y: 0.04 } }
const DRAW_ELBOW = { x: 0.98, y: 0.08 }

/** Archery frame: bow = left (straight arm), string = right with an explicit elbow. */
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

function shoot(d: DrawDetector, opts: { wobble?: number; slowRelease?: boolean; bentBow?: boolean; bowAngle?: number; twist?: boolean; noElbow?: boolean; drawJitter?: number; holdMs?: number } = {}) {
  const events: Pending[] = []
  let t = 0
  const lerp = (a: Point, b: Point, u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
  const push = (f: MotionFrame) => events.push(...d.update(f))
  const rightElbowAt = (u: number) => (opts.noElbow ? undefined : lerp({ x: 0.3, y: 0.22 }, DRAW_ELBOW, u))
  const leftElbowAt = () => (opts.bentBow ? { x: -0.55, y: 0.6 } : opts.bowAngle ? bowElbowFor(opts.bowAngle) : undefined)
  const shoulders = (u: number): [Point, Point] | undefined => (opts.twist ? [{ x: -0.375 + 0.15 * u, y: 0 }, { x: 0.375 - 0.15 * u, y: 0 }] : undefined)
  for (; t < 700; t += 33) push(arms(t, TOGETHER.left, TOGETHER.right))
  for (let u = 0; u <= 1; u += 0.08, t += 33) push(arms(t, lerp(TOGETHER.left, DRAWN.left, u), lerp(TOGETHER.right, DRAWN.right, u), { rightElbow: rightElbowAt(u), leftElbow: u > 0.5 ? leftElbowAt() : undefined, shoulders: shoulders(u) }))
  const end = t + (opts.holdMs ?? 1600)
  for (; t < end; t += 33) {
    const w = opts.wobble ? opts.wobble * Math.sin(t / 60) : 0
    const j = opts.drawJitter ? opts.drawJitter * (((Math.round(t / 33) * 7919) % 11) / 11 - 0.5) * 2 : 0
    push(arms(t, { x: DRAWN.left.x, y: DRAWN.left.y + w }, { x: DRAWN.right.x + j, y: DRAWN.right.y }, { rightElbow: rightElbowAt(1), leftElbow: leftElbowAt(), shoulders: shoulders(1) }))
  }
  const releaseSteps = opts.slowRelease ? 60 : 8
  for (let i = 1; i <= releaseSteps; i += 1, t += 33) push(arms(t, DRAWN.left, lerp(DRAWN.right, { x: -0.2, y: 0.12 }, i / releaseSteps), { rightElbow: rightElbowAt(1 - i / releaseSteps) }))
  for (let i = 0; i < 20; i += 1, t += 33) push(arms(t, DRAWN.left, { x: -0.2, y: 0.12 }))
  return { events, t }
}

describe('DrawDetector (Archery READY → DRAW → HOLD → RELEASE)', () => {
  it('runs the full sequence and releases exactly once with a steady, full draw', () => {
    const d = new DrawDetector()
    d.configure({ drawSide: 'right', drawGoal: 0.9, holdMs: 800 })
    const { events } = shoot(d)
    const types = events.map((e) => e.type)
    expect(types).toEqual(['DRAW_START', 'DRAW_HOLD', 'DRAW_HOLD', 'RELEASE'])
    const release = events.find((e) => e.type === 'RELEASE') as Extract<MotionEvent, { type: 'RELEASE' }>
    expect(release.drawRatio).toBeGreaterThan(1)
    expect(release.holdStability).toBeGreaterThan(0.9)
    expect(Math.hypot(release.aim.x, release.aim.y)).toBeLessThan(0.03)
    expect(d.state().phase).toBe('cooldown')
  })

  it('a wobbly hold lowers stability and moves the aim (hit depends on the motion, not chance)', () => {
    const steady = new DrawDetector()
    steady.configure({ drawGoal: 0.9, holdMs: 800 })
    const wobbly = new DrawDetector()
    wobbly.configure({ drawGoal: 0.9, holdMs: 800 })
    const a = shoot(steady).events.find((e) => e.type === 'RELEASE') as Extract<MotionEvent, { type: 'RELEASE' }>
    const b = shoot(wobbly, { wobble: 0.05 }).events.find((e) => e.type === 'RELEASE') as Extract<MotionEvent, { type: 'RELEASE' }>
    expect(b).toBeDefined()
    expect(b.holdStability).toBeLessThan(a.holdStability - 0.2)
  })

  it('torso rotation guard: a "draw" made by turning the body is cancelled, never released', () => {
    const d = new DrawDetector()
    d.configure({ drawGoal: 0.9, holdMs: 800 })
    const { events } = shoot(d, { twist: true, holdMs: 2600 })
    expect(events.some((e) => e.type === 'RELEASE')).toBe(false)
    expect(events.find((e) => e.type === 'DRAW_CANCEL')).toMatchObject({ reason: 'turned' })
  })

  it('a player already turned at READY is caught too (the frontal width is remembered)', () => {
    const d = new DrawDetector()
    d.configure({ drawGoal: 0.9, holdMs: 800 })
    let t = 0
    const events: Pending[] = []
    for (; t < 1500; t += 33) events.push(...d.update(arms(t, TOGETHER.left, TOGETHER.right)))
    const turned: [Point, Point] = [{ x: -0.25, y: 0 }, { x: 0.25, y: 0 }]
    for (; t < 3000; t += 33) events.push(...d.update(arms(t, TOGETHER.left, TOGETHER.right, { shoulders: turned })))
    for (let i = 0; i < 60; i += 1, t += 33) events.push(...d.update(arms(t, DRAWN.left, DRAWN.right, { rightElbow: DRAW_ELBOW, shoulders: turned })))
    expect(events.some((e) => e.type === 'RELEASE')).toBe(false)
    expect(events.find((e) => e.type === 'DRAW_CANCEL')).toMatchObject({ reason: 'turned' })
  })

  it('a clearly bent bow arm held for a while pauses the hold (no shot) — never an instant block', () => {
    const bent = new DrawDetector()
    bent.configure({ drawGoal: 0.9, holdMs: 800 })
    expect(elbowAngleDeg({ x: -0.375, y: 0 }, { x: -0.55, y: 0.6 }, DRAWN.left)).toBeLessThan(95)
    const a = shoot(bent, { bentBow: true }).events
    expect(a.some((e) => e.type === 'RELEASE')).toBe(false)
    expect(armed(a)).toBe(false)
    // the bent arm itself never cancels the attempt
    expect(a.some((e) => e.type === 'DRAW_CANCEL' && (e as Extract<MotionEvent, { type: 'DRAW_CANCEL' }>).reason === 'bow-arm-bent')).toBe(false)
  })

  it('a slightly bent bow arm (perspective, a relaxed elbow) does not block: the shot goes, with only a soft hint', () => {
    for (const angle of [118, 108, 100]) {
      const d = new DrawDetector()
      d.configure({ drawGoal: 0.9, holdMs: 800 })
      expect(Math.round(elbowAngleDeg(Lsh, bowElbowFor(angle), DRAWN.left))).toBe(angle)
      const hints: (string | null)[] = []
      const original = d.update.bind(d)
      d.update = (f) => {
        const out = original(f)
        hints.push(d.state().hint)
        return out
      }
      const { events } = shoot(d, { bowAngle: angle })
      expect(events.filter((e) => e.type === 'RELEASE'), `${angle}°`).toHaveLength(1)
      expect(hints).toContain('bow-arm-straighter')
      expect(events.some((e) => e.type === 'DRAW_CANCEL')).toBe(false)
    }
  })

  it('a moment of clearly bent arm (shorter than the 700 ms sustain) does not stop the shot', () => {
    const d = new DrawDetector()
    d.configure({ drawGoal: 0.9, holdMs: 800 })
    const events: Pending[] = []
    let t = 0
    const lerp = (a: Point, b: Point, u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
    for (; t < 700; t += 33) events.push(...d.update(arms(t, TOGETHER.left, TOGETHER.right)))
    for (let u = 0; u <= 1; u += 0.08, t += 33) events.push(...d.update(arms(t, lerp(TOGETHER.left, DRAWN.left, u), lerp(TOGETHER.right, DRAWN.right, u), { rightElbow: lerp({ x: 0.3, y: 0.22 }, DRAW_ELBOW, u) })))
    const blip = t + 400
    for (const end = t + 1600; t < end; t += 33) events.push(...d.update(arms(t, DRAWN.left, DRAWN.right, { rightElbow: DRAW_ELBOW, leftElbow: t < blip && t > blip - 300 ? bowElbowFor(70) : undefined })))
    for (let i = 1; i <= 8; i += 1, t += 33) events.push(...d.update(arms(t, DRAWN.left, lerp(DRAWN.right, { x: -0.2, y: 0.12 }, i / 8), { rightElbow: lerp(DRAW_ELBOW, { x: 0.3, y: 0.22 }, i / 8) })))
    expect(events.filter((e) => e.type === 'RELEASE')).toHaveLength(1)
  })

  it('a string hand without the elbow moving out (wrist flick) never completes the hold', () => {
    const flick = new DrawDetector()
    flick.configure({ drawGoal: 0.9, holdMs: 800 })
    // string elbow stays where it was at READY while the wrist travels
    const b: Pending[] = []
    let t = 0
    for (; t < 700; t += 33) b.push(...flick.update(arms(t, TOGETHER.left, TOGETHER.right, { rightElbow: { x: 0.3, y: 0.22 } })))
    for (let i = 0; i < 60; i += 1, t += 33) b.push(...flick.update(arms(t, DRAWN.left, DRAWN.right, { rightElbow: { x: 0.3, y: 0.22 } })))
    expect(b.some((e) => e.type === 'RELEASE')).toBe(false)
    expect(armed(b)).toBe(false)
  })

  it('jitter while drawing and holding never releases (noisy string hand, single-frame dropouts of the draw)', () => {
    const d = new DrawDetector()
    d.configure({ drawGoal: 0.9, holdMs: 800 })
    const events: Pending[] = []
    let t = 0
    const lerp = (a: Point, b: Point, u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
    for (; t < 700; t += 33) events.push(...d.update(arms(t, TOGETHER.left, TOGETHER.right)))
    for (let u = 0; u <= 1; u += 0.05, t += 33) {
      const j = ((Math.round(t / 33) * 7919) % 11) / 11 * 0.1 - 0.05
      events.push(...d.update(arms(t, lerp(TOGETHER.left, DRAWN.left, u), { x: lerp(TOGETHER.right, DRAWN.right, u).x + j, y: DRAWN.right.y }, { rightElbow: lerp({ x: 0.3, y: 0.22 }, DRAW_ELBOW, u) })))
    }
    // held for 4 s (armed after ~0.8 s) with ±0.05 noise and, every 9th frame, a one-frame glitch that
    // puts the string hand 0.35 back toward the bow (the old detector fired on exactly this)
    for (const end = t + 4000; t < end; t += 33) {
      const k = Math.round(t / 33)
      const j = ((k * 7919) % 11) / 11 * 0.1 - 0.05
      const glitch = k % 9 === 0 ? -0.35 : 0
      events.push(...d.update(arms(t, DRAWN.left, { x: DRAWN.right.x + j + glitch, y: DRAWN.right.y }, { rightElbow: DRAW_ELBOW })))
    }
    expect(armed(events)).toBe(true)
    expect(events.some((e) => e.type === 'RELEASE')).toBe(false)
    expect(d.state().phase).toBe('armed')
  })

  it('no RELEASE before HOLD: drawing and snapping straight back is not a shot', () => {
    const d = new DrawDetector()
    d.configure({ drawGoal: 0.9, holdMs: 800 })
    const events: Pending[] = []
    let t = 0
    const lerp = (a: Point, b: Point, u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
    for (; t < 700; t += 33) events.push(...d.update(arms(t, TOGETHER.left, TOGETHER.right)))
    for (let u = 0; u <= 1; u += 0.1, t += 33) events.push(...d.update(arms(t, lerp(TOGETHER.left, DRAWN.left, u), lerp(TOGETHER.right, DRAWN.right, u), { rightElbow: lerp({ x: 0.3, y: 0.22 }, DRAW_ELBOW, u) })))
    for (let i = 0; i < 6; i += 1, t += 33) events.push(...d.update(arms(t, DRAWN.left, DRAWN.right, { rightElbow: DRAW_ELBOW }))) // 0.2 s, far short of the hold
    for (let i = 1; i <= 8; i += 1, t += 33) events.push(...d.update(arms(t, DRAWN.left, lerp(DRAWN.right, { x: -0.2, y: 0.12 }, i / 8))))
    expect(events.some((e) => e.type === 'RELEASE')).toBe(false)
  })

  it('one draw shoots at most one arrow, and losing tracking while armed is never a release', () => {
    const d = new DrawDetector()
    d.configure({ drawGoal: 0.9, holdMs: 800 })
    const first = shoot(d)
    let t = first.t
    const after: Pending[] = []
    // the string hand flaps back and forth after the shot: no second arrow without a new READY
    for (let i = 0; i < 60; i += 1, t += 33) after.push(...d.update(arms(t, DRAWN.left, i % 10 < 5 ? DRAWN.right : { x: -0.2, y: 0.12 }, { rightElbow: DRAW_ELBOW })))
    expect([...first.events, ...after].filter((e) => e.type === 'RELEASE')).toHaveLength(1)

    const lost = new DrawDetector()
    lost.configure({ drawGoal: 0.9, holdMs: 800 })
    const events: Pending[] = []
    let u = 0
    const lerp = (a: Point, b: Point, k: number) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })
    for (; u < 700; u += 33) events.push(...lost.update(arms(u, TOGETHER.left, TOGETHER.right)))
    for (let k = 0; k <= 1; k += 0.08, u += 33) events.push(...lost.update(arms(u, lerp(TOGETHER.left, DRAWN.left, k), lerp(TOGETHER.right, DRAWN.right, k), { rightElbow: lerp({ x: 0.3, y: 0.22 }, DRAW_ELBOW, k) })))
    for (const end = u + 1400; u < end; u += 33) events.push(...lost.update(arms(u, DRAWN.left, DRAWN.right, { rightElbow: DRAW_ELBOW })))
    expect(lost.state().phase).toBe('armed')
    events.push(...lost.update(frame(u, { left: DRAWN.left }))) // string hand lost
    // it comes back where a release would have ended: still no shot
    for (let i = 0; i < 20; i += 1) events.push(...lost.update(arms((u += 33), DRAWN.left, { x: -0.2, y: 0.12 })))
    expect(events.some((e) => e.type === 'RELEASE')).toBe(false)
    expect(events.find((e) => e.type === 'DRAW_CANCEL')).toMatchObject({ reason: 'tracking-lost' })
  })

  it('slowly lowering the bow after the hold is not a release (no shot, no penalty)', () => {
    const d = new DrawDetector()
    d.configure({ drawGoal: 0.9, holdMs: 800 })
    const { events } = shoot(d, { slowRelease: true })
    expect(events.some((e) => e.type === 'RELEASE')).toBe(false)
    expect(events.find((e) => e.type === 'DRAW_CANCEL')).toMatchObject({ reason: 'lowered' })
  })

  it('tracking loss mid-draw cancels; the next shot needs READY again; cooldown debounces', () => {
    const d = new DrawDetector()
    d.configure({ drawGoal: 0.9, holdMs: 800 })
    let t = 0
    for (; t < 700; t += 33) d.update(arms(t, TOGETHER.left, TOGETHER.right))
    const events: Pending[] = []
    for (let u = 0; u <= 0.6; u += 0.1, t += 33) events.push(...d.update(arms(t, { x: -0.08 - 1.2 * u, y: 0.3 }, { x: 0.08 + 0.4 * u, y: 0.3 }, { rightElbow: { x: 0.3 + 0.6 * u, y: 0.2 } })))
    expect(events.some((e) => e.type === 'DRAW_START')).toBe(true)
    events.push(...d.update(frame(t, { left: DRAWN.left })))
    expect(events.find((e) => e.type === 'DRAW_CANCEL')).toMatchObject({ reason: 'tracking-lost' })
    expect(d.state().phase).toBe('wait-ready')
    // hands come back already drawn apart: no new attempt until they go back together
    const later: Pending[] = []
    for (let i = 0; i < 40; i += 1, t += 33) later.push(...d.update(arms(t, DRAWN.left, DRAWN.right, { rightElbow: DRAW_ELBOW })))
    expect(later.some((e) => e.type === 'DRAW_START')).toBe(false)

    // after a release, the cooldown + READY requirement block an immediate second shot
    const e2 = new DrawDetector()
    e2.configure({ drawGoal: 0.9, holdMs: 800 })
    const first = shoot(e2)
    const again: Pending[] = []
    let t2 = first.t
    for (let i = 0; i < 10; i += 1, t2 += 33) again.push(...e2.update(arms(t2, DRAWN.left, DRAWN.right, { rightElbow: DRAW_ELBOW })))
    expect(again.some((e) => e.type === 'DRAW_START')).toBe(false)
  })

  it('pause gating through the adapter cancels the attempt and no release can happen while paused', () => {
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
    expect(events.some((e) => e.type === 'RELEASE')).toBe(false)
    expect(events.find((e) => e.type === 'DRAW_CANCEL')).toMatchObject({ reason: 'paused' })
    adapter.setDetectionActive(true)
    while (!events.some((e) => e.type === 'RELEASE') && t < 30_000) source.emit((t += 33))
    const releases = events.filter((e) => e.type === 'RELEASE')
    expect(releases).toHaveLength(1)
    // every attempt id releases at most once
    expect(new Set(releases.map((e) => (e as Extract<MotionEvent, { type: 'RELEASE' }>).attemptId)).size).toBe(releases.length)
  })
})
