import { describe, expect, it } from 'vitest'
import type { MotionEvent, MotionFrame, MotionTarget } from './contracts'
import { elevationDeg } from './calibration'
import { FrameBuilder } from './frameBuilder'
import { MotionAdapter } from './MotionAdapter'
import { PostureMonitor } from './posture'
import { directorContext } from './session'
import { SyntheticActor, SyntheticPoseSource } from './synthetic'
import { TargetTracker } from './targetTracker'

function frameFromActor(actor: SyntheticActor, builder = new FrameBuilder('synthetic'), at = 0) {
  return builder.build({ timestamp: at, frameTime: at, landmarks: actor.landmarks(), imageWidth: 1280, imageHeight: 720, inferenceMs: 0 })
}

/** Drive a manual synthetic source through the real adapter; returns every event. */
function run(adapter: MotionAdapter, source: SyntheticPoseSource, fromMs: number, toMs: number, each?: (t: number, frame: MotionFrame) => void) {
  const events: MotionEvent[] = []
  const off = adapter.subscribe((frame, e) => {
    events.push(...e)
    each?.(frame.timestamp, frame)
  })
  for (let t = fromMs; t <= toMs; t += 33) source.emit(t)
  off()
  return events
}

function frame(at: number, left?: { x: number; y: number }, right?: { x: number; y: number }): MotionFrame {
  return {
    timestamp: at, leftWrist: left, rightWrist: right, confidence: 1,
    tracking: { body: true, left: Boolean(left), right: Boolean(right) },
    posture: { torsoLean: false, shrug: false, shrugSide: null, leanDegrees: null, shrugRatio: { left: null, right: null } },
    framing: { bodyInFrame: true, leftHandVisible: true, rightHandVisible: true, distance: 'ok', roomToMove: true, hint: null, ready: true },
    source: 'synthetic',
  }
}

describe('FrameBuilder body space', () => {
  it('maps the anatomical left hand to screen-left (mirror) in torso units', () => {
    const { frame: f, measures } = frameFromActor(new SyntheticActor())
    expect(f.tracking).toEqual({ body: true, left: true, right: true })
    expect(f.leftWrist!.x).toBeLessThan(-0.3)
    expect(f.rightWrist!.x).toBeGreaterThan(0.3)
    expect(f.leftWrist!.y).toBeCloseTo(0.98, 1)
    expect(f.leftShoulder!.x).toBeCloseTo(-0.375, 1)
    expect(measures.hipsValid).toBe(true)
    expect(Math.abs(measures.leanDeg!)).toBeLessThan(2) // synthetic landmark noise only
  })

  it('drops a hand whose raw visibility is low, without blocking the other hand', () => {
    const actor = new SyntheticActor()
    actor.state.hands.left = false
    const { frame: f } = frameFromActor(actor)
    expect(f.tracking.left).toBe(false)
    expect(f.leftWrist).toBeUndefined()
    expect(f.tracking.right).toBe(true)
  })

  it('reports no body when the player is absent', () => {
    const actor = new SyntheticActor()
    actor.state.present = false
    const { frame: f } = frameFromActor(actor)
    expect(f.tracking.body).toBe(false)
  })
})

