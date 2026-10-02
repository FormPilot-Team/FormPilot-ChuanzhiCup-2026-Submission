// Apple Picking game parameters. Difficulty changes layout, size, hold time and pace only — it never
// asks for more range than the player's own calibrated comfortable reach.

import type { Difficulty } from '../../shared/settings'

export type { Difficulty }

export interface DifficultyParams {
  label: string
  description: string
  /** target radius, torso units */
  radius: number
  holdMs: number
  /** how long an apple waits before floating back up (no penalty) */
  lifetimeMs: number
  spawnDelayMs: number
  /** fraction of the comfortable reach used at the start → after `rampPicks` successful picks */
  reachStart: number
  reachEnd: number
  rampPicks: number
}

export const DIFFICULTIES: Record<Difficulty, DifficultyParams> = {
  easy: {
    label: '轻松', description: '苹果大、等得久、位置低一些',
    radius: 0.25, holdMs: 800, lifetimeMs: 15000, spawnDelayMs: 1000, reachStart: 0.55, reachEnd: 0.85, rampPicks: 14,
  },
  standard: {
    label: '标准', description: '适中的大小和节奏',
    radius: 0.21, holdMs: 650, lifetimeMs: 12000, spawnDelayMs: 850, reachStart: 0.65, reachEnd: 0.97, rampPicks: 12,
  },
  challenge: {
    label: '挑战', description: '苹果小一点、更快一点、更高一点',
    radius: 0.18, holdMs: 550, lifetimeMs: 9000, spawnDelayMs: 700, reachStart: 0.75, reachEnd: 1, rampPicks: 10,
  },
}

export const SCORING = Object.freeze({
  basePoints: 10,
  /** extra points per consecutive pick, capped */
  comboBonusPerStep: 2,
  comboBonusCap: 10,
  milestones: [3, 5, 10, 15, 20, 30] as readonly number[],
})

export const ROUND_DEFAULTS = Object.freeze({
  durationMs: 180_000,
  firstSpawnDelayMs: 700,
  /** minimum distance between a new apple and the hands' current positions (torso units) */
  clearanceFromHands: 0.35,
})

export const POSTURE_HINT_COOLDOWN_MS = 8000
