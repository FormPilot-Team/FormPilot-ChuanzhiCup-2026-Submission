// One round of Boating: strokes push the boat, the boat glides and slows, lanterns float alongside
// and are collected by a stroke on their side, landmarks mark the way. Pure logic (no Phaser, no DOM).
// Self-paced: nothing approaches unless the player paddles. Missing a lantern costs nothing.
import type { MotionEvent, MotionFrame, Side } from '../../motion/contracts'
import { clamp01, mean, type GameResult } from '../../shared/metrics'
import { mulberry32 } from '../../shared/random'
import type { Difficulty } from '../../shared/settings'
import { BOAT_DIFFICULTIES, BOAT_PHYSICS, BOAT_RHYTHM, BOAT_SCORING, LANDMARKS, type BoatParams } from './config'

export interface Lantern {
  id: number
  /** river distance (m) where it floats */
  at: number
  side: Side
  state: 'pending' | 'collected' | 'missed'
  /** active-time stamp when it came within reach */
  reachableAt?: number
}

export type BoatRoundEvent =
  | { type: 'stroke'; side: Side; impulse: number; alternated: boolean; flow: boolean; points: number; combo: number; frameTimestamp: number }
  | { type: 'lantern'; lantern: Lantern; points: number }
  | { type: 'lantern-miss'; lantern: Lantern }
  | { type: 'flow'; on: boolean }
  | { type: 'landmark'; name: string; kind: (typeof LANDMARKS)[number]['kind']; points: number }
  | { type: 'milestone'; combo: number }
  | { type: 'end'; result: GameResult }

export interface BoatRoundOptions {
  difficulty: Difficulty
  durationMs: number
  seed?: number
}

interface StrokeRecord {
  side: Side
  at: number
  amplitude: number
  quality: number
}

export class BoatRound {
  readonly params: BoatParams
  readonly durationMs: number
  state: 'ready' | 'playing' | 'ended' = 'ready'
  score = 0
  combo = 0
  maxCombo = 0
  distance = 0
  speed = 0
  flow = false
  leanReminders = 0
  shrugReminders = 0
  trackingLosses = 0
  readonly lanterns: Lantern[] = []
  private readonly random: () => number
  private activeMs = 0
  private lastNow: number | null = null
  private paused = false
  private nextLanternId = 1
  private nextLanternAt = 18
  private lastSide: Side | null = null
  private landmarkIndex = 0
  private readonly strokes: StrokeRecord[] = []
  private readonly intervals: number[] = []
  private flowMs = 0
  private collected = 0
  private missed = 0

  constructor(options: BoatRoundOptions) {
    this.params = BOAT_DIFFICULTIES[options.difficulty]
    this.durationMs = options.durationMs
    this.random = mulberry32(options.seed ?? Date.now())
    this.fillLanterns()
  }

  start(now: number): void {
    this.state = 'playing'
    this.lastNow = now
  }

  pause(): void {
    this.paused = true
    this.lastNow = null
  }

  resume(now: number): void {
    this.paused = false
    this.lastNow = now
  }

  elapsedMs(): number {
    return this.activeMs
  }

  remainingMs(): number {
    return Math.max(0, this.durationMs - this.activeMs)
  }

  strokeCount(side?: Side): number {
    return side ? this.strokes.filter((s) => s.side === side).length : this.strokes.length
  }

  /** The next lantern still to come, and whether it can be collected right now. */
  cue(): { lantern: Lantern; inWindow: boolean; distanceAhead: number } | null {
    const lantern = this.lanterns.find((l) => l.state === 'pending')
    if (!lantern) return null
    const ahead = lantern.at - this.distance
    return { lantern, inWindow: ahead <= this.params.windowAhead && ahead >= -this.params.windowBehind, distanceAhead: ahead }
  }

