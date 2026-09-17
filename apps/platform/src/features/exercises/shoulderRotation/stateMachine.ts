import type { ShoulderRotationFeatures } from '../../motion/types'
import type { ExerciseState } from '../types'
import { SHOULDER_ROTATION_V1, type ShoulderRotationConfig } from './config'

export interface ShoulderRotationStateSnapshot extends ExerciseState {
  phase: 'READY' | 'ROTATING' | 'COMPLETE'
  repCount: 0
  activeMotionMs: number
  startedAt?: number
  lastTimestamp?: number
  lastMotionAt?: number
  paused: boolean
}

const initial = (): ShoulderRotationStateSnapshot => ({ phase: 'READY', repCount: 0, activeMotionMs: 0, paused: false })

export class ShoulderRotationStateMachine {
  private state = initial()
  constructor(private readonly config: ShoulderRotationConfig = SHOULDER_ROTATION_V1) {}
  reset(): void { this.state = initial() }
  getSnapshot(): ShoulderRotationStateSnapshot { return { ...this.state } }
  update(features: ShoulderRotationFeatures): ShoulderRotationStateSnapshot {
    const dt = this.state.lastTimestamp === undefined ? 0 : Math.max(0, features.timestamp - this.state.lastTimestamp)
    if (this.state.phase === 'READY' && features.moving) {
      this.state.phase = 'ROTATING'
      this.state.startedAt = features.timestamp
    }
    if (this.state.phase === 'ROTATING') {
      if (features.moving) {
        this.state.activeMotionMs += dt
        this.state.lastMotionAt = features.timestamp
        this.state.paused = false
      } else if (this.state.lastMotionAt !== undefined && features.timestamp - this.state.lastMotionAt >= this.config.pauseTimeoutMs) {
        this.state.paused = true
      }
      if (this.state.activeMotionMs >= this.config.targetDurationMs) this.state.phase = 'COMPLETE'
    }
    this.state.lastTimestamp = features.timestamp
    return { ...this.state }
  }
}
