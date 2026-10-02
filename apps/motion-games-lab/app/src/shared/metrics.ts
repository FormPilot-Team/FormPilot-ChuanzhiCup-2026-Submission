// One result shape for all three games (Apple now; Boating / Archery reuse it later).
// Motion Quality is a game-play reference for the player — it is not a medical assessment.

export type GameId = 'apple' | 'boating' | 'archery'

export interface FeedbackItem {
  label: string
  value: string
}

export interface GameResult {
  gameId: GameId
  score: number
  /** successful targets / strokes / hits */
  completed: number
  /** targets offered (resolved); denominator of the success rate */
  total: number
  /** completed / total, null when nothing was offered */
  successRate: number | null
  maxCombo: number
  /** active play time, excluding pauses */
  activeMs: number
  /** 0..1, null when there is nothing to judge */
  motionQuality: number | null
  /** short, plain-language observations for the "简单动作反馈" panel */
  feedback: FeedbackItem[]
  /** one friendly suggestion */
  tip: string
  difficultyLabel: string
  endedBy: 'time' | 'quit'
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
