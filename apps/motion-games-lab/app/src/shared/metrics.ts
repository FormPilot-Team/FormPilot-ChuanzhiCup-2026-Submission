// One result shape for all three games. The five shared metrics are Score, Combo (max), Success Rate /
// Accuracy, Session Time and Motion Quality. Motion Quality is a game-play reference for the player —
// it is not a medical assessment.

export type GameId = 'apple' | 'boating' | 'archery'

export interface FeedbackItem {
  label: string
  value: string
}

export interface GameResult {
  gameId: GameId
  score: number
  /** successful targets / lanterns / hits */
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
  /** game wording for the shared metrics ("摘到苹果" / "收集花灯" / "命中") */
  labels: { completed: string; successRate: string; combo: string }
  /** one game-specific headline number shown under the score (distance rowed, bullseyes…) */
  highlight?: FeedbackItem
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

export function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}
