// Archery controller: draw events → ArcheryRound, the visible state machine
// READY → DRAW → HOLD → RETURN_ARMED → FIRE → HIT → RESET, step instructions, the first-shot ghost
// guide, and the bow / hand view for the scene.
import { COPY } from '../../data/games'
import type { DrawState, MotionAdapterApi, MotionEvent, MotionFrame, Side } from '../../motion/contracts'
import type { CursorPose } from '../../shared/handCursor'
import { PlayController, type BaseEffect, type PlayOptions } from '../../shared/play/PlayController'
import { GHOST_GUIDE, SHOT_TIMING } from './config'
import type { ArcheryRound, ArcheryRoundEvent, Shot } from './round'

export type ArcheryEffect = Exclude<ArcheryRoundEvent, { type: 'end' }>
export type ArcheryControllerEffect = BaseEffect | ArcheryEffect

export type ArcheryPhase = 'READY' | 'DRAW' | 'HOLD' | 'RETURN_ARMED' | 'FIRE' | 'HIT' | 'RESET'

/**
 * Game-facing phase from the detector phase and the shot animation clock.
 * `sinceShotMs` < 0 when no shot is in flight.
 */
export function archeryPhase(detector: DrawState['phase'], sinceShotMs: number, shotsSoFar: number): ArcheryPhase {
  if (sinceShotMs >= 0 && sinceShotMs < SHOT_TIMING.fireShowMs) return 'FIRE'
  if (sinceShotMs >= 0 && sinceShotMs < SHOT_TIMING.fireShowMs + SHOT_TIMING.flightMs + SHOT_TIMING.hitShowMs) return 'HIT'
  switch (detector) {
    case 'draw': return 'DRAW'
    case 'hold': return 'HOLD'
    case 'armed': return 'RETURN_ARMED'
    case 'ready': return 'READY'
    case 'cooldown': return 'RESET'
    default: return shotsSoFar > 0 ? 'RESET' : 'READY'
  }
}

/** Hand poses: the bow hand grips once the bow is up; the string hand pinches while drawing, opens on FIRE. */
export function archeryHandPoses(phase: ArcheryPhase, detector: DrawState['phase']): { bow: CursorPose; string: CursorPose } {
  if (phase === 'FIRE' || phase === 'HIT') return { bow: 'grab', string: 'open' }
  if (detector === 'hold' || detector === 'armed') return { bow: 'grab', string: 'grab' }
  if (detector === 'draw') return { bow: 'grab', string: 'half' }
  if (detector === 'ready') return { bow: 'half', string: 'half' }
  return { bow: 'open', string: 'open' }
}

/**
 * Ghost guide (a translucent string hand showing the way back to the chest): only in RETURN_ARMED,
 * only while the player has not started the return, after 1 s before the first arrow of the round
 * (4 s for later arrows, as a reminder). It hides the moment the return begins.
 */
export function showGhostGuide(d: Pick<DrawState, 'phase' | 'armedMs' | 'returning' | 'returnProgress'>, shotsSoFar: number): boolean {
  // returnProgress below ~0.25 (a tenth of the way back) is tracking noise around the drawn position
  if (d.phase !== 'armed' || d.returning || d.returnProgress > 0.25) return false
  return d.armedMs >= (shotsSoFar === 0 ? GHOST_GUIDE.afterMs : GHOST_GUIDE.laterShotsAfterMs)
}

export class ArcheryController extends PlayController<ArcheryRound, ArcheryEffect> {
  readonly drawSide: Side
  lastShot: Shot | null = null
  private shotAt = -Infinity

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

  ghostGuide(): boolean {
    return this.status === 'playing' && showGhostGuide(this.draw(), this.round.shots.length)
  }

  /** One short instruction for the current step. */
  instruction(now: number = performance.now()): string | null {
    if (this.status !== 'playing') return null
    const d = this.draw()
    if (d.guard === 'hands-low' && (d.phase === 'draw' || d.phase === 'hold' || d.phase === 'armed')) return COPY.archery.handsLow
    switch (this.phase(now)) {
      case 'READY': return d.phase === 'ready' ? COPY.archery.draw : COPY.archery.ready
      case 'DRAW':
        if (d.cue === 'early-return') return COPY.archery.early
        return d.cue === 'pull-string-out' ? COPY.archery.pullOut : COPY.archery.draw
      case 'HOLD': return COPY.archery.hold
      case 'RETURN_ARMED': return d.returning ? COPY.archery.returning : COPY.archery.armed
      case 'RESET': return COPY.archery.reset
      default: return null
    }
  }

  /** A gentle extra line under the instruction (never blocks anything), or null. */
  softHint(): string | null {
    if (this.status !== 'playing') return null
    const d = this.draw()
    if (d.guard || !(d.phase === 'draw' || d.phase === 'hold' || d.phase === 'armed')) return null
    if (d.hint === 'turned') return COPY.archery.turnedSoft
    if (d.hint === 'bow-arm-straighter') return COPY.archery.bowArmSoft
    return null
  }

  tracked(side: Side): boolean {
    return Boolean(this.frame?.tracking[side])
  }

  override debugRows(): [string, string][] {
    const d = this.draw()
    const p = (v: { x: number; y: number } | null) => (v ? `${v.x.toFixed(3)}, ${v.y.toFixed(3)}` : '—')
    return [
      ['phase (game / detector)', `${this.phase()} / ${d.phase}`],
      ['draw side / goal', `${d.options.drawSide} / ${d.options.drawGoal.toFixed(2)}`],
      ['draw ratio / hold', `${d.drawRatio.toFixed(2)} / ${d.holdProgress.toFixed(2)}`],
      ['stability / aim', `${d.stability.toFixed(2)} / ${p(d.aim)}`],
      ['return / locked aim', `${d.returnProgress.toFixed(2)} / ${p(d.lockedAim)}`],
      ['bow elbow° (debug only)', d.bowElbowDeg === null ? '—' : d.bowElbowDeg.toFixed(0)],
      ['guard / hint / cue', `${d.guard ?? '—'} / ${d.hint ?? '—'} / ${d.cue ?? '—'}`],
      ['shots / hits', `${this.round.shots.length} / ${this.round.hits()}`],
    ]
  }

  protected onTick(now: number): void {
    this.handle(this.round.tick(now))
  }

  protected onFrame(frame: MotionFrame, events: readonly MotionEvent[]): void {
    const d = this.draw()
    if (d.guard === 'hands-low') this.coach('hands-low', COPY.archery.handsLow, frame.timestamp)
    if (d.cue === 'early-return') this.coach('early', COPY.archery.early, frame.timestamp)
    for (const event of events) {
      if (event.type !== 'DRAW_CANCEL') continue
      if (event.reason === 'lowered') this.coach('lowered', COPY.archery.lowered, frame.timestamp)
      else if (event.reason === 'early-return') this.coach('early', COPY.archery.early, frame.timestamp)
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
