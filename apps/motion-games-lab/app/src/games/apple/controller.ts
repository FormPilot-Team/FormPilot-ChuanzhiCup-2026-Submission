// Glue between the MotionAdapter (motion events only) and the Apple round + renderer.
// Shared play behaviour (pause, tracking loss, posture hints, rest reminder) lives in PlayController.
// No Phaser and no DOM here, so the same controller runs in the browser and in replay tests.
import type { MotionAdapterApi, MotionEvent, MotionFrame, Point, Side } from '../../motion/contracts'
import { handOf } from '../../motion/targetTracker'
import { PlayController, type BaseEffect, type PlayOptions } from '../../shared/play/PlayController'
import type { CursorPose } from '../../shared/handCursor'
import type { AppleRound, AppleTarget, RoundEvent } from './round'

export type { PauseReason, PlayStatus } from '../../shared/play/PlayController'

export type AppleEffect = Exclude<RoundEvent, { type: 'end' }>
export type ControllerEffect = BaseEffect | AppleEffect

export const APPLE_CURSOR = Object.freeze({
  /** hand within radius + this (torso units) of the apple = "near": halo + apple highlight */
  nearMargin: 0.32,
  /** how long the fist shows after a pick (ms) */
  grabShowMs: 420,
})

export interface CursorView {
  position: Point | null
  /** capture timestamp of the pose the position comes from (display interpolation) */
  sampleAt: number | null
  tracked: boolean
  pose: CursorPose
  near: boolean
}

/**
 * Hand pose for the Apple cursor. Approaching an apple only lights it up (open hand + halo); inside
 * the grab range the hand half-closes while the hold ring fills; the fist appears only once the hold
 * completed — never on first touch.
 */
export function appleHandPose(input: { distance: number | null; radius: number; holding: boolean; grabbing: boolean }): { pose: CursorPose; near: boolean } {
  if (input.grabbing) return { pose: 'grab', near: true }
  if (input.holding) return { pose: 'half', near: true }
  const near = input.distance !== null && input.distance <= input.radius + APPLE_CURSOR.nearMargin
  return { pose: 'open', near }
}

export type ControllerOptions = PlayOptions

export class AppleController extends PlayController<AppleRound, AppleEffect> {
  holdProgress = 0
  holdingSide: Side | null = null
  private grabUntil: Record<Side, number> = { left: -Infinity, right: -Infinity }

  constructor(adapter: MotionAdapterApi, round: AppleRound, options: ControllerOptions = {}) {
    super(adapter, round, 'targets', options)
    adapter.setTargets([])
  }

  /** Cursor view for one hand: palm position (unsmoothed, body space), tracking and pose. */
  cursor(side: Side, now: number = performance.now()): CursorView {
    const f = this.frame
    const position = f ? handOf(f, side) ?? null : null
    const target = this.round.activeTarget()
    const distance = position && target ? Math.hypot(position.x - target.center.x, position.y - target.center.y) : null
    const { pose, near } = appleHandPose({
      distance,
      radius: target?.radius ?? 0,
      holding: this.holdingSide === side && this.holdProgress > 0,
      grabbing: now < this.grabUntil[side],
    })
    return { position, sampleAt: f?.timestamp ?? null, tracked: Boolean(f?.tracking[side]), pose, near }
  }

  target(): AppleTarget | null {
    return this.round.activeTarget()
  }

  /** Any hand near the current apple (drives the apple's hover highlight). */
  appleNear(): boolean {
    return this.cursor('left').near || this.cursor('right').near
  }

  override debugRows(): [string, string][] {
    return [
      ['hold', `${this.holdingSide ?? '—'} ${this.holdProgress.toFixed(2)}`],
      ['reach f / max° L R', `${this.round.reachFraction().toFixed(2)} / ${this.round.reach.sides.left.maxElevationDeg.toFixed(0)} ${this.round.reach.sides.right.maxElevationDeg.toFixed(0)}`],
    ]
  }

  protected override onPaused(): void {
    this.holdProgress = 0
    this.holdingSide = null
  }

  protected override onDestroy(): void {
    this.adapter.setTargets([])
  }

  protected onTick(now: number): void {
    this.handleRoundEvents(this.round.tick(now))
  }

  protected onFrame(frame: MotionFrame, events: readonly MotionEvent[]): void {
    for (const event of events) {
      if (event.type === 'TARGET_ENTER') {
        this.holdingSide = event.side
      } else if (event.type === 'TARGET_HOLD') {
        this.holdProgress = event.completed ? 0 : event.progress
        if (event.completed) {
          this.holdingSide = null
          this.grabUntil[event.side] = performance.now() + APPLE_CURSOR.grabShowMs
        }
      } else if (event.type === 'TARGET_EXIT') {
        if (this.holdingSide === event.side) this.holdingSide = null
        if (!event.completed) this.holdProgress = 0
      }
    }
    this.handleRoundEvents(this.round.handleMotion(frame, events))
  }

  private handleRoundEvents(events: RoundEvent[]): void {
    for (const event of events) {
      if (event.type === 'spawn') {
        const t = event.target
        this.adapter.setTargets([{ id: t.id, center: t.center, radius: t.radius, holdMs: t.holdMs }])
      } else if (event.type === 'collect' || event.type === 'expire') {
        this.adapter.setTargets([])
        this.holdProgress = 0
        if (event.type === 'collect') this.markFeedback(event.frameTimestamp)
      }
      if (event.type === 'end') {
        this.finish(event.result)
        continue
      }
      this.emit(event)
      if (event.type === 'collect' || event.type === 'expire') this.emit({ type: 'hud' })
    }
  }
}
