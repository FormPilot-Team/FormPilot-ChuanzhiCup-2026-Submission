// One round of Apple Picking: spawning, picking, combos, timing and the end-of-round result.
// Pure logic (no Phaser, no DOM). Missing an apple never costs points; combos only add.
import type { MotionEvent, MotionFrame, Point, Side } from '../../motion/contracts'
import { mulberry32 } from '../../shared/random'
import { clamp01, type GameResult } from '../../shared/metrics'
import { DIFFICULTIES, ROUND_DEFAULTS, SCORING, type Difficulty, type DifficultyParams } from './config'
import { ReachModel, ZONE_LABEL, type Zone, type ZoneSlot } from './reach'

export interface AppleTarget {
  id: number
  slot: ZoneSlot
  center: Point
  radius: number
  holdMs: number
  /** active-time stamps */
  spawnedAt: number
  expiresAt: number
}

export type RoundEvent =
  | { type: 'spawn'; target: AppleTarget }
  | { type: 'collect'; target: AppleTarget; side: Side; points: number; combo: number; quality: number; frameTimestamp: number }
  | { type: 'expire'; target: AppleTarget }
  | { type: 'milestone'; combo: number }
  | { type: 'end'; result: GameResult }

interface Attempt {
  attemptId: number
  targetId: number
  side: Side
  frames: number
  leanFrames: number
  shrugFrames: number
  wrists: Point[]
}

export interface RoundOptions {
  difficulty: Difficulty
  durationMs?: number
  reach: ReachModel
  seed?: number
}

const ALL_SLOTS: ZoneSlot[] = [
  { zone: 'side', side: 'left' }, { zone: 'side', side: 'right' },
  { zone: 'high', side: 'left' }, { zone: 'high', side: 'right' },
  { zone: 'low', side: 'left' }, { zone: 'low', side: 'right' },
]

export class AppleRound {
  readonly params: DifficultyParams
  readonly durationMs: number
  state: 'ready' | 'playing' | 'ended' = 'ready'
  score = 0
  combo = 0
  maxCombo = 0
  completed = 0
  expired = 0
  readonly reach: ReachModel
  private readonly random: () => number
  private nextId = 1
  private target: AppleTarget | null = null
  private nextSpawnAt = 0
  private activeMs = 0
  private lastNow: number | null = null
  private paused = false
  private bag: ZoneSlot[] = []
  private lastSlot: ZoneSlot | null = null
  private attempt: Attempt | null = null
  private latestFrame: MotionFrame | null = null
  private readonly qualities: number[] = []
  private readonly bySide: Record<Side, number> = { left: 0, right: 0 }
  private readonly byZone: Record<Zone, number> = { side: 0, high: 0, low: 0 }
  leanReminders = 0
  shrugReminders = 0
  trackingLosses = 0

  constructor(private readonly options: RoundOptions) {
    this.params = DIFFICULTIES[options.difficulty]
    this.durationMs = options.durationMs ?? ROUND_DEFAULTS.durationMs
    this.reach = options.reach
    this.random = mulberry32(options.seed ?? Date.now())
  }

  start(now: number): RoundEvent[] {
    this.state = 'playing'
    this.lastNow = now
    this.nextSpawnAt = ROUND_DEFAULTS.firstSpawnDelayMs
    return []
  }

  pause(): void {
    this.paused = true
    this.lastNow = null
    this.attempt = null
  }

  resume(now: number): void {
    this.paused = false
    this.lastNow = now
  }

  isPaused(): boolean {
    return this.paused
  }

  elapsedMs(): number {
    return this.activeMs
  }

  remainingMs(): number {
    return Math.max(0, this.durationMs - this.activeMs)
  }

  activeTarget(): AppleTarget | null {
    return this.target
  }

  /** Difficulty ramp: fraction of the comfortable reach currently in use. */
  reachFraction(): number {
    const p = this.params
    return p.reachStart + (p.reachEnd - p.reachStart) * Math.min(1, this.completed / p.rampPicks)
  }