describe('TargetTracker (Apple enter / hold / collect / re-arm)', () => {
  const target: MotionTarget = { id: 1, center: { x: 0.8, y: -0.4 }, radius: 0.2, holdMs: 600 }
  const outside = { x: 0.4, y: 0.9 }
  const inside = { x: 0.82, y: -0.38 }

  it('enter → hold progress → exactly one completion → exit re-arms', () => {
    const tracker = new TargetTracker()
    tracker.setTargets([target], frame(0, undefined, outside))
    const all = [] as ReturnType<TargetTracker['update']>
    for (let t = 0; t <= 2000; t += 33) all.push(...tracker.update(frame(t, undefined, t < 100 ? outside : inside)))
    expect(all.filter((e) => e.type === 'TARGET_ENTER')).toHaveLength(1)
    const completions = all.filter((e) => e.type === 'TARGET_HOLD' && e.completed)
    expect(completions).toHaveLength(1)
    const enterAt = all.find((e) => e.type === 'TARGET_ENTER')!.timestamp
    expect(completions[0].timestamp - enterAt).toBeGreaterThanOrEqual(600)
    expect(completions[0].timestamp - enterAt).toBeLessThan(600 + 40)
    // staying inside for >1 s more does not complete again
    const exit = tracker.update(frame(2100, undefined, outside))
    expect(exit).toMatchObject([{ type: 'TARGET_EXIT', completed: true, reason: 'moved-out' }])
    const again = [] as ReturnType<TargetTracker['update']>
    for (let t = 2133; t <= 3000; t += 33) again.push(...tracker.update(frame(t, undefined, inside)))
    expect(again.filter((e) => e.type === 'TARGET_HOLD' && e.completed)).toHaveLength(1)
  })

  it('a hand already inside when the target appears must leave first (no instant pick)', () => {
    const tracker = new TargetTracker()
    tracker.setTargets([target], frame(0, undefined, inside))
    const events = [] as ReturnType<TargetTracker['update']>
    for (let t = 0; t <= 1500; t += 33) events.push(...tracker.update(frame(t, undefined, inside)))
    expect(events).toHaveLength(0)
    tracker.update(frame(1550, undefined, outside))
    for (let t = 1600; t <= 2400; t += 33) events.push(...tracker.update(frame(t, undefined, inside)))
    expect(events.filter((e) => e.type === 'TARGET_HOLD' && e.completed)).toHaveLength(1)
  })

  it('edge tremor inside the exit band keeps the hold (hysteresis)', () => {
    const tracker = new TargetTracker()
    tracker.setTargets([target], frame(0, undefined, outside))
    const events = [] as ReturnType<TargetTracker['update']>
    for (let t = 0; t <= 900; t += 33) {
      const wobble = { x: 0.8 + (t % 66 === 0 ? 0.24 : 0.1), y: -0.4 } // between radius 0.2 and exit 0.28
      events.push(...tracker.update(frame(t, undefined, t === 0 ? inside : wobble)))
    }
    expect(events.filter((e) => e.type === 'TARGET_EXIT')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'TARGET_HOLD' && e.completed)).toHaveLength(1)
  })

  it('losing the hand or a long frame gap cancels the attempt — never a pick', () => {
    const tracker = new TargetTracker()
    tracker.setTargets([target], frame(0, undefined, outside))
    tracker.update(frame(0, undefined, outside))
    tracker.update(frame(33, undefined, inside))
    tracker.update(frame(233, undefined, inside))
    expect(tracker.update(frame(266, undefined, undefined))).toMatchObject([{ type: 'TARGET_EXIT', completed: false, reason: 'tracking-lost' }])
    tracker.update(frame(300, undefined, inside)) // re-enter
    const gap = tracker.update(frame(300 + 400, undefined, inside)) // 400 ms without frames
    expect(gap).toMatchObject([{ type: 'TARGET_EXIT', completed: false, reason: 'tracking-lost' }])
  })

  it('one hand owns an attempt; the other hand is ignored meanwhile', () => {
    const tracker = new TargetTracker()
    tracker.setTargets([target], frame(0, outside, outside))
    tracker.update(frame(0, outside, outside))
    const events = [] as ReturnType<TargetTracker['update']>
    for (let t = 33; t <= 1000; t += 33) events.push(...tracker.update(frame(t, inside, inside)))
    const sides = new Set(events.filter((e) => e.type === 'TARGET_ENTER').map((e) => (e as { side: string }).side))
    expect(sides.size).toBe(1)
    expect(events.filter((e) => e.type === 'TARGET_HOLD' && e.completed)).toHaveLength(1)
  })

  it('cancelAll (pause) ends a hold without completing it', () => {
    const tracker = new TargetTracker()
    tracker.setTargets([target], frame(0, undefined, outside))
    tracker.update(frame(0, undefined, outside))
    tracker.update(frame(33, undefined, inside))
    expect(tracker.cancelAll(100)).toMatchObject([{ type: 'TARGET_EXIT', completed: false }])
    expect(tracker.progress(1)).toBe(0)
  })
})

describe('Posture compensation (lean / shrug)', () => {
  function monitorWithBaseline(actor: SyntheticActor) {
    const builder = new FrameBuilder('synthetic')
    const monitor = new PostureMonitor()
    const { measures } = frameFromActor(actor, builder)
    monitor.setBaseline({ leanDeg: measures.leanDeg, shoulderTiltDeg: measures.shoulderTiltDeg, earGap: measures.earGap })
    return { builder, monitor }
  }

  it('flags a sustained side lean (>10°) after the dwell time and clears with hysteresis', () => {
    const actor = new SyntheticActor()
    const { builder, monitor } = monitorWithBaseline(actor)
    actor.state.leanDeg = 15
    let flags = monitor.update(...pair(actor, builder, 0))
    expect(flags.torsoLean).toBe(false) // not yet: dwell
    for (let t = 33; t <= 700; t += 33) flags = monitor.update(...pair(actor, builder, t))
    expect(flags.torsoLean).toBe(true)
    expect(flags.leanDegrees!).toBeGreaterThan(10)
    actor.state.leanDeg = 8.5 // inside the hysteresis band: stays on
    for (let t = 733; t <= 1400; t += 33) flags = monitor.update(...pair(actor, builder, t))
    expect(flags.torsoLean).toBe(true)
    actor.state.leanDeg = 0
    for (let t = 1433; t <= 2000; t += 33) flags = monitor.update(...pair(actor, builder, t))
    expect(flags.torsoLean).toBe(false)
  })

  it('a brief lean shorter than the dwell time is ignored', () => {
    const actor = new SyntheticActor()
    const { builder, monitor } = monitorWithBaseline(actor)
    actor.state.leanDeg = 20
    let flags = monitor.update(...pair(actor, builder, 0))
    for (let t = 33; t <= 400; t += 33) flags = monitor.update(...pair(actor, builder, t))
    actor.state.leanDeg = 0
    for (let t = 433; t <= 900; t += 33) flags = monitor.update(...pair(actor, builder, t))
    expect(flags.torsoLean).toBe(false)
  })

  it('flags a shrug with arms down, but tolerates the natural rise when the arm is overhead', () => {
    const actor = new SyntheticActor()
    const { builder, monitor } = monitorWithBaseline(actor)
    actor.state.shrug = 0.8 // gap ratio 0.6
    let flags = monitor.update(...pair(actor, builder, 0))
    for (let t = 33; t <= 800; t += 33) flags = monitor.update(...pair(actor, builder, t))
    expect(flags.shrug).toBe(true)
    expect(flags.shrugSide).toBe('both')

    const raisedActor = new SyntheticActor()
    const raised = monitorWithBaseline(raisedActor)
    raisedActor.state.shrug = 0.8
    raisedActor.wrist.left = { x: -0.6, y: -0.8 }
    raisedActor.wrist.right = { x: 0.6, y: -0.8 }
    let raisedFlags = raised.monitor.update(...pair(raisedActor, raised.builder, 0))
    for (let t = 33; t <= 800; t += 33) raisedFlags = raised.monitor.update(...pair(raisedActor, raised.builder, t))
    expect(raisedFlags.shrug).toBe(false)
  })
})

