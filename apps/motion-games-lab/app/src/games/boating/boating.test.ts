import { describe, expect, it } from 'vitest'
import type { MotionEvent, MotionFrame, Side } from '../../motion/contracts'
import { MotionAdapter } from '../../motion/MotionAdapter'
import { directorContext } from '../../motion/session'
import { SyntheticPoseSource } from '../../motion/synthetic'
import type { BaseEffect } from '../../shared/play/PlayController'
import { BOAT_DIFFICULTIES, BOAT_SCORING, LANDMARKS } from './config'
import { BoatController, oarHandPose, type BoatControllerEffect } from './controller'
import { BoatRound, coefficientOfVariation } from './round'

let id = 1
const frame = (at: number, posture: Partial<MotionFrame['posture']> = {}): MotionFrame => ({
  timestamp: at, confidence: 1, tracking: { body: true, left: true, right: true },
  posture: { torsoLean: false, shrug: false, shrugSide: null, leanDegrees: 0, shrugRatio: { left: 1, right: 1 }, ...posture },
  framing: { bodyInFrame: true, leftHandVisible: true, rightHandVisible: true, distance: 'ok', roomToMove: true, hint: null, ready: true },
  source: 'synthetic',
})
const stroke = (side: Side, at: number, amplitude = 0.4): MotionEvent => ({
  id: id++, emittedAt: 0, timestamp: at, type: side === 'left' ? 'STROKE_LEFT' : 'STROKE_RIGHT', cycleId: id, amplitude, durationMs: 400,
})

function newRound(durationMs = 120_000) {
  const round = new BoatRound({ difficulty: 'standard', durationMs, seed: 4 })
  round.start(0)
  return round
}

/** Advance the clock in 16 ms steps; stroke alternately every `period` ms (or not at all). */
function play(round: BoatRound, fromMs: number, toMs: number, period: number | null, firstSide: Side = 'left') {
  const events = []
  let side = firstSide
  let next = fromMs + (period ?? Infinity)
  for (let t = fromMs; t <= toMs; t += 16) {
    events.push(...round.tick(t))
    if (period !== null && t >= next) {
      events.push(...round.handleMotion(frame(t), [stroke(side, t)]))
      side = side === 'left' ? 'right' : 'left'
      next += period
    }
  }
  return events
}

describe('BoatRound: strokes move the boat, rhythm and lanterns', () => {
  it('the boat only moves when the player paddles, and glides to a stop afterwards', () => {
    const round = newRound()
    play(round, 0, 5000, null)
    expect(round.distance).toBe(0)
    play(round, 5000, 15_000, 1100)
    const moved = round.distance
    const speed = round.speed
    expect(moved).toBeGreaterThan(15)
    play(round, 15_016, 30_000, null)
    expect(round.speed).toBeLessThan(0.01)
    // glides v / drag further, then stops
    expect(round.distance - moved).toBeLessThanOrEqual(speed / 0.42 + 0.01)
    expect(round.distance - moved).toBeGreaterThan(speed / 0.42 - 0.5)
  })

  it('a steady alternating rhythm turns on "flow" and goes further than an uneven one', () => {
    const steady = newRound()
    const events = play(steady, 0, 30_000, 1100)
    expect(events.some((e) => e.type === 'flow' && e.on)).toBe(true)
    expect(steady.flow).toBe(true)

    const uneven = newRound()
    let t = 0
    let side: Side = 'left'
    const gaps = [500, 2400, 700, 3000, 600, 1900]
    for (let i = 0; t < 30_000; i += 1) {
      const until = t + gaps[i % gaps.length]
      for (; t < until; t += 16) uneven.tick(t)
      uneven.handleMotion(frame(t), [stroke(side, t)])
      side = side === 'left' ? 'right' : 'left'
    }
    expect(uneven.flow).toBe(false)
    expect(steady.distance).toBeGreaterThan(uneven.distance)
    expect(coefficientOfVariation([1000, 1000, 1000])).toBe(0)
  })

  it('a lantern is collected only by a stroke on its own side while it floats alongside; missing costs nothing', () => {
    const round = newRound()
    const lantern = round.lanterns[0]
    // paddle until the first lantern is within reach, using only the OTHER side
    const wrong: Side = lantern.side === 'left' ? 'right' : 'left'
    let t = 0
    while (!round.cue()!.inWindow) {
      for (let k = 0; k < 60; k += 1) round.tick((t += 16))
      round.handleMotion(frame(t), [stroke(wrong, t)])
    }
    const scoreBefore = round.score
    const wrongSide = round.handleMotion(frame(t), [stroke(wrong, (t += 16))])
    expect(wrongSide.some((e) => e.type === 'lantern')).toBe(false)
    const right = round.handleMotion(frame(t), [stroke(lantern.side, (t += 16))])
    expect(right.find((e) => e.type === 'lantern')).toMatchObject({ points: BOAT_SCORING.lanternPoints })
    expect(lantern.state).toBe('collected')
    expect(round.score).toBeGreaterThan(scoreBefore)

    // let the next lantern float past without touching it: quietly missed, score unchanged
    const next = round.lanterns.find((l) => l.state === 'pending')!
    const before = round.score
    while (next.state === 'pending') {
      for (let k = 0; k < 60; k += 1) round.tick((t += 16))
      if (round.speed < 1) round.handleMotion(frame(t), [stroke(next.side === 'left' ? 'right' : 'left', t)])
    }
    expect(next.state).toBe('missed')
    expect(round.score - before).toBeGreaterThanOrEqual(0) // strokes still add; the miss subtracts nothing
    const r = round.result('quit')
    expect(r.total).toBeGreaterThanOrEqual(2)
    expect(r.completed).toBe(1)
  })

  it('passes landmarks along the way, pauses freeze everything, and the round ends once', () => {
    const round = newRound(60_000)
    const events = play(round, 0, 40_000, 1000)
    expect(round.distance).toBeGreaterThan(LANDMARKS[0].at)
    expect(events.filter((e) => e.type === 'landmark')[0]).toMatchObject({ name: LANDMARKS[0].name })
    round.pause()
    const d = round.distance
    const elapsed = round.elapsedMs()
    expect(round.tick(50_000)).toEqual([])
    expect(round.distance).toBe(d)
    expect(round.handleMotion(frame(50_000), [stroke('left', 50_000)])).toEqual([])
    round.resume(50_000)
    expect(round.elapsedMs()).toBe(elapsed)
    const rest = play(round, 50_000, 80_000, 1000)
    expect(rest.filter((e) => e.type === 'end')).toHaveLength(1)
    const end = rest.find((e) => e.type === 'end')!
    if (end.type === 'end') {
      expect(end.result.activeMs).toBe(60_000)
      expect(end.result.labels.successRate).toBe('花灯收集率')
      expect(end.result.highlight?.label).toBe('划行距离')
    }
  })

  it('posture flags at the stroke lower the motion quality (game reference only)', () => {
    const round = newRound()
    round.handleMotion(frame(1000), [stroke('left', 1000)])
    round.handleMotion(frame(2000, { torsoLean: true }), [stroke('right', 2000)])
    expect(round.result('quit').motionQuality!).toBeLessThan(1)
    expect(round.result('quit').motionQuality!).toBeGreaterThan(0.6)
  })

  it('hand pose: open at rest, half while the stroke is under way, a fist right after it counted', () => {
    expect(oarHandPose({ phase: 'ready', progress: 0, sinceCatchMs: -1 })).toBe('open')
    expect(oarHandPose({ phase: 'out', progress: 0.5, sinceCatchMs: -1 })).toBe('half')
    expect(oarHandPose({ phase: 'return', progress: 1, sinceCatchMs: 100 })).toBe('grab')
    expect(oarHandPose({ phase: 'return', progress: 0.6, sinceCatchMs: 900 })).toBe('open')
  })
})