  /** Advance active time; spawns, expiry and the end of the round happen here. */
  tick(now: number): RoundEvent[] {
    if (this.state !== 'playing' || this.paused) return []
    if (this.lastNow !== null) this.activeMs += Math.min(250, Math.max(0, now - this.lastNow))
    this.lastNow = now
    const events: RoundEvent[] = []
    if (this.activeMs >= this.durationMs) {
      this.state = 'ended'
      this.target = null
      events.push({ type: 'end', result: this.result('time') })
      return events
    }
    if (this.target && this.activeMs >= this.target.expiresAt) {
      events.push({ type: 'expire', target: this.target })
      this.expired += 1
      this.combo = 0 // silently: no sound, no text, no score change
      this.target = null
      this.attempt = null
      this.nextSpawnAt = this.activeMs + this.params.spawnDelayMs
    }
    // Do not start an apple in the last 3 seconds; it could not be fairly picked.
    if (!this.target && this.activeMs >= this.nextSpawnAt && this.remainingMs() > 3000) {
      this.target = this.spawn()
      events.push({ type: 'spawn', target: this.target })
    }
    return events
  }

  /** Feed motion; returns collect / milestone events. Posture reminders are counted by the caller. */
  handleMotion(frame: MotionFrame, motionEvents: readonly MotionEvent[]): RoundEvent[] {
    this.latestFrame = frame
    if (this.state !== 'playing' || this.paused) return []
    this.reach.observe(frame)
    const events: RoundEvent[] = []
    for (const event of motionEvents) {
      if (event.type === 'TARGET_ENTER' && this.target && event.targetId === this.target.id) {
        this.attempt = { attemptId: event.attemptId, targetId: event.targetId, side: event.side, frames: 0, leanFrames: 0, shrugFrames: 0, wrists: [] }
      } else if (event.type === 'TARGET_EXIT' && this.attempt?.attemptId === event.attemptId && !event.completed) {
        this.attempt = null
      } else if (event.type === 'TARGET_HOLD' && this.target && event.targetId === this.target.id) {
        if (this.attempt?.attemptId === event.attemptId) this.recordAttemptFrame(this.attempt, frame)
        if (event.completed) events.push(...this.collect(event.side, event.attemptId, event.timestamp))
      }
    }
    return events
  }

  private recordAttemptFrame(attempt: Attempt, frame: MotionFrame): void {
    attempt.frames += 1
    if (frame.posture.torsoLean) attempt.leanFrames += 1
    if (frame.posture.shrug) attempt.shrugFrames += 1
    const wrist = attempt.side === 'left' ? frame.leftWrist : frame.rightWrist
    if (wrist) attempt.wrists.push(wrist)
  }

  private collect(side: Side, attemptId: number, frameTimestamp: number): RoundEvent[] {
    const target = this.target!
    const attempt = this.attempt?.attemptId === attemptId ? this.attempt : null
    const quality = attempt ? pickQuality(attempt) : 1
    this.qualities.push(quality)
    this.combo += 1
    this.maxCombo = Math.max(this.maxCombo, this.combo)
    this.completed += 1
    this.bySide[side] += 1
    this.byZone[target.slot.zone] += 1
    const points = SCORING.basePoints + Math.min(SCORING.comboBonusCap, (this.combo - 1) * SCORING.comboBonusPerStep)
    this.score += points
    this.target = null
    this.attempt = null
    this.nextSpawnAt = this.activeMs + this.params.spawnDelayMs
    const events: RoundEvent[] = [{ type: 'collect', target, side, points, combo: this.combo, quality, frameTimestamp }]
    if (SCORING.milestones.includes(this.combo)) events.push({ type: 'milestone', combo: this.combo })
    return events
  }

  private spawn(): AppleTarget {
    const f = this.reachFraction()
    const wrists = [this.latestFrame?.leftWrist, this.latestFrame?.rightWrist].filter((w): w is Point => Boolean(w))
    let chosen: { slot: ZoneSlot; center: Point } | null = null
    for (let attempt = 0; attempt < 6 && !chosen; attempt += 1) {
      const slot = this.nextSlot()
      const center = this.reach.point(slot, f, this.random)
      const clear = wrists.every((w) => Math.hypot(w.x - center.x, w.y - center.y) > this.params.radius + ROUND_DEFAULTS.clearanceFromHands)
      if (clear || attempt === 5) chosen = { slot, center }
    }
    const { slot, center } = chosen!
    this.lastSlot = slot
    return {
      id: this.nextId++,
      slot,
      center,
      radius: this.params.radius,
      holdMs: this.params.holdMs,
      spawnedAt: this.activeMs,
      expiresAt: this.activeMs + this.params.lifetimeMs,
    }
  }

