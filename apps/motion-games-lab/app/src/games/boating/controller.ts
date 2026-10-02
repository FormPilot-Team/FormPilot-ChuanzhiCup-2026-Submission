// Boating controller: stroke events → BoatRound, coaching for strokes that did not count, and the
// cursor / oar state the scene draws. Shared play behaviour lives in PlayController.
import { COPY } from '../../data/games'
import type { MotionAdapterApi, MotionEvent, MotionFrame, Point, Side, StrokeScheme } from '../../motion/contracts'
import { handOf } from '../../motion/targetTracker'
import type { CursorPose } from '../../shared/handCursor'
import { PlayController, type BaseEffect, type PlayOptions } from '../../shared/play/PlayController'
import type { BoatRound, BoatRoundEvent } from './round'

export type BoatEffect = Exclude<BoatRoundEvent, { type: 'end' }>
export type BoatControllerEffect = BaseEffect | BoatEffect

export const BOAT_CURSOR = Object.freeze({
  /** the fist shows this long after a stroke counted */
  catchShowMs: 380,
})

export interface OarView {
  /** hand position (palm centre, body space) for the cursor */
  position: Point | null
  tracked: boolean
  /** 0..1 live stroke progress (oar sweep) */
  progress: number
  pose: CursorPose
  /** this side has a lantern to collect right now */
  cued: boolean
  /** strokes counted on this side so far (the scene stops demonstrating once the player has got it) */
  strokes: number
  /** the hand is on its way back after a stroke */
  returning: boolean
}

/**
 * Hand pose while paddling: open at rest, half-closed while the stroke is under way (gripping the
 * oar), a fist for a moment when the stroke counted.
 */
export function oarHandPose(input: { phase: 'wait' | 'ready' | 'out' | 'return'; progress: number; sinceCatchMs: number }): CursorPose {
  if (input.sinceCatchMs >= 0 && input.sinceCatchMs < BOAT_CURSOR.catchShowMs) return 'grab'
  if ((input.phase === 'out' || input.phase === 'ready') && input.progress > 0.15) return 'half'
  return 'open'
}

export class BoatController extends PlayController<BoatRound, BoatEffect> {
  constructor(adapter: MotionAdapterApi, round: BoatRound, options: PlayOptions & { scheme?: StrokeScheme } = {}) {
    super(adapter, round, 'strokes', options)
    adapter.configureStrokes({ scheme: options.scheme ?? 'sweep', amplitude: round.params.amplitude })
  }

  oar(side: Side): OarView {
    const f = this.frame
    const state = this.adapter.strokeState()[side]
    const sinceCatch = Number.isFinite(state.lastStrokeAt) && f ? f.timestamp - state.lastStrokeAt : -1
    const cue = this.round.cue()
    return {
      position: f ? handOf(f, side) ?? null : null,
      tracked: Boolean(f?.tracking[side]),
      progress: this.status === 'playing' ? state.progress : 0,
      pose: this.status === 'playing' ? oarHandPose({ phase: state.phase, progress: state.progress, sinceCatchMs: sinceCatch }) : 'open',
      cued: Boolean(cue && cue.inWindow && cue.lantern.side === side),
      strokes: state.strokes,
      returning: state.phase === 'return',
    }
  }

  override debugRows(): [string, string][] {
    const s = this.adapter.strokeState()
    return [
      ['scheme / amp (SW) / reach', `${s.options.scheme} / ${s.options.amplitude} / ${s.reach.toFixed(2)}`],
      ['L phase / disp', `${s.left.phase} / ${s.left.displacement?.toFixed(2) ?? '—'}`],
      ['R phase / disp', `${s.right.phase} / ${s.right.displacement?.toFixed(2) ?? '—'}`],
      ['distance / speed', `${this.round.distance.toFixed(1)} m / ${this.round.speed.toFixed(2)} m/s`],
      ['flow', String(this.round.flow)],
    ]
  }

  protected onTick(now: number): void {
    this.handle(this.round.tick(now))
  }

  protected onFrame(frame: MotionFrame, events: readonly MotionEvent[]): void {
    for (const event of events) {
      if (event.type !== 'STROKE_CANCEL') continue
      if (event.reason === 'too-small') this.coach('too-small', COPY.boating.tooSmall, frame.timestamp)
      else if (event.reason === 'raised') this.coach('raised', COPY.boating.raised, frame.timestamp)
    }
    this.handle(this.round.handleMotion(frame, events))
  }

  private handle(events: BoatRoundEvent[]): void {
    for (const event of events) {
      if (event.type === 'end') {
        this.finish(event.result)
        continue
      }
      if (event.type === 'stroke') this.markFeedback(event.frameTimestamp)
      this.emit(event)
      if (event.type === 'stroke' || event.type === 'lantern' || event.type === 'landmark') this.emit({ type: 'hud' })
    }
  }
}
