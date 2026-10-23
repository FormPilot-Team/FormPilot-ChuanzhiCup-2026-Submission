// Archery parameters (lab design choices awaiting playtests). The hit point is computed from the
// player's own motion — where the bow hand aimed when the return began, steadiness, how fully the bow
// was drawn — never from a random number. Round 2: holds are shorter (the shot is the return now).
import type { Difficulty } from '../../shared/settings'

export interface ArcheryParams {
  label: string
  description: string
  /** full draw = this share of the player's arm length (wrist separation increase) */
  drawFraction: number
  holdMs: number
  /** target-radius units of aim offset per torso unit of bow-hand aim (height against the shoulder, small sideways part) */
  aimGain: number
  /** extra offset at stability 0 (target-radius units) */
  wobbleGain: number
  /** shots per target distance step (near → middle → far) */
  shotsPerStage: number
}

export const ARCHERY_DIFFICULTIES: Record<Difficulty, ArcheryParams> = {
  easy: { label: '轻松', description: '拉开一点就够，靶子大，稳住的时间短', drawFraction: 0.5, holdMs: 500, aimGain: 2.2, wobbleGain: 0.75, shotsPerStage: 5 },
  standard: { label: '标准', description: '适中的拉弓幅度和稳住时间', drawFraction: 0.62, holdMs: 700, aimGain: 2.8, wobbleGain: 0.9, shotsPerStage: 4 },
  challenge: { label: '挑战', description: '拉得更开、稳得更久，靶子会越来越远', drawFraction: 0.75, holdMs: 900, aimGain: 3.4, wobbleGain: 1.05, shotsPerStage: 3 },
}

/** Rings in target-radius units (1 = outer edge). */
export const RINGS: readonly { r: number; points: number; label: string }[] = [
  { r: 0.2, points: 10, label: '正中靶心！' },
  { r: 0.4, points: 8, label: '好箭！' },
  { r: 0.6, points: 6, label: '命中' },
  { r: 0.8, points: 4, label: '命中' },
  { r: 1.0, points: 2, label: '擦边' },
]

/** Target distance stages: offsets grow and the target looks smaller further away. */
export const STAGES: readonly { name: string; distanceM: number; offsetScale: number }[] = [
  { name: '近靶', distanceM: 10, offsetScale: 1 },
  { name: '中靶', distanceM: 15, offsetScale: 1.2 },
  { name: '远靶', distanceM: 20, offsetScale: 1.4 },
]

export const ARCHERY_SCORING = Object.freeze({
  comboBonusPerStep: 1,
  comboBonusCap: 5,
  milestones: [3, 5, 8, 12] as readonly number[],
})

/** Visual timing after FIRE (ms): the arrow leaves, flies, lands, the score shows, then RESET. */
export const SHOT_TIMING = Object.freeze({ fireShowMs: 220, flightMs: 520, hitShowMs: 1100 })

/** First-shot guide: a ghost hand shows the return after this long in RETURN_ARMED without a return… */
export const GHOST_GUIDE = Object.freeze({ afterMs: 1000, laterShotsAfterMs: 4000 })
