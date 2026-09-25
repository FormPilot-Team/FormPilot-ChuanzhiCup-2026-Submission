export interface GestureHoldConfig {
  holdDurationMs: number
  cooldownMs: number
}

export interface GestureHoldSnapshot<TKey extends string> {
  key?: TKey
  progress: number
  triggered: boolean
  coolingDown: boolean
}

export const DEFAULT_GESTURE_HOLD_CONFIG: Readonly<GestureHoldConfig> = Object.freeze({
  holdDurationMs: 1200,
  cooldownMs: 2000,
})

export class GestureHoldController<TKey extends string> {
  private key?: TKey
  private startedAt?: number
  private cooldownUntil = -Infinity

  constructor(private readonly config: GestureHoldConfig = DEFAULT_GESTURE_HOLD_CONFIG) {}

  reset(clearCooldown = false): void {
    this.key = undefined
    this.startedAt = undefined
    if (clearCooldown) this.cooldownUntil = -Infinity
  }

  update(key: TKey | undefined, held: boolean, now: number): GestureHoldSnapshot<TKey> {
    if (now < this.cooldownUntil) {
      this.key = undefined
      this.startedAt = undefined
      return { progress: 0, triggered: false, coolingDown: true }
    }
    if (!key || !held) {
      this.key = undefined
      this.startedAt = undefined
      return { key, progress: 0, triggered: false, coolingDown: false }
    }
    if (this.key !== key) {
      this.key = key
      this.startedAt = now
    }
    this.startedAt ??= now
    const progress = Math.min(1, Math.max(0, (now - this.startedAt) / this.config.holdDurationMs))
    if (progress < 1) return { key, progress, triggered: false, coolingDown: false }

    this.cooldownUntil = now + this.config.cooldownMs
    this.key = undefined
    this.startedAt = undefined
    return { key, progress: 1, triggered: true, coolingDown: false }
  }
}