  /** Physics, lantern passing, landmarks, flow timeout and the end of the round. */
  tick(now: number): BoatRoundEvent[] {
    if (this.state !== 'playing' || this.paused) return []
    const dtMs = this.lastNow === null ? 0 : Math.min(250, Math.max(0, now - this.lastNow))
    this.lastNow = now
    this.activeMs += dtMs
    const events: BoatRoundEvent[] = []
    const dt = dtMs / 1000
    // exact integration of v' = −k v over the step
    const decay = Math.exp(-BOAT_PHYSICS.drag * dt)
    this.distance += BOAT_PHYSICS.drag > 0 ? (this.speed * (1 - decay)) / BOAT_PHYSICS.drag : this.speed * dt
    this.speed *= decay
    if (this.flow) this.flowMs += dtMs
    const last = this.strokes[this.strokes.length - 1]
    if (this.flow && (!last || this.activeMs - last.at > BOAT_RHYTHM.maxIntervalMs)) {
      this.flow = false
      events.push({ type: 'flow', on: false })
    }
    for (const lantern of this.lanterns) {
      if (lantern.state !== 'pending') continue
      const ahead = lantern.at - this.distance
      if (ahead <= this.params.windowAhead) lantern.reachableAt ??= this.activeMs
      // a lantern in reach drifts alongside the boat for a while, so there is time to paddle on its side
      if (lantern.reachableAt !== undefined && this.activeMs - lantern.reachableAt < this.params.minWindowMs && ahead < BOAT_PHYSICS.lanternHoldAhead) {
        lantern.at = this.distance + BOAT_PHYSICS.lanternHoldAhead
      }
      if (this.distance - lantern.at > this.params.windowBehind) {
        lantern.state = 'missed' // floats away quietly: no sound, no penalty
        this.missed += 1
        events.push({ type: 'lantern-miss', lantern })
      }
    }
    this.fillLanterns()
    while (this.landmarkIndex < LANDMARKS.length && this.distance >= LANDMARKS[this.landmarkIndex].at) {
      const landmark = LANDMARKS[this.landmarkIndex++]
      this.score += BOAT_SCORING.landmarkPoints
      events.push({ type: 'landmark', name: landmark.name, kind: landmark.kind, points: BOAT_SCORING.landmarkPoints })
    }
    if (this.activeMs >= this.durationMs) {
      this.state = 'ended'
      events.push({ type: 'end', result: this.result('time') })
    }
    return events
  }

  handleMotion(frame: MotionFrame, motionEvents: readonly MotionEvent[]): BoatRoundEvent[] {
    if (this.state !== 'playing' || this.paused) return []
    const events: BoatRoundEvent[] = []
    for (const event of motionEvents) {
      if (event.type !== 'STROKE_LEFT' && event.type !== 'STROKE_RIGHT') continue
      events.push(...this.stroke(event.type === 'STROKE_LEFT' ? 'left' : 'right', event.amplitude, event.durationMs, event.timestamp, frame))
    }
    return events
  }

  private stroke(side: Side, amplitude: number, durationMs: number, frameTimestamp: number, frame: MotionFrame): BoatRoundEvent[] {
    const events: BoatRoundEvent[] = []
    const r = BOAT_RHYTHM
    const previous = this.strokes[this.strokes.length - 1]
    const interval = previous ? this.activeMs - previous.at : null
    const alternated = this.lastSide !== null && this.lastSide !== side
    if (interval !== null && interval >= r.minIntervalMs && interval <= r.maxIntervalMs && alternated) {
      this.intervals.push(interval)
      if (this.intervals.length > r.window) this.intervals.shift()
    } else {
      this.intervals.length = 0
    }
    const wasFlow = this.flow
    this.flow = this.intervals.length >= r.window && coefficientOfVariation(this.intervals) <= r.maxCv
    if (this.flow !== wasFlow) events.push({ type: 'flow', on: this.flow })

    // a fuller stroke pushes a little more, within a narrow band (no reward for straining)
    const fullness = Math.max(0.85, Math.min(1.15, 1 + 0.5 * (amplitude / this.params.amplitude - 1)))
    const impulse = this.params.impulse * fullness * (this.flow ? BOAT_PHYSICS.flowBoost : 1)
    this.speed = Math.min(BOAT_PHYSICS.maxSpeed, this.speed + impulse)

    this.combo = interval === null || interval <= r.comboGapMs ? this.combo + 1 : 1
    this.maxCombo = Math.max(this.maxCombo, this.combo)
    const rhythmic = alternated && interval !== null && interval >= r.minIntervalMs && interval <= r.maxIntervalMs
    const points = BOAT_SCORING.strokePoints + (rhythmic ? BOAT_SCORING.alternateBonus : 0) + (this.flow ? BOAT_SCORING.flowBonus : 0)
    this.score += points
    const quality = clamp01(1 - (frame.posture.torsoLean ? 0.45 : 0) - (frame.posture.shrug ? 0.3 : 0) - (durationMs < 150 ? 0.25 : 0))
    this.strokes.push({ side, at: this.activeMs, amplitude, quality })
    this.lastSide = side
    events.push({ type: 'stroke', side, impulse, alternated, flow: this.flow, points, combo: this.combo, frameTimestamp })
    if (BOAT_SCORING.milestones.includes(this.combo)) events.push({ type: 'milestone', combo: this.combo })

    // a stroke on the lantern's side while it floats alongside collects it
    const lantern = this.lanterns.find((l) => l.state === 'pending' && l.side === side
      && l.at - this.distance <= this.params.windowAhead && this.distance - l.at <= this.params.windowBehind)
    if (lantern) {
      lantern.state = 'collected'
      this.collected += 1
      this.score += BOAT_SCORING.lanternPoints
      events.push({ type: 'lantern', lantern, points: BOAT_SCORING.lanternPoints })
    }
    return events
  }

