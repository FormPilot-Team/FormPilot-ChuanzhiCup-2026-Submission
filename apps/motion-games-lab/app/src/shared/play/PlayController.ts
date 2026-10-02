// Shared play controller for all three games: countdown → playing ⇄ paused → ended.
// Owns what every game must do the same way: pause gating of motion detection, automatic pause when
// the player leaves the picture and resume after a short "found you" wait, gentle posture hints with a
// cooldown, the mid-round rest reminder, game coaching hints, and latency instrumentation.
// Games extend it with their rules (onFrame / onTick). No Phaser and no DOM here, so controllers run
// unchanged in unit tests and synthetic replays.
import type { MotionAdapterApi, MotionCapability, MotionEvent, MotionFrame } from '../../motion/contracts'
import type { GameResult } from '../metrics'

export type PlayStatus = 'countdown' | 'playing' | 'paused' | 'ended'
export type PauseReason = 'user' | 'tracking' | 'hidden'

/** What the shared shell needs from a game round. */
export interface PlayRound {
  readonly durationMs: number
  score: number
  combo: number
  leanReminders: number
  shrugReminders: number
  trackingLosses: number
  start(now: number): unknown
  pause(): void
  resume(now: number): void
  elapsedMs(): number
  remainingMs(): number
  result(endedBy: GameResult['endedBy']): GameResult
}

export type BaseEffect =
  | { type: 'status'; status: PlayStatus; reason: PauseReason | null }
  | { type: 'posture-hint'; kind: 'lean' | 'shrug' }
  | { type: 'tracking-restored' }
  | { type: 'rest-reminder' }
  /** score / combo / game HUD values changed */
  | { type: 'hud' }
  /** a short game-specific coaching line ("划开一点", "持弓的手臂伸直") */
  | { type: 'coach'; key: string; text: string }
  | { type: 'end'; result: GameResult }

export interface PlayOptions {
  /** gentle "you can rest" reminder after this much active play; 0 = off */
  restReminderMs?: number
  /** wait this long after tracking comes back before the round continues */
  resumeAfterTrackingMs?: number
}

export const PLAY_CONFIG = Object.freeze({
  postureHintCooldownMs: 8000,
  coachHintCooldownMs: 7000,
  defaultResumeAfterTrackingMs: 1200,
})

export abstract class PlayController<R extends PlayRound = PlayRound, E extends { type: string } = never> {
  status: PlayStatus = 'countdown'
  pauseReason: PauseReason | null = null
  protected frame: MotionFrame | null = null
  private readonly listeners = new Set<(effect: BaseEffect | E) => void>()
  private readonly unsubscribe: () => void
  private lastPostureHint: Record<'lean' | 'shrug', number> = { lean: -Infinity, shrug: -Infinity }
  private lastCoach = new Map<string, number>()
  private posture = { lean: false, shrug: false }
  private resumeAt: number | null = null
  private restReminded = false
  private readonly pendingFeedback: number[] = []
  private readonly pendingFrames: number[] = []
  /** camera frame of a game event (pick / stroke / release) → first rendered frame showing it (ms) */
  readonly feedbackLatencies: number[] = []
  /** camera frame → first rendered frame drawing its hand positions (ms) */
  readonly frameLatencies: number[] = []

  constructor(readonly adapter: MotionAdapterApi, readonly round: R, capability: MotionCapability, protected readonly options: PlayOptions = {}) {
    adapter.enable(capability)
    adapter.setDetectionActive(false) // until the countdown ends
    this.unsubscribe = adapter.subscribe((frame, events) => this.onMotion(frame, events))
  }

  /** Game rules: motion while playing. */
  protected abstract onFrame(frame: MotionFrame, events: readonly MotionEvent[]): void
  /** Game rules: once per rendered frame while playing (spawns, physics, the clock). */
  protected abstract onTick(now: number): void
  /** Clear transient game state when play pauses (hold rings, half-drawn bows…). */
  protected onPaused(): void {}
  /** Release game resources registered with the adapter. */
  protected onDestroy(): void {}

  destroy(): void {
    this.unsubscribe()
    this.onDestroy()
    this.adapter.setDetectionActive(true)
    this.listeners.clear()
  }

