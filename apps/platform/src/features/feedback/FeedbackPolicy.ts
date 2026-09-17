import type { RuleResult, MotionError, MotionErrorCode } from '../exercises/types'
import type { FeedbackEvent, FeedbackPolicySnapshot } from './types'

export interface FeedbackPolicyConfig {
  confirmMs: number
  recoveryMs: number
  sameFeedbackCooldownMs: number
  differentFeedbackGapMs: number
}

export const DEFAULT_FEEDBACK_POLICY: FeedbackPolicyConfig = {
  confirmMs: 350,
  recoveryMs: 500,
  sameFeedbackCooldownMs: 4000,
  differentFeedbackGapMs: 1500,
}

const RECOVERY_MESSAGE: Partial<Record<MotionErrorCode, string>> = {
  ARM_TOO_LOW_L: '很好，保持这个高度',
  ARM_TOO_LOW_R: '很好，保持这个高度',
  ASYMMETRY: '左右已经比较一致了',
  ELBOW_TOO_BENT_L: '很好，手臂更舒展了',
  ELBOW_TOO_BENT_R: '很好，手臂更舒展了',
  TORSO_LEAN: '动作更稳定了',
  STEP_TOO_SMALL: '很好，侧步幅度更充分了',
  ARM_TOO_LOW: '很好，手臂高度到位了',
  ARM_LEG_UNSYNCED: '很好，手脚更同步了',
  BODY_SWAY: '很好，核心更稳定了',
  INCOMPLETE_RETURN: '很好，已经回到中间位置',
  DEPTH_INSUFFICIENT: '很好，下蹲深度更充分了',
  KNEE_VALGUS: '很好，膝盖方向更稳定了',
  LEFT_RIGHT_ASYMMETRY: '很好，左右更均衡了',
  TORSO_LATERAL_LEAN: '很好，身体更居中了',
  INCOMPLETE_REP: '很好，已经回到完整站立位',
  KNEE_TOO_LOW_L: '很好，保持左膝这个高度',
  KNEE_TOO_LOW_R: '很好，保持右膝这个高度',
  LEFT_RIGHT_HEIGHT_GAP: '左右已经更一致了',
  MOTION_TOO_SMALL: '很好，保持这个幅度',
  ARMS_UNSYNCED: '很好，双臂已经更同步了',
  MOTION_PAUSED: '很好，保持动作连续',
  ARMS_TOO_LOW: '很好，保持这个高度',
}

export const FALLBACK_RECOVERY_MESSAGE = '很好，保持这个状态'

export class FeedbackPolicy {
  private firstSeen = new Map<MotionErrorCode, number>()
  private lastSpoken = new Map<MotionErrorCode, number>()
  private lastOutputAt = -Infinity
  private active?: MotionError
  private recoveryStartedAt?: number
  private recoveredFeedback?: FeedbackEvent
  private lastOutputCode?: MotionErrorCode

  constructor(private readonly config: FeedbackPolicyConfig = DEFAULT_FEEDBACK_POLICY) {}

  reset(): void {
    this.firstSeen.clear()
    this.lastSpoken.clear()
    this.lastOutputAt = -Infinity
    this.active = undefined
    this.recoveryStartedAt = undefined
    this.recoveredFeedback = undefined
    this.lastOutputCode = undefined
  }

  getSnapshot(): FeedbackPolicySnapshot {
    return {
      confirmedPrimaryFeedback: this.active ? { ...this.active } : undefined,
      recoveredFeedback: this.recoveredFeedback ? { ...this.recoveredFeedback } : undefined,
    }
  }

  update(result: RuleResult, now = Date.now()): FeedbackEvent | undefined {
    this.recoveredFeedback = undefined
    const presentCodes = new Set(result.errors.map((item) => item.code))
    for (const code of this.firstSeen.keys()) if (!presentCodes.has(code)) this.firstSeen.delete(code)
    for (const item of result.errors) if (!this.firstSeen.has(item.code)) this.firstSeen.set(item.code, now)

    if (this.active && !presentCodes.has(this.active.code)) {
      this.recoveryStartedAt ??= now
      if (now - this.recoveryStartedAt >= this.config.recoveryMs) {
        const previous = this.active
        this.active = undefined
        this.recoveryStartedAt = undefined
        const message = RECOVERY_MESSAGE[previous.code] ?? FALLBACK_RECOVERY_MESSAGE
        this.recoveredFeedback = this.event('recovery', now, message, previous, result.exerciseId)
        if (now - this.lastOutputAt >= this.config.differentFeedbackGapMs) {
          this.lastOutputAt = now
          this.lastOutputCode = previous.code
          return this.recoveredFeedback
        }
      }
    } else if (this.active) {
      this.recoveryStartedAt = undefined
    }

    const candidate = result.errors[0]
    if (!candidate) return undefined
    if (now - (this.firstSeen.get(candidate.code) ?? now) < this.config.confirmMs) return undefined
    const lastSame = this.lastSpoken.get(candidate.code) ?? -Infinity
    const gap = candidate.code === this.lastOutputCode ? this.config.sameFeedbackCooldownMs : this.config.differentFeedbackGapMs
    this.active = candidate
    this.recoveryStartedAt = undefined
    if (now - lastSame < this.config.sameFeedbackCooldownMs || now - this.lastOutputAt < gap) return undefined

    this.lastOutputAt = now
    this.lastOutputCode = candidate.code
    this.lastSpoken.set(candidate.code, now)
    return this.event('correction', now, candidate.message, candidate, result.exerciseId)
  }

  private event(kind: FeedbackEvent['kind'], timestamp: number, message: string, source: MotionError, exerciseId: RuleResult['exerciseId']): FeedbackEvent {
    return {
      id: `${timestamp}-${kind}-${source.code}`,
      timestamp,
      kind,
      exerciseId,
      code: source.code,
      message,
      side: source.side,
      severity: source.severity,
    }
  }
}
