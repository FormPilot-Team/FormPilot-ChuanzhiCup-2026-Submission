import { describe, expect, it } from 'vitest'
import type { MotionEvent, MotionFrame } from '../../motion/contracts'
import { MotionAdapter } from '../../motion/MotionAdapter'
import { directorContext } from '../../motion/session'
import { SyntheticPoseSource } from '../../motion/synthetic'
import type { BaseEffect } from '../../shared/play/PlayController'
import { ARCHERY_DIFFICULTIES, RINGS, SHOT_TIMING, STAGES } from './config'
import { archeryHandPoses, archeryPhase, ArcheryController, type ArcheryControllerEffect } from './controller'
import { aimOffset, ArcheryRound, ringFor } from './round'

let id = 1
const frame = (at: number, posture: Partial<MotionFrame['posture']> = {}): MotionFrame => ({
  timestamp: at, confidence: 1, tracking: { body: true, left: true, right: true },
  posture: { torsoLean: false, shrug: false, shrugSide: null, leanDegrees: 0, shrugRatio: { left: 1, right: 1 }, ...posture },
  framing: { bodyInFrame: true, leftHandVisible: true, rightHandVisible: true, distance: 'ok', roomToMove: true, hint: null, ready: true },
  source: 'synthetic',
})
const release = (at: number, aim = { x: 0, y: 0 }, stability = 1, drawRatio = 1.1): MotionEvent => ({
  id: id++, emittedAt: 0, timestamp: at, type: 'RELEASE', side: 'right', attemptId: id, drawAmount: 0.7, holdStability: stability, drawRatio, aim, releaseMs: 200,
})

describe('Archery hit model (deterministic, driven by the motion)', () => {
  const p = ARCHERY_DIFFICULTIES.standard
  it('a steady, full draw with no drift lands in the bullseye', () => {
    expect(ringFor(aimOffset({ aim: { x: 0, y: 0 }, stability: 1, drawRatio: 1.1 }, p, 1))).toBe(0)
  })
  it('drift moves the arrow in the drift direction; wobble and an under-draw push it out', () => {
    const drift = aimOffset({ aim: { x: 0.05, y: 0 }, stability: 1, drawRatio: 1 }, p, 1)
    expect(drift.x).toBeGreaterThan(0.1)
    expect(Math.abs(drift.y)).toBeLessThan(1e-9)
    const wobbly = Math.hypot(...Object.values(aimOffset({ aim: { x: 0.01, y: 0 }, stability: 0.3, drawRatio: 1 }, p, 1)) as [number, number])
    const steady = Math.hypot(...Object.values(aimOffset({ aim: { x: 0.01, y: 0 }, stability: 0.95, drawRatio: 1 }, p, 1)) as [number, number])
    expect(wobbly).toBeGreaterThan(steady + 0.4)
    expect(aimOffset({ aim: { x: 0, y: 0 }, stability: 1, drawRatio: 0.8 }, p, 1).y).toBeGreaterThan(0.3) // falls short → low
    // same inputs → same result (no randomness)
    expect(aimOffset({ aim: { x: 0.02, y: -0.01 }, stability: 0.7, drawRatio: 0.95 }, p, 1.2)).toEqual(aimOffset({ aim: { x: 0.02, y: -0.01 }, stability: 0.7, drawRatio: 0.95 }, p, 1.2))
    expect(ringFor({ x: 1.2, y: 0 })).toBeNull()
  })
})

