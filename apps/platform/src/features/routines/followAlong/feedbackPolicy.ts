import type { FollowAlongMatch, FollowAlongRegion } from './matcher'

export type RoutineFeedbackCode =
  | 'READING'
  | 'CUE'
  | 'FOLLOWING_WELL'
  | 'RECOVERED'
  | 'BEHIND'
  | 'AHEAD'
  | 'MISMATCH'
  | 'MISMATCH_ARMS'
  | 'MISMATCH_TORSO'
  | 'MISMATCH_LEGS'

export type RoutineFeedbackTone = 'neutral' | 'info' | 'success' | 'warning'

export interface RoutineFeedback {
  code: RoutineFeedbackCode
  tone: RoutineFeedbackTone
  message: string
}

export interface RoutineFeedbackUpdate {
  feedback: RoutineFeedback
  /** Present only when a confirmed problem should also be spoken (rate limited). */
  speak?: { id: string; text: string }
}

export const ROUTINE_FEEDBACK_CONFIG = Object.freeze({
  /** A pose mismatch must last this long before it is shown as a correction. */
  mismatchSustainMs: 3000,
  /** Being ahead or behind must last this long. */
  rhythmSustainMs: 4000,
  /** A problem that clears is praised once it has stayed clear this long. */
  recoverySustainMs: 1500,
  recoveryVisibleMs: 3000,
  /** The standard video has its own voice-over; spoken corrections stay rare. */
  voiceCooldownMs: 25_000,
  weakRegionScore: 0.5,
  followingWellSimilarity: 0.8,
})

const MESSAGES: Readonly<Record<RoutineFeedbackCode, string>> = Object.freeze({
  READING: '正在比对你与示范的动作…',
  CUE: '',
  FOLLOWING_WELL: '动作与示范高度一致，保持节奏',
  RECOVERED: '很好，已经跟上示范',
  BEHIND: '稍慢了一点，跟上视频节奏',
  AHEAD: '稍快了，放慢一点跟着视频',
  MISMATCH: '动作与示范差异较大，先看一眼示范再跟上',
  MISMATCH_ARMS: '注意手臂位置，对照示范调整',
  MISMATCH_TORSO: '注意身体姿态，和示范保持一致',
  MISMATCH_LEGS: '注意步型和下肢动作，对照示范调整',
})

const REGION_CODE: Readonly<Record<FollowAlongRegion, RoutineFeedbackCode>> = {
  arms: 'MISMATCH_ARMS',
  torso: 'MISMATCH_TORSO',
  legs: 'MISMATCH_LEGS',
}

function problemOf(match: FollowAlongMatch): RoutineFeedbackCode | undefined {
  if (match.status === 'ahead') return 'AHEAD'
  if (match.status === 'behind') return 'BEHIND'
  if (match.status !== 'mismatch') return undefined
  let weakest: FollowAlongRegion | undefined
  for (const region of ['arms', 'legs', 'torso'] as const) {
    const score = match.regionScores[region]
    if (score === null || score >= ROUTINE_FEEDBACK_CONFIG.weakRegionScore) continue
    if (!weakest || score < (match.regionScores[weakest] as number)) weakest = region
  }
  return weakest ? REGION_CODE[weakest] : 'MISMATCH'
}

/**
 * Turns the matcher's per-comparison status into what the user sees and hears. Transient states never flash a
 * correction; a problem is shown only after it persists, and spoken at most once per cooldown.
 */
export class RoutineFeedbackPolicy {
  private problem?: RoutineFeedbackCode
  private problemSince = 0
  private confirmed?: RoutineFeedbackCode
  private clearSince?: number
  private recoveredUntil = -Infinity
  private lastSpokenAt = -Infinity
  private sequence = 0

  reset(): void {
    this.problem = undefined
    this.confirmed = undefined
    this.clearSince = undefined
    this.recoveredUntil = -Infinity
  }

  update(match: FollowAlongMatch | undefined, now: number, cue: string): RoutineFeedbackUpdate {
    if (!match || match.status === 'insufficient') {
      this.problem = undefined
      this.clearSince = undefined
      return { feedback: { code: 'READING', tone: 'neutral', message: MESSAGES.READING } }
    }
    const problem = problemOf(match)
    if (problem) {
      // Different kinds of mismatch are one episode; rhythm problems are their own.
      const family = (code: RoutineFeedbackCode) => (code.startsWith('MISMATCH') ? 'MISMATCH' : code)
      if (!this.problem || family(this.problem) !== family(problem)) this.problemSince = now
      this.problem = problem
      this.clearSince = undefined
      const sustain = problem === 'AHEAD' || problem === 'BEHIND' ? ROUTINE_FEEDBACK_CONFIG.rhythmSustainMs : ROUTINE_FEEDBACK_CONFIG.mismatchSustainMs
      if (now - this.problemSince >= sustain) {
        const newlyConfirmed = this.confirmed === undefined
        this.confirmed = problem
        const feedback: RoutineFeedback = { code: problem, tone: 'warning', message: MESSAGES[problem] }
        if (newlyConfirmed && now - this.lastSpokenAt >= ROUTINE_FEEDBACK_CONFIG.voiceCooldownMs) {
          this.lastSpokenAt = now
          this.sequence += 1
          return { feedback, speak: { id: `routine-${problem}-${this.sequence}`, text: MESSAGES[problem] } }
        }
        return { feedback }
      }
      return { feedback: this.calmFeedback(match, cue) }
    }

    this.problem = undefined
    if (this.confirmed) {
      this.clearSince ??= now
      if (now - this.clearSince >= ROUTINE_FEEDBACK_CONFIG.recoverySustainMs) {
        this.confirmed = undefined
        this.recoveredUntil = now + ROUTINE_FEEDBACK_CONFIG.recoveryVisibleMs
      } else {
        return { feedback: { code: this.confirmed, tone: 'warning', message: MESSAGES[this.confirmed] } }
      }
    }
    if (now < this.recoveredUntil) return { feedback: { code: 'RECOVERED', tone: 'success', message: MESSAGES.RECOVERED } }
    return { feedback: this.calmFeedback(match, cue) }
  }

  private calmFeedback(match: FollowAlongMatch, cue: string): RoutineFeedback {
    if (match.status === 'in_sync' && match.similarity >= ROUTINE_FEEDBACK_CONFIG.followingWellSimilarity) {
      return { code: 'FOLLOWING_WELL', tone: 'success', message: MESSAGES.FOLLOWING_WELL }
    }
    return { code: 'CUE', tone: 'info', message: cue }
  }
}
