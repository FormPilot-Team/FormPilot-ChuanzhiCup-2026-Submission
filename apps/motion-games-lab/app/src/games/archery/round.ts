// One round of Archery: releases become shots, the hit point follows from the motion (bow-hand
// drift, steadiness, draw completeness), rings give points, consecutive hits build a combo, the target
// steps back as the player gets going. Pure logic (no Phaser, no DOM). A miss or a lowered bow costs
// nothing.
import type { DrawCancelReason, MotionEvent, MotionFrame, Point } from '../../motion/contracts'
import { clamp01, mean, type GameResult } from '../../shared/metrics'
import type { Difficulty } from '../../shared/settings'
import { ARCHERY_DIFFICULTIES, ARCHERY_SCORING, RINGS, STAGES, type ArcheryParams } from './config'

export interface Shot {
  id: number
  /** offset of the hit from the bullseye, target-radius units (+x right, +y down) */
  offset: Point
  /** index into RINGS, or null for a miss */
  ring: number | null
  points: number
  stability: number
  drawRatio: number
  stage: number
  frameTimestamp: number
}

export type ArcheryRoundEvent =
  | { type: 'draw-start' }
  | { type: 'armed' }
  | { type: 'shot'; shot: Shot; combo: number }
  | { type: 'cancel'; reason: DrawCancelReason }
  | { type: 'stage'; stage: number }
  | { type: 'milestone'; combo: number }
  | { type: 'end'; result: GameResult }

/**
 * Where the arrow lands (target-radius units). Deterministic: the bow hand's drift at the moment of
 * release, plus a wobble term that grows as steadiness drops, plus a drop when the bow was not fully
 * drawn. Larger target distances scale the offset.
 */
export function aimOffset(input: { aim: Point; stability: number; drawRatio: number }, params: ArcheryParams, offsetScale: number): Point {
  const drift = { x: input.aim.x * params.aimGain, y: input.aim.y * params.aimGain }
  const len = Math.hypot(drift.x, drift.y)
  const dir = len > 1e-6 ? { x: drift.x / len, y: drift.y / len } : { x: 0.6, y: 0.8 }
  const wobble = (1 - clamp01(input.stability)) * params.wobbleGain
  const drop = Math.max(0, 1 - input.drawRatio) * 1.6
  return {
    x: (drift.x + dir.x * wobble) * offsetScale,
    y: (drift.y + dir.y * wobble + drop) * offsetScale,
  }
}

export function ringFor(offset: Point): number | null {
  const d = Math.hypot(offset.x, offset.y)
  const index = RINGS.findIndex((ring) => d <= ring.r)
  return index >= 0 ? index : null
}

export class ArcheryRound {
  readonly params: ArcheryParams
  readonly durationMs: number
  state: 'ready' | 'playing' | 'ended' = 'ready'
  score = 0
  combo = 0
  maxCombo = 0
  stage = 0
  leanReminders = 0
  shrugReminders = 0
  trackingLosses = 0
  readonly shots: Shot[] = []
  readonly cancels: Partial<Record<DrawCancelReason, number>> = {}
  private readonly qualities: number[] = []
  private activeMs = 0
  private lastNow: number | null = null
  private paused = false

