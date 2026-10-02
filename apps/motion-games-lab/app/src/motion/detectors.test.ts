// Boating stroke detector and Archery draw detector: state machines, guards, debounce, pause gating.
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

/** Move the right wrist along a path of [ms, point] keyframes (linear), 30 fps; collect events. */
function drive(detector: { update(f: MotionFrame): Pending[] }, keys: [number, Partial<Record<Side, Point>>][], extra: (t: number) => Partial<MotionFrame> = () => ({})) {
  const events: Pending[] = []
  for (let k = 0; k < keys.length - 1; k += 1) {
    const [t0, a] = keys[k]
    const [t1, b] = keys[k + 1]
    for (let t = t0; t < t1; t += 33) {
      const u = (t - t0) / (t1 - t0)
      const lerp = (p?: Point, q?: Point) => (p && q ? { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u } : p ?? q)
      events.push(...detector.update(frame(t, { left: lerp(a.left, b.left), right: lerp(a.right, b.right) }, extra(t))))
    }
  }
  return events
}

const NEUTRAL_R = { x: 0.15, y: 0.75 }
const OUT_R = { x: 0.9, y: 0.7 }
const NEUTRAL_L = { x: -0.15, y: 0.75 }

describe('StrokeDetector (Boating, scheme A outward sweep)', () => {
  it('finds a neutral, counts one stroke at the catch, and needs a return before the next', () => {
    const d = new StrokeDetector()
    const events = drive(d, [
      [0, { left: NEUTRAL_L, right: NEUTRAL_R }],
      [600, { left: NEUTRAL_L, right: NEUTRAL_R }],
      [1000, { left: NEUTRAL_L, right: OUT_R }],
      [1600, { left: NEUTRAL_L, right: OUT_R }], // parked out: still only one stroke
      [2000, { left: NEUTRAL_L, right: NEUTRAL_R }],
      [2400, { left: NEUTRAL_L, right: NEUTRAL_R }],
      [2800, { left: NEUTRAL_L, right: OUT_R }],
      [3200, { left: NEUTRAL_L, right: NEUTRAL_R }],
    ])
    const strokes = events.filter((e) => e.type === 'STROKE_RIGHT')
    expect(strokes).toHaveLength(2)
    expect(events.some((e) => e.type === 'STROKE_LEFT')).toBe(false)
    const first = strokes[0] as Extract<MotionEvent, { type: 'STROKE_RIGHT' }>
    expect(first.amplitude).toBeGreaterThanOrEqual(0.32)
    expect(first.durationMs).toBeGreaterThan(100)
    expect(d.state().right.strokes).toBe(2)
  })

  it('a sweep that does not reach the amplitude is cancelled as too small — never a stroke', () => {
    const d = new StrokeDetector()
    const events = drive(d, [
      [0, { right: NEUTRAL_R }],
      [600, { right: NEUTRAL_R }],
      [900, { right: { x: 0.38, y: 0.72 } }],
      [1300, { right: NEUTRAL_R }],
    ])
    expect(events.some((e) => e.type === 'STROKE_RIGHT')).toBe(false)
    expect(events.find((e) => e.type === 'STROKE_CANCEL')).toMatchObject({ side: 'right', reason: 'too-small' })
  })

  it('arms hanging at the sides are not a stroke: the hand must end outside its shoulder', () => {
    const d = new StrokeDetector()
    // hands in front of the belly → relaxed at the sides (displacement 0.3 but still under the shoulder)
    const events = drive(d, [
      [0, { right: { x: 0.0, y: 0.7 } }],
      [600, { right: { x: 0.0, y: 0.7 } }],
      [1000, { right: { x: 0.42, y: 0.98 } }],
      [1600, { right: { x: 0.42, y: 0.98 } }],
    ])
    expect(events.some((e) => e.type === 'STROKE_RIGHT')).toBe(false)
  })

  it('waving above the shoulder and turning the body do not count', () => {
    const waving = drive(new StrokeDetector(), [
      [0, { right: NEUTRAL_R }],
      [600, { right: NEUTRAL_R }],
      [900, { right: { x: 0.3, y: -0.4 } }], // raise the hand first…
      [1300, { right: { x: 0.95, y: -0.4 } }], // …then wave sideways overhead
      [1700, { right: { x: 0.3, y: -0.4 } }],
      [2100, { right: { x: 0.95, y: -0.4 } }],
    ])
    expect(waving.some((e) => e.type === 'STROKE_RIGHT')).toBe(false)
    expect(waving.find((e) => e.type === 'STROKE_CANCEL')).toMatchObject({ reason: 'raised' })

    const turning = new StrokeDetector()
    drive(turning, [[0, { right: NEUTRAL_R }], [600, { right: NEUTRAL_R }]])
    const narrow = { leftShoulder: { x: -0.25, y: 0 }, rightShoulder: { x: 0.25, y: 0 } }
    const events = drive(turning, [[633, { right: NEUTRAL_R }], [1000, { right: OUT_R }], [1300, { right: OUT_R }]], () => narrow)
    expect(events.some((e) => e.type === 'STROKE_RIGHT')).toBe(false)
  })

  it('a hand jump (start → catch in one frame) is rejected as too fast', () => {
    const d = new StrokeDetector()
    drive(d, [[0, { right: NEUTRAL_R }], [600, { right: NEUTRAL_R }]])
    const events = [...d.update(frame(633, { right: { x: 0.3, y: 0.74 } })), ...d.update(frame(666, { right: OUT_R }))]
    expect(events.some((e) => e.type === 'STROKE_RIGHT')).toBe(false)
    expect(events.find((e) => e.type === 'STROKE_CANCEL')).toMatchObject({ reason: 'too-fast' })
  })

  it('losing the hand mid-stroke cancels it; pause cancels and requires a return to neutral', () => {
    const d = new StrokeDetector()
    drive(d, [[0, { right: NEUTRAL_R }], [600, { right: NEUTRAL_R }], [700, { right: { x: 0.35, y: 0.74 } }]])
    const lost = d.update(frame(733, {}))
    expect(lost.find((e) => e.type === 'STROKE_CANCEL')).toMatchObject({ reason: 'tracking-lost' })

    const p = new StrokeDetector()
    drive(p, [[0, { right: NEUTRAL_R }], [600, { right: NEUTRAL_R }], [700, { right: { x: 0.35, y: 0.74 } }]])
    expect(p.cancelAll(733, 'paused').find((e) => e.type === 'STROKE_CANCEL')).toMatchObject({ reason: 'paused' })
    // still out at resume: continuing outward must NOT complete the cancelled stroke
    const after = drive(p, [[766, { right: { x: 0.35, y: 0.74 } }], [1000, { right: OUT_R }]])
    expect(after.some((e) => e.type === 'STROKE_RIGHT')).toBe(false)
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
    expect(events.filter((e) => e.type === 'STROKE_RIGHT')).toHaveLength(1)
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

function shoot(d: DrawDetector, opts: { wobble?: number; slowRelease?: boolean; bentBow?: boolean; twist?: boolean; noElbow?: boolean } = {}) {
  const events: Pending[] = []
  let t = 0
  const lerp = (a: Point, b: Point, u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
  const push = (f: MotionFrame) => events.push(...d.update(f))
  const rightElbowAt = (u: number) => (opts.noElbow ? undefined : lerp({ x: 0.3, y: 0.22 }, DRAW_ELBOW, u))
  const leftElbowAt = () => (opts.bentBow ? { x: -0.55, y: 0.6 } : undefined)
  const shoulders = (u: number): [Point, Point] | undefined => (opts.twist ? [{ x: -0.375 + 0.12 * u, y: 0 }, { x: 0.375 - 0.12 * u, y: 0 }] : undefined)
  for (; t < 700; t += 33) push(arms(t, TOGETHER.left, TOGETHER.right))
  for (let u = 0; u <= 1; u += 0.08, t += 33) push(arms(t, lerp(TOGETHER.left, DRAWN.left, u), lerp(TOGETHER.right, DRAWN.right, u), { rightElbow: rightElbowAt(u), leftElbow: u > 0.5 ? leftElbowAt() : undefined, shoulders: shoulders(u) }))
  const end = t + 1600
  for (; t < end; t += 33) {
    const w = opts.wobble ? opts.wobble * Math.sin(t / 60) : 0
    push(arms(t, { x: DRAWN.left.x, y: DRAWN.left.y + w }, DRAWN.right, { rightElbow: rightElbowAt(1), leftElbow: leftElbowAt(), shoulders: shoulders(1) }))
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
    const { events } = shoot(d, { twist: true })
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

  it('elbow flexion guards: a bent bow arm, or a string hand without the elbow moving out, never shoots', () => {
    const bent = new DrawDetector()
    bent.configure({ drawGoal: 0.9, holdMs: 800 })
    const a = shoot(bent, { bentBow: true }).events
    expect(a.some((e) => e.type === 'RELEASE')).toBe(false)
    expect(a.find((e) => e.type === 'DRAW_CANCEL')).toMatchObject({ reason: 'bow-arm-bent' })
    expect(elbowAngleDeg({ x: -0.375, y: 0 }, { x: -0.55, y: 0.6 }, DRAWN.left)).toBeLessThan(120)

    const flick = new DrawDetector()
    flick.configure({ drawGoal: 0.9, holdMs: 800 })
    // string elbow stays where it was at READY while the wrist travels
    const b: Pending[] = []
    let t = 0
    for (; t < 700; t += 33) b.push(...flick.update(arms(t, TOGETHER.left, TOGETHER.right, { rightElbow: { x: 0.3, y: 0.22 } })))
    for (let i = 0; i < 60; i += 1, t += 33) b.push(...flick.update(arms(t, DRAWN.left, DRAWN.right, { rightElbow: { x: 0.3, y: 0.22 } })))
    expect(b.some((e) => e.type === 'RELEASE')).toBe(false)
    expect(b.find((e) => e.type === 'DRAW_CANCEL')).toMatchObject({ reason: 'elbow-only' })
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
