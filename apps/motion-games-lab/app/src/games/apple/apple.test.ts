import { describe, expect, it } from 'vitest'
import { defaultCalibration } from '../../motion/calibration'
import type { MotionEvent, MotionFrame, Side } from '../../motion/contracts'
import { MotionAdapter } from '../../motion/MotionAdapter'
import { SyntheticPoseSource } from '../../motion/synthetic'
import { DIFFICULTIES } from './config'
import { AppleController, type ControllerEffect } from './controller'
import { elevationOf, ReachModel } from './reach'
import { AppleRound, pickQuality, type RoundEvent } from './round'

let nextEventId = 1
function frame(at: number, wrist?: { x: number; y: number }, posture: Partial<MotionFrame['posture']> = {}): MotionFrame {
  return {
    timestamp: at, rightWrist: wrist, rightShoulder: { x: 0.375, y: 0 }, leftShoulder: { x: -0.375, y: 0 }, confidence: 1,
    tracking: { body: true, left: false, right: Boolean(wrist) },
    posture: { torsoLean: false, shrug: false, shrugSide: null, leanDegrees: 0, shrugRatio: { left: 1, right: 1 }, ...posture },
    framing: { bodyInFrame: true, leftHandVisible: true, rightHandVisible: true, distance: 'ok', roomToMove: true, hint: null, ready: true },
    source: 'synthetic',
  }
}
const ev = (e: Record<string, unknown>) => ({ id: nextEventId++, emittedAt: 0, timestamp: 0, ...e }) as MotionEvent

function newRound(durationMs = 60_000) {
  const round = new AppleRound({ difficulty: 'standard', durationMs, reach: new ReachModel(defaultCalibration()), seed: 3 })
  round.start(0)
  return round
}

/** Play until an apple exists; returns [round events, now]. */
function spawnFirst(round: AppleRound, from = 0) {
  let now = from
  const events: RoundEvent[] = []
  while (!round.activeTarget()) {
    now += 16
    events.push(...round.tick(now))
  }
  return now
}

describe('AppleRound: hold → pick, combo, cooldown, expiry', () => {
  it('picks only on a completed hold, scores, and starts the next apple after the cooldown', () => {
    const round = newRound()
    let now = spawnFirst(round)
    const t = round.activeTarget()!
    const side: Side = 'right'
    expect(round.handleMotion(frame(now, t.center), [ev({ type: 'TARGET_ENTER', targetId: t.id, side, attemptId: 1 })])).toEqual([])
    expect(round.handleMotion(frame(now + 300, t.center), [ev({ type: 'TARGET_HOLD', targetId: t.id, side, attemptId: 1, progress: 0.5, completed: false })])).toEqual([])
    expect(round.score).toBe(0)
    const picked = round.handleMotion(frame(now + 650, t.center), [ev({ type: 'TARGET_HOLD', targetId: t.id, side, attemptId: 1, progress: 1, completed: true, timestamp: now + 650 })])
    expect(picked[0]).toMatchObject({ type: 'collect', points: 10, combo: 1 })
    expect(round.score).toBe(10)
    expect(round.activeTarget()).toBeNull()
    // the same completion event again (duplicate) does nothing: the target is gone
    expect(round.handleMotion(frame(now + 660, t.center), [ev({ type: 'TARGET_HOLD', targetId: t.id, side, attemptId: 1, progress: 1, completed: true })])).toEqual([])
    // cooldown: no new apple before spawnDelayMs of active time
    const pickedAt = round.elapsedMs()
    while (!round.activeTarget()) {
      now += 16
      round.tick(now)
    }
    expect(round.elapsedMs() - pickedAt).toBeGreaterThanOrEqual(DIFFICULTIES.standard.spawnDelayMs)
  })

  it('combo grows with consecutive picks and only ever adds points', () => {
    const round = newRound()
    let now = 0
    const scores: number[] = []
    for (let i = 0; i < 6; i += 1) {
      now = spawnFirst(round, now)
      const t = round.activeTarget()!
      round.handleMotion(frame(now, t.center), [ev({ type: 'TARGET_HOLD', targetId: t.id, side: 'right', attemptId: i + 10, progress: 1, completed: true })])
      scores.push(round.score)
    }
    expect(round.combo).toBe(6)
    expect(round.maxCombo).toBe(6)
    expect(scores).toEqual([10, 22, 36, 52, 70, 90]) // 10 + 2 per combo step, capped at +10
  })

  it('an expired apple costs nothing: no score change, combo just ends, counted in the denominator', () => {
    const round = newRound()
    let now = spawnFirst(round)
    const t = round.activeTarget()!
    round.handleMotion(frame(now, t.center), [ev({ type: 'TARGET_HOLD', targetId: t.id, side: 'right', attemptId: 1, progress: 1, completed: true })])
    now = spawnFirst(round, now)
    const before = round.score
    const events: RoundEvent[] = []
    while (!events.some((e) => e.type === 'expire')) {
      now += 50
      events.push(...round.tick(now))
    }
    expect(round.score).toBe(before)
    expect(round.combo).toBe(0)
    expect(round.result('time')).toMatchObject({ completed: 1, total: 2, successRate: 0.5 })
  })

  it('pausing freezes the round clock and apple lifetime', () => {
    const round = newRound()
    const now = spawnFirst(round)
    const elapsed = round.elapsedMs()
    round.pause()
    expect(round.tick(now + 60_000)).toEqual([])
    round.resume(now + 60_000)
    round.tick(now + 60_016)
    expect(round.elapsedMs() - elapsed).toBeLessThan(50)
    expect(round.activeTarget()).not.toBeNull()
  })

  it('ends exactly once at the time limit and never spawns in the last 3 seconds', () => {
    const round = newRound(10_000)
    const events: RoundEvent[] = []
    for (let now = 0; now <= 12_000; now += 16) {
      events.push(...round.tick(now))
      const t = round.activeTarget()
      if (t && round.elapsedMs() - t.spawnedAt > 900) {
        events.push(...round.handleMotion(frame(now, t.center), [ev({ type: 'TARGET_HOLD', targetId: t.id, side: 'right', attemptId: now, progress: 1, completed: true })]))
      }
    }
    expect(events.filter((e) => e.type === 'end')).toHaveLength(1)
    const lastSpawn = events.filter((e) => e.type === 'spawn').at(-1) as Extract<RoundEvent, { type: 'spawn' }>
    expect(lastSpawn.target.spawnedAt).toBeLessThanOrEqual(7000)
  })

  it('pick quality drops with lean, shrug and a shaky hold', () => {
    expect(pickQuality({ frames: 20, leanFrames: 0, shrugFrames: 0, wrists: Array(20).fill({ x: 0, y: 0 }) })).toBe(1)
    expect(pickQuality({ frames: 20, leanFrames: 20, shrugFrames: 0, wrists: [] })).toBeCloseTo(0.5)
    expect(pickQuality({ frames: 20, leanFrames: 0, shrugFrames: 20, wrists: [] })).toBeCloseTo(0.7)
    const shaky = Array.from({ length: 20 }, (_, i) => ({ x: i % 2 ? 0.2 : -0.2, y: 0 }))
    expect(pickQuality({ frames: 20, leanFrames: 0, shrugFrames: 0, wrists: shaky })).toBeCloseTo(0.8)
  })
})