function pair(actor: SyntheticActor, builder: FrameBuilder, at: number) {
  const { frame: f, measures } = frameFromActor(actor, builder, at)
  return [f, measures] as const
}

describe('MotionAdapter pipeline with the synthetic player', () => {
  it('calibrates neutral posture and both comfortable reaches', () => {
    const source = new SyntheticPoseSource({ manual: true })
    const adapter = new MotionAdapter(source, { watchdog: false })
    source.attach(directorContext(adapter))
    void adapter.start()
    adapter.startCalibration()
    run(adapter, source, 0, 9000)
    const status = adapter.calibration()
    expect(status.step).toBe('done')
    expect(status.profile!.usedDefaults).toBe(false)
    expect(status.profile!.reach.left.maxElevationDeg).toBeGreaterThan(125)
    expect(status.profile!.reach.left.maxElevationDeg).toBeLessThan(150)
    expect(status.profile!.reach.right.armLength).toBeGreaterThan(0.8)
  })

  it('emits TRACKING_LOST / TRACKING_RESTORED with debounce, and cancels holds on loss', () => {
    const source = new SyntheticPoseSource({ manual: true })
    const adapter = new MotionAdapter(source, { watchdog: false })
    void adapter.start()
    adapter.enable('targets')
    run(adapter, source, 0, 600)
    adapter.setTargets([{ id: 9, center: { x: 0.5, y: 0.98 }, radius: 0.3, holdMs: 5000 }])
    source.actor.goal.right = { x: 1.2, y: 0.5 }
    run(adapter, source, 633, 1200)
    source.actor.goal.right = { x: 0.5, y: 0.98 }
    const entered = run(adapter, source, 1233, 1800)
    expect(entered.some((e) => e.type === 'TARGET_ENTER')).toBe(true)
    source.actor.state.present = false
    const lost = run(adapter, source, 1833, 2600)
    expect(lost.filter((e) => e.type === 'TRACKING_LOST' && e.scope === 'body')).toHaveLength(1)
    expect(lost.some((e) => e.type === 'TARGET_EXIT' && !e.completed)).toBe(true)
    expect(lost.some((e) => e.type === 'TARGET_HOLD' && e.completed)).toBe(false)
    source.actor.state.present = true
    const back = run(adapter, source, 2633, 3200)
    expect(back.filter((e) => e.type === 'TRACKING_RESTORED' && e.scope === 'body')).toHaveLength(1)
  })

  it('accepts every game capability (targets, strokes, draw)', () => {
    const adapter = new MotionAdapter(new SyntheticPoseSource({ manual: true }), { watchdog: false })
    for (const capability of ['targets', 'strokes', 'draw'] as const) expect(() => adapter.enable(capability)).not.toThrow()
    expect(adapter.diagnostics().capabilities).toEqual(['targets', 'strokes', 'draw'])
  })

  it('the hand point sits a little beyond the wrist, along the forearm', () => {
    const actor = new SyntheticActor()
    actor.wrist.right = { x: 0.375, y: 1 }
    const { frame: f } = frameFromActor(actor)
    expect(f.rightHand!.y).toBeGreaterThan(f.rightWrist!.y + 0.05)
  })

  it('elevation angle: 0 hanging, 90 horizontal, 180 overhead', () => {
    const s = { x: 0, y: 0 }
    expect(elevationDeg(s, { x: 0, y: 1 })).toBeCloseTo(0)
    expect(elevationDeg(s, { x: -1, y: 0 })).toBeCloseTo(90)
    expect(elevationDeg(s, { x: 0, y: -1 })).toBeCloseTo(180)
  })
})