  subscribe(listener: (effect: BaseEffect | E) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  latestFrame(): MotionFrame | null {
    return this.frame
  }

  startPlaying(now: number): void {
    if (this.status !== 'countdown') return
    this.round.start(now)
    this.adapter.setDetectionActive(true)
    this.setStatus('playing', null)
    // If the player is already out of view when the round starts, wait for them.
    if (this.frame && !this.frame.tracking.body) this.pause('tracking')
  }

  pause(reason: PauseReason): void {
    if (this.status === 'ended' || this.status === 'countdown') return
    if (this.status === 'paused') {
      // a user pause overrides an automatic one, so it is not auto-resumed
      if (reason === 'user') this.pauseReason = 'user'
      return
    }
    this.round.pause()
    this.adapter.setDetectionActive(false)
    this.resumeAt = null
    this.onPaused()
    this.setStatus('paused', reason)
  }

  resume(now: number): void {
    if (this.status !== 'paused') return
    if (this.frame && !this.frame.tracking.body) {
      // Cannot play without the player in view; keep waiting automatically.
      this.pauseReason = 'tracking'
      this.emit({ type: 'status', status: 'paused', reason: 'tracking' })
      return
    }
    this.resumeAt = null
    this.round.resume(now)
    this.adapter.setDetectionActive(true)
    this.setStatus('playing', null)
  }

  /** Called every rendered frame. */
  step(now: number): void {
    if (this.status === 'paused' && this.pauseReason === 'tracking' && this.resumeAt !== null && now >= this.resumeAt) this.resume(now)
    if (this.status !== 'playing') return
    this.onTick(now)
    const restAfter = this.options.restReminderMs ?? 0
    if (this.status === 'playing' && restAfter > 0 && !this.restReminded && this.round.elapsedMs() >= restAfter && this.round.remainingMs() > 20_000) {
      this.restReminded = true
      this.emit({ type: 'rest-reminder' })
    }
  }

  /** The renderer calls this after drawing a frame; closes open latency samples. */
  markRendered(now: number): void {
    while (this.pendingFeedback.length) {
      this.feedbackLatencies.push(now - this.pendingFeedback.shift()!)
      if (this.feedbackLatencies.length > 200) this.feedbackLatencies.shift()
    }
    // only the newest frame is drawn; older unrendered ones were superseded
    if (this.pendingFrames.length) {
      this.frameLatencies.push(now - this.pendingFrames[this.pendingFrames.length - 1])
      this.pendingFrames.length = 0
      if (this.frameLatencies.length > 600) this.frameLatencies.shift()
    }
  }

  /** Player left early (返回 / 重新开始): the partial result, once. */
  quit(): GameResult | null {
    if (this.status === 'ended') return null
    this.status = 'ended'
    this.adapter.setDetectionActive(false)
    this.onDestroy()
    return this.round.result('quit')
  }

  /** Game-specific rows for the ?debug=1 panel. */
  debugRows(): [string, string][] {
    return []
  }

  // ---------- for subclasses ----------

  /** Record a game event's camera timestamp; closed at the next rendered frame. */
  protected markFeedback(frameTimestamp: number): void {
    this.pendingFeedback.push(frameTimestamp)
  }

  /** End of the round (time is up). */
  protected finish(result: GameResult): void {
    if (this.status === 'ended') return
    this.status = 'ended'
    this.adapter.setDetectionActive(false)
    this.onDestroy()
    this.emit({ type: 'end', result })
  }

  /** A coaching line, at most once per cooldown for the same key. */
  protected coach(key: string, text: string, now: number): void {
    const last = this.lastCoach.get(key) ?? -Infinity
    if (now - last < PLAY_CONFIG.coachHintCooldownMs) return
    this.lastCoach.set(key, now)
    this.emit({ type: 'coach', key, text })
  }

  protected emit(effect: BaseEffect | E): void {
    for (const listener of this.listeners) listener(effect)
  }

  // ---------- internals ----------

  private onMotion(frame: MotionFrame, events: readonly MotionEvent[]): void {
    this.frame = frame
    if (frame.tracking.body) this.pendingFrames.push(frame.timestamp)
    for (const event of events) {
      if (event.type === 'TRACKING_LOST' && event.scope === 'body') {
        if (this.status === 'playing') {
          this.round.trackingLosses += 1
          this.pause('tracking')
        }
      } else if (event.type === 'TRACKING_RESTORED' && event.scope === 'body') {
        if (this.status === 'paused' && this.pauseReason === 'tracking') {
          this.resumeAt = frame.timestamp + (this.options.resumeAfterTrackingMs ?? PLAY_CONFIG.defaultResumeAfterTrackingMs)
          this.emit({ type: 'tracking-restored' })
        }
      } else if (event.type === 'POSTURE_CHANGED') {
        this.onPosture(event.posture.torsoLean, event.posture.shrug, frame.timestamp)
      }
    }
    if (this.status === 'playing') this.onFrame(frame, events)
  }

  private onPosture(lean: boolean, shrug: boolean, now: number): void {
    const rising = { lean: lean && !this.posture.lean, shrug: shrug && !this.posture.shrug }
    this.posture = { lean, shrug }
    if (this.status !== 'playing') return
    for (const kind of ['lean', 'shrug'] as const) {
      if (!rising[kind] || now - this.lastPostureHint[kind] < PLAY_CONFIG.postureHintCooldownMs) continue
      this.lastPostureHint[kind] = now
      if (kind === 'lean') this.round.leanReminders += 1
      else this.round.shrugReminders += 1
      this.emit({ type: 'posture-hint', kind })
    }
  }

  private setStatus(status: PlayStatus, reason: PauseReason | null): void {
    this.status = status
    this.pauseReason = reason
    this.emit({ type: 'status', status, reason })
  }
}