describe('ReachModel: personal comfortable area', () => {
  it('keeps every apple inside the calibrated elevation and grows only with sustained further reach', () => {
    const profile = defaultCalibration()
    profile.reach.left.maxElevationDeg = 70 // limited comfortable raise
    const reach = new ReachModel(profile)
    for (const f of [0, 0.5, 1]) {
      for (const zone of ['side', 'high', 'low'] as const) {
        for (let k = 0; k < 10; k += 1) {
          const p = reach.point({ zone, side: 'left' }, f, () => k / 9)
          expect(elevationOf(reach.sides.left.shoulder, p)).toBeLessThanOrEqual(70 + 1e-6)
        }
      }
    }
    // centre zones really are toward the middle; side zones are out to the side
    const def = new ReachModel(defaultCalibration())
    const overheadProfile = defaultCalibration()
    overheadProfile.reach.left.maxElevationDeg = 170 // a player who showed a comfortable overhead raise
    const overheadReach = new ReachModel(overheadProfile)
    expect(Math.abs(overheadReach.point({ zone: 'high', side: 'left' }, 1).x)).toBeLessThan(0.375)
    expect(overheadReach.point({ zone: 'high', side: 'left' }, 1).y).toBeLessThan(-0.6)
    // with the conservative default (130°) the same zone stays only a little above the shoulder
    expect(def.point({ zone: 'high', side: 'left' }, 1).y).toBeGreaterThan(-0.4)
    expect(Math.abs(def.point({ zone: 'low', side: 'right' }, 0.5).x)).toBeLessThan(0.3)
    expect(def.point({ zone: 'low', side: 'right' }, 0.5).y).toBeGreaterThan(0.3)
    expect(def.point({ zone: 'side', side: 'right' }, 1).x).toBeGreaterThan(1)
    expect(reach.elevationFor('side', 'right', 0)).toBeLessThan(reach.elevationFor('side', 'right', 1))
    // a single spike does not grow the area…
    const shoulder = { x: -0.375, y: 0 }
    const overhead = { x: -0.6, y: -0.9 } // ≈166°
    reach.observe({ ...frame(0), leftShoulder: shoulder, leftWrist: overhead, tracking: { body: true, left: true, right: false } })
    reach.observe({ ...frame(100), leftShoulder: shoulder, leftWrist: { x: -0.5, y: 0.9 }, tracking: { body: true, left: true, right: false } })
    expect(reach.sides.left.maxElevationDeg).toBe(70)
    // …but holding it for a while does, gradually
    for (let t = 200; t <= 800; t += 33) reach.observe({ ...frame(t), leftShoulder: shoulder, leftWrist: overhead, tracking: { body: true, left: true, right: false } })
    expect(reach.sides.left.maxElevationDeg).toBeGreaterThan(70)
    expect(reach.sides.left.maxElevationDeg).toBeLessThan(166)
  })
})