  private nextSlot(): ZoneSlot {
    if (!this.bag.length) {
      this.bag = [...ALL_SLOTS]
      for (let i = this.bag.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.random() * (i + 1))
        ;[this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]
      }
      // avoid repeating the previous slot across bag boundaries
      if (this.lastSlot && sameSlot(this.bag[this.bag.length - 1], this.lastSlot)) this.bag.unshift(this.bag.pop()!)
    }
    return this.bag.pop()!
  }

  /** Build the shared result (also used when the player quits early). */
  result(endedBy: GameResult['endedBy']): GameResult {
    const total = this.completed + this.expired
    const motionQuality = this.qualities.length ? this.qualities.reduce((a, b) => a + b, 0) / this.qualities.length : null
    const successRate = total ? this.completed / total : null
    return {
      gameId: 'apple',
      score: this.score,
      completed: this.completed,
      total,
      successRate,
      maxCombo: this.maxCombo,
      activeMs: Math.min(this.activeMs, this.durationMs),
      motionQuality,
      feedback: [
        { label: '左手摘到', value: `${this.bySide.left} 个` },
        { label: '右手摘到', value: `${this.bySide.right} 个` },
        { label: '摘到的位置', value: (['high', 'side', 'low'] as Zone[]).map((z) => `${ZONE_LABEL[z]} ${this.byZone[z]}`).join(' · ') },
        { label: '身体侧倾提醒', value: `${this.leanReminders} 次` },
        { label: '耸肩提醒', value: `${this.shrugReminders} 次` },
      ],
      tip: tipFor(this.bySide, this.leanReminders, this.shrugReminders, successRate, this.options.difficulty),
      difficultyLabel: this.params.label,
      endedBy,
    }
  }
}

function sameSlot(a: ZoneSlot, b: ZoneSlot): boolean {
  return a.zone === b.zone && a.side === b.side
}

/** 1 = steady, upright, relaxed hold. Weights are game-design choices, not clinical scores. */
export function pickQuality(attempt: Pick<Attempt, 'frames' | 'leanFrames' | 'shrugFrames' | 'wrists'>): number {
  if (!attempt.frames) return 1
  const leanFraction = attempt.leanFrames / attempt.frames
  const shrugFraction = attempt.shrugFrames / attempt.frames
  let jitter = 0
  if (attempt.wrists.length > 2) {
    const mx = attempt.wrists.reduce((s, w) => s + w.x, 0) / attempt.wrists.length
    const my = attempt.wrists.reduce((s, w) => s + w.y, 0) / attempt.wrists.length
    jitter = Math.sqrt(attempt.wrists.reduce((s, w) => s + (w.x - mx) ** 2 + (w.y - my) ** 2, 0) / attempt.wrists.length)
  }
  const jitterPenalty = clamp01((jitter - 0.03) / 0.09)
  return clamp01(1 - 0.5 * leanFraction - 0.3 * shrugFraction - 0.2 * jitterPenalty)
}

function tipFor(bySide: Record<Side, number>, lean: number, shrug: number, successRate: number | null, difficulty: Difficulty): string {
  if (lean >= 2) return '举手时试着让身体保持正直；够不着的苹果放过它也没关系。'
  if (shrug >= 2) return '举手时让肩膀放松、往下沉，会更舒服。'
  if (Math.abs(bySide.left - bySide.right) >= 4) return `下次可以多用${bySide.left < bySide.right ? '左手' : '右手'}试试，两只手轮流来。`
  if (successRate !== null && successRate >= 0.9 && difficulty !== 'challenge') return '完成得很好！想要多一点挑战，可以试试更高的难度。'
  return '保持轻松的节奏就好。感到不适请随时停下来休息。'
}
