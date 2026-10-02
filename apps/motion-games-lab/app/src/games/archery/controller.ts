// Archery controller: draw events → ArcheryRound, the visible state machine
// READY → DRAW → HOLD → RELEASE → HIT → RESET, guard coaching, and the bow / hand view for the scene.
import { COPY } from '../../data/games'
import type { DrawGuard, DrawState, MotionAdapterApi, MotionEvent, MotionFrame, Side } from '../../motion/contracts'
import type { CursorPose } from '../../shared/handCursor'
import { PlayController, type BaseEffect, type PlayOptions } from '../../shared/play/PlayController'
import { SHOT_TIMING } from './config'
import type { ArcheryRound, ArcheryRoundEvent, Shot } from './round'

export type ArcheryEffect = Exclude<ArcheryRoundEvent, { type: 'end' }>
export type ArcheryControllerEffect = BaseEffect | ArcheryEffect

export type ArcheryPhase = 'READY' | 'DRAW' | 'HOLD' | 'RELEASE' | 'HIT' | 'RESET'

const GUARD_TEXT: Record<Exclude<DrawGuard, null>, string> = {
  turned: COPY.archery.turned,
  'bow-arm-bent': COPY.archery.bowArmBent,
  'elbow-only': COPY.archery.elbowOnly,
  'hands-low': COPY.archery.handsLow,
}

/**
 * Game-facing phase from the detector phase and the shot animation clock.
 * `sinceShotMs` < 0 when no shot is in flight.
 */
export function archeryPhase(detector: DrawState['phase'], sinceShotMs: number, shotsSoFar: number): ArcheryPhase {
  if (sinceShotMs >= 0 && sinceShotMs < SHOT_TIMING.releaseShowMs) return 'RELEASE'
  if (sinceShotMs >= 0 && sinceShotMs < SHOT_TIMING.releaseShowMs + SHOT_TIMING.flightMs + SHOT_TIMING.hitShowMs) return 'HIT'
  switch (detector) {
    case 'draw': return 'DRAW'
    case 'hold':
    case 'armed': return 'HOLD'
    case 'ready': return 'READY'
    case 'cooldown': return 'RESET'
    default: return shotsSoFar > 0 ? 'RESET' : 'READY'
  }
}

/** Hand poses: the bow hand grips once the bow is up; the string hand pinches while drawing, opens on release. */
export function archeryHandPoses(phase: ArcheryPhase, detector: DrawState['phase']): { bow: CursorPose; string: CursorPose } {
  if (phase === 'RELEASE' || phase === 'HIT') return { bow: 'grab', string: 'open' }
  if (detector === 'hold' || detector === 'armed') return { bow: 'grab', string: 'grab' }
  if (detector === 'draw') return { bow: 'grab', string: 'half' }
  if (detector === 'ready') return { bow: 'half', string: 'half' }
  return { bow: 'open', string: 'open' }
}

export class ArcheryController extends PlayController<ArcheryRound, ArcheryEffect> {
  readonly drawSide: Side
  lastShot: Shot | null = null
  private shotAt = -Infinity
  private guardSince: { guard: DrawGuard; at: number } | null = null

  constructor(adapter: MotionAdapterApi, round: ArcheryRound, options: PlayOptions & { drawSide: Side; armLength: number }) {
    super(adapter, round, 'draw', options)
    this.drawSide = options.drawSide
    adapter.configureDraw({ drawSide: options.drawSide, drawGoal: round.params.drawFraction * options.armLength, holdMs: round.params.holdMs })
  }

  draw(): DrawState {
    return this.adapter.drawState()
  }

  /** Visible state machine phase (now = performance.now()). */
  phase(now: number = performance.now()): ArcheryPhase {
    return archeryPhase(this.draw().phase, Number.isFinite(this.shotAt) ? now - this.shotAt : -1, this.round.shots.length)
  }

  sinceShotMs(now: number = performance.now()): number {
    return Number.isFinite(this.shotAt) ? now - this.shotAt : -1
  }

  /** One short instruction for the current step. */
  instruction(now: number = performance.now()): string | null {
    if (this.status !== 'playing') return null
    const d = this.draw()
    if (d.guard && (d.phase === 'draw' || d.phase === 'hold' || d.phase === 'armed')) return GUARD_TEXT[d.guard]
    switch (this.phase(now)) {
      case 'READY': return d.phase === 'ready' ? COPY.archery.draw : COPY.archery.ready
      case 'DRAW': return COPY.archery.draw
      case 'HOLD': return d.phase === 'armed' ? COPY.archery.armed : COPY.archery.hold
      case 'RESET': return COPY.archery.reset
      default: return null
    }
  }

  tracked(side: Side): boolean {
    return Boolean(this.frame?.tracking[side])
  }

  override debugRows(): [string, string][] {
    const d = this.draw()
    return [
      ['phase (game / detector)', `${this.phase()} / ${d.phase}`],
      ['draw side / goal', `${d.options.drawSide} / ${d.options.drawGoal.toFixed(2)}`],
      ['draw ratio / hold', `${d.drawRatio.toFixed(2)} / ${d.holdProgress.toFixed(2)}`],
      ['stability / aim', `${d.stability.toFixed(2)} / ${d.aim.x.toFixed(3)}, ${d.aim.y.toFixed(3)}`],
      ['guard', d.guard ?? '—'],
      ['shots / hits', `${this.round.shots.length} / ${this.round.hits()}`],
    ]
  }

  protected onTick(now: number): void {
    this.handle(this.round.tick(now))
  }

  protected onFrame(frame: MotionFrame, events: readonly MotionEvent[]): void {
    // a guard that lasts a moment gets a coaching line (the detector cancels if it persists)
    const guard = this.draw().guard
    if (guard) {
      if (!this.guardSince || this.guardSince.guard !== guard) this.guardSince = { guard, at: frame.timestamp }
      else if (frame.timestamp - this.guardSince.at > 300) this.coach(guard, GUARD_TEXT[guard], frame.timestamp)
    } else this.guardSince = null
    for (const event of events) {
      if (event.type !== 'DRAW_CANCEL') continue
      if (event.reason === 'lowered') this.coach('lowered', COPY.archery.lowered, frame.timestamp)
      else if (event.reason === 'timeout') this.coach('timeout', COPY.archery.timeout, frame.timestamp)
    }
    this.handle(this.round.handleMotion(frame, events))
  }

  private handle(events: ArcheryRoundEvent[]): void {
    for (const event of events) {
      if (event.type === 'end') {
        this.finish(event.result)
        continue
      }
      if (event.type === 'shot') {
        this.lastShot = event.shot
        this.shotAt = performance.now()
        this.markFeedback(event.shot.frameTimestamp)
      }
      this.emit(event)
      if (event.type === 'shot' || event.type === 'stage') this.emit({ type: 'hud' })
    }
  }
}