  constructor(options: { difficulty: Difficulty; durationMs: number }) {
    this.params = ARCHERY_DIFFICULTIES[options.difficulty]
    this.durationMs = options.durationMs
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

  hits(): number {
    return this.shots.filter((s) => s.ring !== null).length
  }

  tick(now: number): ArcheryRoundEvent[] {
    if (this.state !== 'playing' || this.paused) return []
    if (this.lastNow !== null) this.activeMs += Math.min(250, Math.max(0, now - this.lastNow))
    this.lastNow = now
    if (this.activeMs < this.durationMs) return []
    this.state = 'ended'
    return [{ type: 'end', result: this.result('time') }]
  }

  handleMotion(frame: MotionFrame, motionEvents: readonly MotionEvent[]): ArcheryRoundEvent[] {
    if (this.state !== 'playing' || this.paused) return []
    const events: ArcheryRoundEvent[] = []
    for (const event of motionEvents) {
      if (event.type === 'DRAW_START') events.push({ type: 'draw-start' })
      else if (event.type === 'DRAW_HOLD' && event.progress >= 1) events.push({ type: 'armed' })
      else if (event.type === 'DRAW_CANCEL' && event.reason !== 'paused') {
        this.cancels[event.reason] = (this.cancels[event.reason] ?? 0) + 1
        events.push({ type: 'cancel', reason: event.reason })
      } else if (event.type === 'RELEASE') {
        events.push(...this.shoot(event.aim, event.holdStability, event.drawRatio, event.timestamp, frame))
      }
    }
    return events
  }

  private shoot(aim: Point, stability: number, drawRatio: number, frameTimestamp: number, frame: MotionFrame): ArcheryRoundEvent[] {
    const offset = aimOffset({ aim, stability, drawRatio }, this.params, STAGES[this.stage].offsetScale)
    const ring = ringFor(offset)
    const events: ArcheryRoundEvent[] = []
    let points = 0
    if (ring !== null) {
      this.combo += 1
      this.maxCombo = Math.max(this.maxCombo, this.combo)
      points = RINGS[ring].points + Math.min(ARCHERY_SCORING.comboBonusCap, (this.combo - 1) * ARCHERY_SCORING.comboBonusPerStep)
      this.score += points
    } else {
      this.combo = 0 // quietly: no sound, no text
    }
    const shot: Shot = { id: this.shots.length + 1, offset, ring, points, stability, drawRatio, stage: this.stage, frameTimestamp }
    this.shots.push(shot)
    this.qualities.push(clamp01(0.6 * stability + 0.4 * Math.min(1, drawRatio) - (frame.posture.torsoLean ? 0.3 : 0) - (frame.posture.shrug ? 0.2 : 0)))
    events.push({ type: 'shot', shot, combo: this.combo })
    if (ring !== null && ARCHERY_SCORING.milestones.includes(this.combo)) events.push({ type: 'milestone', combo: this.combo })
    const nextStage = Math.min(STAGES.length - 1, Math.floor(this.hits() / this.params.shotsPerStage))
    if (nextStage !== this.stage) {
      this.stage = nextStage
      events.push({ type: 'stage', stage: nextStage })
    }
    return events
  }

  result(endedBy: GameResult['endedBy']): GameResult {
    const hits = this.hits()
    const bullseyes = this.shots.filter((s) => s.ring === 0).length
    const stability = mean(this.shots.map((s) => s.stability))
    const draw = mean(this.shots.map((s) => Math.min(1.5, s.drawRatio)))
    const lowered = (this.cancels.lowered ?? 0) + (this.cancels.timeout ?? 0)
    const guards = (this.cancels.turned ?? 0) + (this.cancels['bow-arm-bent'] ?? 0) + (this.cancels['elbow-only'] ?? 0) + (this.cancels['hands-low'] ?? 0)
    return {
      gameId: 'archery',
      score: this.score,
      completed: hits,
      total: this.shots.length,
      successRate: this.shots.length ? hits / this.shots.length : null,
      maxCombo: this.maxCombo,
      activeMs: Math.min(this.activeMs, this.durationMs),
      motionQuality: mean(this.qualities),
      labels: { completed: '命中', successRate: '命中率', combo: '最多连中' },
      highlight: { label: '正中靶心', value: `${bullseyes} 次` },
      feedback: [
        { label: '射出', value: `${this.shots.length} 箭` },
        { label: '平均稳定度', value: stability === null ? '—' : `${Math.round(stability * 100)}%` },
        { label: '平均拉弓幅度（相对目标）', value: draw === null ? '—' : `${Math.round(draw * 100)}%` },
        { label: '最远到达', value: STAGES[this.stage].name },
        { label: '收弓重来', value: `${lowered} 次` },
        { label: '动作提醒（转身 / 手臂）', value: `${guards} 次` },
        { label: '身体侧倾提醒', value: `${this.leanReminders} 次` },
        { label: '耸肩提醒', value: `${this.shrugReminders} 次` },
      ],
      tip: archeryTip({ shots: this.shots.length, stability, draw, guards, lowered, lean: this.leanReminders, shrug: this.shrugReminders }),
      difficultyLabel: this.params.label,
      endedBy,
    }
  }
}

function archeryTip(s: { shots: number; stability: number | null; draw: number | null; guards: number; lowered: number; lean: number; shrug: number }): string {
  if (s.lean >= 2) return '拉弓时让身体保持正直，只用手臂拉开。'
  if (s.shrug >= 2) return '拉弓时肩膀放松、往下沉，会更稳。'
  if (s.guards >= 3) return '身体正对屏幕，持弓的手臂伸直，拉弦时手肘一起往外。'
  if (s.shots < 4 && s.lowered >= 2) return '稳住之后，拉弦的手往回一松就能放箭。'
  if (s.stability !== null && s.stability < 0.6) return '圆圈转满之前尽量稳住，箭会更靠近靶心。'
  if (s.draw !== null && s.draw < 0.95) return '再拉开一点点，箭会飞得更平更远。'
  return '射得很稳！保持轻松的呼吸，感到不适请随时停下来休息。'
}