describe('ArcheryRound', () => {
  it('scores rings, builds a combo on consecutive hits, a miss resets it quietly, the target steps back', () => {
    const round = new ArcheryRound({ difficulty: 'challenge', durationMs: 120_000 })
    round.start(0)
    const first = round.handleMotion(frame(1000), [release(1000)])
    expect(first[0]).toMatchObject({ type: 'shot', combo: 1 })
    expect(round.score).toBe(RINGS[0].points)
    round.handleMotion(frame(2000), [release(2000)])
    expect(round.score).toBe(RINGS[0].points * 2 + 1)
    const miss = round.handleMotion(frame(3000), [release(3000, { x: 0.4, y: 0.3 }, 0.2)])
    expect(miss[0]).toMatchObject({ type: 'shot', combo: 0 })
    expect((miss[0] as { shot: { ring: number | null; points: number } }).shot).toMatchObject({ ring: null, points: 0 })
    expect(round.combo).toBe(0)
    const scoreAfterMiss = round.score
    expect(scoreAfterMiss).toBe(RINGS[0].points * 2 + 1)
    const events = round.handleMotion(frame(4000), [release(4000)])
    expect(events.some((e) => e.type === 'stage' && e.stage === 1)).toBe(true) // challenge: 3 hits per stage
    expect(round.stage).toBe(1)
    const r = round.result('quit')
    expect(r).toMatchObject({ completed: 3, total: 4, maxCombo: 2 })
    expect(r.labels.successRate).toBe('命中率')
    expect(STAGES[round.stage].name).toBe('中靶')
  })

  it('cancelled draws are counted for feedback but never cost points; pause freezes the round', () => {
    const round = new ArcheryRound({ difficulty: 'easy', durationMs: 60_000 })
    round.start(0)
    round.handleMotion(frame(500), [{ id: id++, emittedAt: 0, timestamp: 500, type: 'DRAW_CANCEL', side: 'right', attemptId: 1, reason: 'turned' }])
    expect(round.score).toBe(0)
    expect(round.cancels.turned).toBe(1)
    round.tick(1000)
    round.pause()
    expect(round.handleMotion(frame(2000), [release(2000)])).toEqual([])
    round.resume(5000)
    round.tick(5100)
    expect(round.elapsedMs()).toBeLessThan(1200)
  })

  it('visible phases and hand poses follow READY → DRAW → HOLD → RELEASE → HIT → RESET', () => {
    expect(archeryPhase('wait-ready', -1, 0)).toBe('READY')
    expect(archeryPhase('draw', -1, 0)).toBe('DRAW')
    expect(archeryPhase('armed', -1, 0)).toBe('HOLD')
    expect(archeryPhase('cooldown', 50, 1)).toBe('RELEASE')
    expect(archeryPhase('cooldown', SHOT_TIMING.releaseShowMs + 100, 1)).toBe('HIT')
    expect(archeryPhase('wait-ready', 5000, 1)).toBe('RESET')
    expect(archeryHandPoses('DRAW', 'draw')).toEqual({ bow: 'grab', string: 'half' })
    expect(archeryHandPoses('HOLD', 'armed')).toEqual({ bow: 'grab', string: 'grab' })
    expect(archeryHandPoses('RELEASE', 'cooldown').string).toBe('open')
  })
})

describe('Synthetic replay: Archery from calibration to the result', () => {
  it('shoots through the real MotionAdapter; steady shots score, wobbly ones land wider', () => {
    const source = new SyntheticPoseSource({ manual: true, seed: 6 })
    const adapter = new MotionAdapter(source, { watchdog: false })
    source.attach(directorContext(adapter))
    source.useBot('archery')
    source.bot.missEvery = 3 // every 3rd shot wobbles during the hold
    void adapter.start()
    adapter.startCalibration()
    let now = 0
    while (adapter.calibration().step !== 'done' && now < 15_000) source.emit((now += 33))
    const profile = adapter.calibration().profile!
    const armLength = (profile.reach.left.armLength + profile.reach.right.armLength) / 2

    const round = new ArcheryRound({ difficulty: 'standard', durationMs: 60_000 })
    const controller = new ArcheryController(adapter, round, { drawSide: 'right', armLength, restReminderMs: 30_000 })
    const effects: ArcheryControllerEffect[] = []
    controller.subscribe((e) => effects.push(e))
    controller.startPlaying(now)
    const phases = new Set<string>()
    while (controller.status !== 'ended' && now < 200_000) {
      now += 33
      const t = round.elapsedMs()
      source.actor.state.present = !(t > 30_000 && t < 30_000 + 33 * 40 && now < 150_000)
      source.emit(now)
      controller.step(now)
      phases.add(controller.draw().phase)
    }
    const end = effects.find((e) => e.type === 'end') as Extract<BaseEffect, { type: 'end' }>
    expect(end).toBeDefined()
    const shots = round.shots
    expect(shots.length).toBeGreaterThanOrEqual(10)
    // the least steady third of the shots lands wider than the steadiest third
    const sorted = [...shots].sort((a, b) => a.stability - b.stability)
    const k = Math.floor(shots.length / 3)
    const low = sorted.slice(0, k)
    const high = sorted.slice(-k)
    const avg = (list: typeof shots, f: (s: (typeof shots)[number]) => number) => list.reduce((a, s) => a + f(s), 0) / list.length
    expect(avg(high, (s) => s.stability) - avg(low, (s) => s.stability)).toBeGreaterThan(0.15)
    expect(avg(low, (s) => Math.hypot(s.offset.x, s.offset.y))).toBeGreaterThan(avg(high, (s) => Math.hypot(s.offset.x, s.offset.y)))
    expect(high.every((s) => s.ring === 0)).toBe(true)
    expect(end.result.successRate!).toBeGreaterThan(0.7)
    expect(end.result.maxCombo).toBeGreaterThanOrEqual(3)
    expect(['wait-ready', 'ready', 'draw', 'hold', 'armed', 'cooldown'].every((p) => phases.has(p))).toBe(true)
    expect(effects.some((e) => e.type === 'status' && e.status === 'paused' && e.reason === 'tracking')).toBe(true)
    expect(effects.filter((e) => e.type === 'end')).toHaveLength(1)
    expect(new Set(shots.map((s) => s.id)).size).toBe(shots.length)
  })
})