  private fillLanterns(): void {
    while (this.nextLanternAt < this.distance + 90) {
      const previous = this.lanterns[this.lanterns.length - 1]
      // mostly alternating sides, sometimes the same side twice — both hands get used
      const side: Side = previous ? (this.random() < 0.7 ? (previous.side === 'left' ? 'right' : 'left') : previous.side) : 'left'
      this.lanterns.push({ id: this.nextLanternId++, at: this.nextLanternAt, side, state: 'pending' })
      this.nextLanternAt += this.params.lanternSpacing * (0.85 + this.random() * 0.3)
    }
    // keep the list short: drop resolved lanterns far behind
    while (this.lanterns.length && this.lanterns[0].state !== 'pending' && this.distance - this.lanterns[0].at > 40) this.lanterns.shift()
  }

  result(endedBy: GameResult['endedBy']): GameResult {
    const total = this.collected + this.missed
    const left = this.strokes.filter((s) => s.side === 'left')
    const right = this.strokes.filter((s) => s.side === 'right')
    let alternations = 0
    for (let i = 1; i < this.strokes.length; i += 1) if (this.strokes[i].side !== this.strokes[i - 1].side) alternations += 1
    const alternateShare = this.strokes.length > 1 ? alternations / (this.strokes.length - 1) : null
    const minutes = this.activeMs / 60_000
    const ampL = mean(left.map((s) => s.amplitude))
    const ampR = mean(right.map((s) => s.amplitude))
    const symmetry = ampL !== null && ampR !== null ? 1 - Math.abs(ampL - ampR) / Math.max(ampL, ampR) : null
    const quality = mean(this.strokes.map((s) => s.quality))
    return {
      gameId: 'boating',
      score: this.score,
      completed: this.collected,
      total,
      successRate: total ? this.collected / total : null,
      maxCombo: this.maxCombo,
      activeMs: Math.min(this.activeMs, this.durationMs),
      motionQuality: quality,
      labels: { completed: '收集花灯', successRate: '花灯收集率', combo: '最多连划' },
      highlight: { label: '划行距离', value: `${Math.round(this.distance)} 米` },
      feedback: [
        { label: '左手划桨', value: `${left.length} 次` },
        { label: '右手划桨', value: `${right.length} 次` },
        { label: '左右交替', value: alternateShare === null ? '—' : `${Math.round(alternateShare * 100)}%` },
        { label: '平均节奏', value: minutes > 0 && this.strokes.length > 1 ? `每分钟 ${Math.round(this.strokes.length / minutes)} 下` : '—' },
        { label: '左右划幅接近程度', value: symmetry === null ? '—' : `${Math.round(symmetry * 100)}%` },
        { label: '顺流时间', value: `${Math.round(this.flowMs / 1000)} 秒` },
        { label: '身体侧倾提醒', value: `${this.leanReminders} 次` },
        { label: '耸肩提醒', value: `${this.shrugReminders} 次` },
      ],
      tip: boatTip({ left: left.length, right: right.length, alternateShare, lean: this.leanReminders, shrug: this.shrugReminders, flowMs: this.flowMs }),
      difficultyLabel: this.params.label,
      endedBy,
    }
  }
}

export function coefficientOfVariation(values: readonly number[]): number {
  const m = mean(values)
  if (!m) return Infinity
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length)
  return sd / m
}

function boatTip(s: { left: number; right: number; alternateShare: number | null; lean: number; shrug: number; flowMs: number }): string {
  if (s.lean >= 2) return '划船时让身体保持正直，只用手臂划水。'
  if (s.shrug >= 2) return '划水时肩膀放松、往下沉，会更舒服。'
  if (Math.abs(s.left - s.right) >= 6) return `下次多用${s.left < s.right ? '左手' : '右手'}划几下，两边轮流来。`
  if (s.alternateShare !== null && s.alternateShare < 0.6) return '试着左一下、右一下地轮流划，小船会走得更顺。'
  if (s.flowMs < 10_000) return '找到一个舒服的节奏，一直保持下去，就能顺流而下。'
  return '节奏很稳！保持轻松的呼吸，感到不适请随时停下来休息。'
}
