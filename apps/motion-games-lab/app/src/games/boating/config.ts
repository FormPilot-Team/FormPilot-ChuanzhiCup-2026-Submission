// Boating parameters. Difficulty changes the stroke size needed, the push per stroke and how much
// time a floating lantern stays reachable — never the pace the player must keep: the river only moves
// when the player paddles, so the game is self-paced. All values are lab design choices.
import type { Difficulty } from '../../shared/settings'

export interface BoatParams {
  label: string
  description: string
  /**
   * hand travel from the player's neutral that counts as a stroke, in the player's shoulder widths
   * (motion detector option). Round 1: lowered and made relative to shoulder width — real players
   * sweep ~0.3–0.6 shoulder widths with relaxed elbows; the old values sat at the top of that range.
   */
  amplitude: number
  /** speed added per stroke, m/s */
  impulse: number
  /** distance between floating lanterns, m */
  lanternSpacing: number
  /** a lantern can be collected from this far before it reaches the boat… */
  windowAhead: number
  /** …until this far after (it floats out of view behind the boat at about 1.7 m) */
  windowBehind: number
  /** once in reach, a lantern drifts alongside the boat at least this long (ms) */
  minWindowMs: number
}

export const BOAT_DIFFICULTIES: Record<Difficulty, BoatParams> = {
  easy: { label: '轻松', description: '划开一点就能走，花灯停留得久', amplitude: 0.22, impulse: 1.3, lanternSpacing: 13, windowAhead: 5, windowBehind: 1.6, minWindowMs: 3200 },
  standard: { label: '标准', description: '适中的划水幅度和花灯节奏', amplitude: 0.28, impulse: 1.15, lanternSpacing: 15, windowAhead: 4.2, windowBehind: 1.4, minWindowMs: 2600 },
  challenge: { label: '挑战', description: '划得更开、节奏更稳，才能走得快', amplitude: 0.36, impulse: 1.05, lanternSpacing: 17, windowAhead: 3.6, windowBehind: 1.2, minWindowMs: 2000 },
}

export const BOAT_PHYSICS = Object.freeze({
  /** speed decays as v·e^(−drag·t) between strokes */
  drag: 0.42,
  maxSpeed: 4.5,
  /** push multiplier while the rhythm is steady ("顺流") */
  flowBoost: 1.25,
  /** a waiting lantern rides this far ahead of the boat (beside it, in view) */
  lanternHoldAhead: 0.6,
})

export const BOAT_RHYTHM = Object.freeze({
  /** strokes closer than this, or further apart, do not count toward a rhythm */
  minIntervalMs: 550,
  maxIntervalMs: 3600,
  /** steady = the last `window` intervals vary less than this (coefficient of variation) and alternate */
  window: 4,
  maxCv: 0.3,
  /** a stroke more than this after the previous one starts a new combo (silently) */
  comboGapMs: 4500,
})

export const BOAT_SCORING = Object.freeze({
  strokePoints: 2,
  /** alternating left / right within the rhythm band */
  alternateBonus: 2,
  flowBonus: 2,
  lanternPoints: 20,
  landmarkPoints: 30,
  milestones: [5, 10, 20, 30, 50] as readonly number[],
})

/** Scenery along the river: passing one is a small celebration ("路线变化" without steering). */
export const LANDMARKS: readonly { at: number; name: string; kind: 'bridge' | 'lotus' | 'arch' | 'falls' | 'dock' }[] = [
  { at: 70, name: '小木桥', kind: 'bridge' },
  { at: 160, name: '荷花湾', kind: 'lotus' },
  { at: 260, name: '石拱桥', kind: 'arch' },
  { at: 370, name: '瀑布潭', kind: 'falls' },
  { at: 490, name: '林间码头', kind: 'dock' },
  { at: 620, name: '小木桥', kind: 'bridge' },
  { at: 760, name: '荷花湾', kind: 'lotus' },
  { at: 910, name: '石拱桥', kind: 'arch' },
]
