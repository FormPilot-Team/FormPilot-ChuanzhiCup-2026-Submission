// Glue between the MotionAdapter (motion events only) and the Apple round + renderer.
// No Phaser and no DOM here, so the same controller runs in the browser and in replay tests.
import type { MotionAdapterApi, MotionEvent, MotionFrame, Point, Side } from '../../motion/contracts'
import { POSTURE_HINT_COOLDOWN_MS } from './config'
import type { AppleRound, AppleTarget, RoundEvent } from './round'

export type PlayStatus = 'countdown' | 'playing' | 'paused' | 'ended'
export type PauseReason = 'user' | 'tracking' | 'hidden'

export type ControllerEffect =
  | RoundEvent
  | { type: 'status'; status: PlayStatus; reason: PauseReason | null }
  | { type: 'posture-hint'; kind: 'lean' | 'shrug' }
  | { type: 'tracking-restored' }
  | { type: 'rest-reminder' }

export interface CursorView {
  position: Point | null
  tracked: boolean
  holding: boolean
}

export interface ControllerOptions {
  /** gentle "you can rest" reminder after this much active play; 0 = off */
  restReminderMs?: number
  /** wait this long after tracking comes back before the round continues */
  resumeAfterTrackingMs?: number
}

export class AppleController {
  status: PlayStatus = 'countdown'
  pauseReason: PauseReason | null = null
  holdProgress = 0
  holdingSide: Side | null = null
  private readonly listeners = new Set<(effect: ControllerEffect) => void>()
  private readonly unsubscribe: () => void
  private frame: MotionFrame | null = null
  private lastHint: Record<'lean' | 'shrug', number> = { lean: -Infinity, shrug: -Infinity }
  private posture = { lean: false, shrug: false }
  private resumeAt: number | null = null
  private restReminded = false
  private readonly pendingFeedback: number[] = []
  private readonly pendingFrames: number[] = []
  /** camera frame of a completed hold → first rendered frame showing the pick (ms) */
  readonly feedbackLatencies: number[] = []
  /** camera frame → first rendered frame drawing its hand positions (ms) */
  readonly frameLatencies: number[] = []

  constructor(readonly adapter: MotionAdapterApi, readonly round: AppleRound, private readonly options: ControllerOptions = {}) {
    adapter.enable('targets')
    adapter.setTargets([])
    adapter.setDetectionActive(false) // until the countdown ends
    this.unsubscribe = adapter.subscribe((frame, events) => this.onMotion(frame, events))
  }

  destroy(): void {
    this.unsubscribe()
    this.adapter.setTargets([])
    this.adapter.setDetectionActive(true)
    this.listeners.clear()
  }

  subscribe(listener: (effect: ControllerEffect) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  latestFrame(): MotionFrame | null {
    return this.frame
  }

  cursor(side: Side): CursorView {
    const f = this.frame
    const position = (side === 'left' ? f?.leftWrist : f?.rightWrist) ?? null
    return { position, tracked: Boolean(f?.tracking[side]), holding: this.holdingSide === side }
  }

  target(): AppleTarget | null {
    return this.round.activeTarget()
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
    this.holdProgress = 0
    this.holdingSide = null
    this.resumeAt = null
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
    this.handleRoundEvents(this.round.tick(now))
    const restAfter = this.options.restReminderMs ?? 0
    if (restAfter > 0 && !this.restReminded && this.round.elapsedMs() >= restAfter && this.round.remainingMs() > 20_000) {
      this.restReminded = true
      this.emit({ type: 'rest-reminder' })
    }
  }

  /** The renderer calls this after drawing a frame; closes any open "event → feedback" latency samples. */
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

  quit(): RoundEvent | null {
    if (this.status === 'ended') return null
    this.status = 'ended'
    this.adapter.setTargets([])
    return { type: 'end', result: this.round.result('quit') }
  }

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
          this.resumeAt = frame.timestamp + (this.options.resumeAfterTrackingMs ?? 1200)
          this.emit({ type: 'tracking-restored' })
        }
      } else if (event.type === 'POSTURE_CHANGED') {
        this.onPosture(event.posture.torsoLean, event.posture.shrug, frame.timestamp)
      } else if (event.type === 'TARGET_ENTER') {
        this.holdingSide = event.side
      } else if (event.type === 'TARGET_HOLD') {
        this.holdProgress = event.completed ? 0 : event.progress
        if (event.completed) this.holdingSide = null
      } else if (event.type === 'TARGET_EXIT') {
        if (this.holdingSide === event.side) this.holdingSide = null
        if (!event.completed) this.holdProgress = 0
      }
    }
    if (this.status === 'playing') this.handleRoundEvents(this.round.handleMotion(frame, events))
  }

  private onPosture(lean: boolean, shrug: boolean, now: number): void {
    const rising = { lean: lean && !this.posture.lean, shrug: shrug && !this.posture.shrug }
    this.posture = { lean, shrug }
    if (this.status !== 'playing') return
    for (const kind of ['lean', 'shrug'] as const) {
      if (!rising[kind] || now - this.lastHint[kind] < POSTURE_HINT_COOLDOWN_MS) continue
      this.lastHint[kind] = now
      if (kind === 'lean') this.round.leanReminders += 1
      else this.round.shrugReminders += 1
      this.emit({ type: 'posture-hint', kind })
    }
  }

  private handleRoundEvents(events: RoundEvent[]): void {
    for (const event of events) {
      if (event.type === 'spawn') {
        const t = event.target
        this.adapter.setTargets([{ id: t.id, center: t.center, radius: t.radius, holdMs: t.holdMs }])
      } else if (event.type === 'collect' || event.type === 'expire') {
        this.adapter.setTargets([])
        this.holdProgress = 0
        if (event.type === 'collect') this.pendingFeedback.push(event.frameTimestamp)
      } else if (event.type === 'end') {
        this.adapter.setTargets([])
        this.adapter.setDetectionActive(false)
        this.status = 'ended'
      }
      this.emit(event)
    }
  }

  private setStatus(status: PlayStatus, reason: PauseReason | null): void {
    this.status = status
    this.pauseReason = reason
    this.emit({ type: 'status', status, reason })
  }

  private emit(effect: ControllerEffect): void {
    for (const listener of this.listeners) listener(effect)
  }
}
