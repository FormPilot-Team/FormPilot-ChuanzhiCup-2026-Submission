import type { CoachMotionMode } from '../../adapters/coachAnimation/types'
import type { CoachCardState } from './types'

export function coachMotionMode(state: CoachCardState, paused: boolean): CoachMotionMode {
  return paused ? 'paused' : state === 'CORRECTING' ? 'static' : 'playing'
}

export function resolveCoachMotionMode(mode: CoachMotionMode, hasMotion: boolean, reducedMotion: boolean): CoachMotionMode {
  return !hasMotion || reducedMotion || mode === 'static' ? 'static' : mode
}