describe('Synthetic replay: Boating from calibration to the result', () => {
  it('paddles a full round through the real MotionAdapter (scheme A)', () => {
    const source = new SyntheticPoseSource({ manual: true, seed: 9 })
    const adapter = new MotionAdapter(source, { watchdog: false })
    source.attach(directorContext(adapter))
    source.useBot('boating')
    source.bot.missEvery = 9 // every 9th stroke is too small: it must not count
    void adapter.start()
    adapter.startCalibration()
    let now = 0
    while (adapter.calibration().step !== 'done' && now < 15_000) source.emit((now += 33))
    expect(adapter.calibration().profile!.usedDefaults).toBe(false)

    const round = new BoatRound({ difficulty: 'standard', durationMs: 60_000, seed: 2 })
    const controller = new BoatController(adapter, round, { restReminderMs: 30_000 })
    const effects: BoatControllerEffect[] = []
    controller.subscribe((e) => effects.push(e))
    controller.startPlaying(now)
    while (controller.status !== 'ended' && now < 200_000) {
      now += 33
      const t = round.elapsedMs()
      source.actor.state.leanDeg = t > 20_000 && t < 26_000 ? 14 : 0
      source.actor.state.present = !(t > 40_000 && t < 40_000 + 33 * 40 && now < 150_000)
      source.emit(now)
      controller.step(now)
    }
    const end = effects.find((e) => e.type === 'end') as Extract<BaseEffect, { type: 'end' }>
    expect(end).toBeDefined()
    const r = end.result
    const strokes = effects.filter((e) => e.type === 'stroke')
    expect(strokes.length).toBeGreaterThan(30)
    expect(effects.some((e) => e.type === 'coach' && e.key === 'too-small')).toBe(true)
    expect(round.distance).toBeGreaterThan(100)
    // the scripted paddler simply alternates (it ignores the lantern cue), so about half are caught
    expect(r.completed).toBeGreaterThanOrEqual(3)
    expect(r.total).toBeGreaterThan(r.completed)
    expect(r.successRate!).toBeGreaterThan(0.4)
    expect(r.maxCombo).toBeGreaterThanOrEqual(10)
    expect(effects.some((e) => e.type === 'flow' && e.on)).toBe(true)
    expect(round.leanReminders).toBeGreaterThanOrEqual(1)
    expect(effects.some((e) => e.type === 'status' && e.status === 'paused' && e.reason === 'tracking')).toBe(true)
    expect(effects.filter((e) => e.type === 'end')).toHaveLength(1)
    expect(r.activeMs).toBe(60_000)
    expect(BOAT_DIFFICULTIES.standard.amplitude).toBe(adapter.strokeState().options.amplitude)
  })

  it('scheme B (downward stroke) is playable too (debug switch)', () => {
    const source = new SyntheticPoseSource({ manual: true, seed: 4 })
    const adapter = new MotionAdapter(source, { watchdog: false })
    source.attach(directorContext(adapter))
    source.useBot('boating')
    void adapter.start()
    const round = new BoatRound({ difficulty: 'easy', durationMs: 20_000, seed: 2 })
    const controller = new BoatController(adapter, round, { scheme: 'down' })
    let now = 0
    for (; now < 600; now += 33) source.emit(now)
    controller.startPlaying(now)
    while (controller.status !== 'ended' && now < 60_000) {
      source.emit((now += 33))
      controller.step(now)
    }
    expect(round.strokeCount()).toBeGreaterThan(10)
    expect(adapter.strokeState().options.scheme).toBe('down')
  })
})