describe('Pause gating (regression: a hold must not complete while the game is paused)', () => {
  it('after tracking comes back, an apple is still pickable once play resumes', () => {
    const source = new SyntheticPoseSource({ manual: true, seed: 2 })
    const adapter = new MotionAdapter(source, { watchdog: false })
    source.attach({ calibration: () => adapter.calibration(), targets: () => adapter.getTargets() })
    void adapter.start()
    const round = new AppleRound({ difficulty: 'easy', durationMs: 60_000, reach: new ReachModel(defaultCalibration()), seed: 4 })
    const controller = new AppleController(adapter, round, { resumeAfterTrackingMs: 1200 })
    const effects: ControllerEffect[] = []
    controller.subscribe((e) => effects.push(e))
    let now = 0
    const advance = (ms: number) => {
      const end = now + ms
      while (now < end) {
        now += 33
        source.emit(now)
        controller.step(now)
      }
    }
    advance(500)
    controller.startPlaying(now)
    while (!round.activeTarget()) advance(33)
    source.bot.paused = true // freeze the hand on the apple once it gets there
    const t = round.activeTarget()!
    source.actor.goal[t.center.x < 0 ? 'left' : 'right'] = { ...t.center }
    advance(450) // hand arrives and starts holding, but not long enough to pick
    source.actor.state.present = false
    advance(800) // lost → paused
    expect(controller.status).toBe('paused')
    source.actor.state.present = true
    advance(900) // restored, still inside the 1.2 s "found you" wait: no pick may happen here
    expect(controller.status).toBe('paused')
    expect(effects.some((e) => e.type === 'collect')).toBe(false)
    advance(2500) // resumes, then the steady hand completes a fresh hold
    expect(controller.status).toBe('playing')
    expect(effects.filter((e) => e.type === 'collect')).toHaveLength(1)
  })
})

describe('Synthetic replay: Apple runs from start to the result page', () => {
  it('calibrates, plays a full round through the real MotionAdapter and produces a result', () => {
    const source = new SyntheticPoseSource({ manual: true, seed: 11 })
    const adapter = new MotionAdapter(source, { watchdog: false })
    source.attach({ calibration: () => adapter.calibration(), targets: () => adapter.getTargets() })
    source.bot.missEvery = 6
    void adapter.start()

    // 1) calibration
    adapter.startCalibration()
    let now = 0
    while (adapter.calibration().step !== 'done' && now < 15_000) source.emit((now += 33))
    const profile = adapter.calibration().profile!
    expect(profile.usedDefaults).toBe(false)

    // 2) countdown → play
    const round = new AppleRound({ difficulty: 'standard', durationMs: 60_000, reach: new ReachModel(profile), seed: 5 })
    const controller = new AppleController(adapter, round, { restReminderMs: 30_000 })
    const effects: ControllerEffect[] = []
    controller.subscribe((e) => effects.push(e))
    controller.startPlaying(now)

    // 3) scripted posture compensation during part of the round, and one walk-out
    while (controller.status !== 'ended' && now < 200_000) {
      now += 33
      const t = round.elapsedMs()
      source.actor.state.leanDeg = t > 20_000 && t < 26_000 ? 14 : 0
      source.actor.state.present = !(t > 40_000 && t < 40_000 + 33 * 40 && now < 150_000)
      source.emit(now)
      controller.step(now)
    }
    const end = effects.find((e) => e.type === 'end') as Extract<ControllerEffect, { type: 'end' }>
    expect(end).toBeDefined()
    const r = end.result
    const collects = effects.filter((e) => e.type === 'collect') as Extract<ControllerEffect, { type: 'collect' }>[]
    expect(r.completed).toBeGreaterThanOrEqual(15)
    expect(r.total).toBe(r.completed + round.expired)
    expect(round.expired).toBeGreaterThanOrEqual(1) // the bot skips every 6th apple
    // all three zone kinds (side / centre-high / centre-low) were offered and picked
    expect(new Set(collects.map((c) => c.target.slot.zone))).toEqual(new Set(['side', 'high', 'low']))
    expect(r.successRate!).toBeGreaterThan(0.6)
    expect(r.successRate!).toBeLessThan(1)
    expect(r.motionQuality!).toBeLessThan(1) // lean during holds lowers it
    expect(r.motionQuality!).toBeGreaterThan(0.5)
    expect(r.maxCombo).toBeGreaterThanOrEqual(3)
    expect(r.activeMs).toBe(60_000)
    expect(round.leanReminders).toBeGreaterThanOrEqual(1)
    expect(effects.some((e) => e.type === 'status' && e.status === 'paused' && e.reason === 'tracking')).toBe(true)
    expect(effects.some((e) => e.type === 'tracking-restored')).toBe(true)
    expect(effects.filter((e) => e.type === 'rest-reminder')).toHaveLength(1)
    expect(effects.filter((e) => e.type === 'end')).toHaveLength(1)
    // every pick came from one completed hold of an existing target
    expect(new Set(collects.map((c) => c.target.id)).size).toBe(collects.length)
  })
})
