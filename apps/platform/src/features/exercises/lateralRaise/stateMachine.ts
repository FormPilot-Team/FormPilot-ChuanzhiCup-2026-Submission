import type { MotionFeatures } from '../../motion/types'
import type { ExercisePhase, ExerciseState, LateralRaiseRepSummary } from '../types'
import { PhasePersistenceGate } from '../phasePersistence'
import { LATERAL_RAISE_V1, type LateralRaiseConfig } from './config'

export interface LateralRaiseStateSnapshot extends ExerciseState {
  phase: ExercisePhase
  repCount: number
  repStartedAt?: number
  topEnteredAt?: number
  topHoldMs: number
  peakShoulderL: number
  peakShoulderR: number
  minElbowL: number
  minElbowR: number
  maxSymmetryDiff: number
  maxTorsoLean: number
  incomplete: boolean
  completedRep?: LateralRaiseRepSummary
}

function initialSnapshot(): LateralRaiseStateSnapshot {
  return {
    phase: 'START',
    repCount: 0,
    topHoldMs: 0,
    peakShoulderL: 0,
    peakShoulderR: 0,
    minElbowL: 180,
    minElbowR: 180,
    maxSymmetryDiff: 0,
    maxTorsoLean: 0,
    incomplete: false,
  }
}

export class LateralRaiseStateMachine {
  private state = initialSnapshot()
  private readonly persistence = new PhasePersistenceGate<ExercisePhase>()
  private completeWasEmitted = false

  constructor(private readonly config: LateralRaiseConfig = LATERAL_RAISE_V1) {}

  reset(): void {
    this.state = initialSnapshot()
    this.persistence.reset()
    this.completeWasEmitted = false
  }

  getSnapshot(): LateralRaiseStateSnapshot {
    return { ...this.state }
  }

  update(features: MotionFeatures): LateralRaiseStateSnapshot {
    if (this.state.phase === 'COMPLETE' && this.completeWasEmitted) {
      this.state = { ...initialSnapshot(), repCount: this.state.repCount }
      this.completeWasEmitted = false
    }

    if (this.state.repStartedAt !== undefined) {
      this.state.peakShoulderL = Math.max(this.state.peakShoulderL, features.shoulderAngleL)
      this.state.peakShoulderR = Math.max(this.state.peakShoulderR, features.shoulderAngleR)
      this.state.minElbowL = Math.min(this.state.minElbowL, features.elbowAngleL)
      this.state.minElbowR = Math.min(this.state.minElbowR, features.elbowAngleR)
      this.state.maxSymmetryDiff = Math.max(this.state.maxSymmetryDiff, features.symmetryDiff)
      this.state.maxTorsoLean = Math.max(this.state.maxTorsoLean, features.torsoLean)
      this.state.incomplete =
        features.timestamp - this.state.repStartedAt >= this.config.incompleteTimeoutMs &&
        this.state.phase !== 'COMPLETE'
    }

    if (this.state.phase === 'TOP' && this.state.topEnteredAt !== undefined) {
      this.state.topHoldMs = features.timestamp - this.state.topEnteredAt
    }

    const target = this.nextPhase(features)
    if (target) this.confirmTransition(target, features)
    else this.persistence.clear()

    const output = { ...this.state }
    if (output.phase === 'COMPLETE') this.completeWasEmitted = true
    this.state.completedRep = undefined
    return output
  }

  private nextPhase(features: MotionFeatures): ExercisePhase | undefined {
    switch (this.state.phase) {
      case 'START':
        return features.meanShoulderAngle > this.config.raisingMinAngle &&
          features.shoulderVelocity > this.config.directionVelocity
          ? 'RAISING'
          : undefined
      case 'RAISING':
        return features.meanShoulderAngle >= this.config.topPhaseAngle &&
          features.shoulderVelocity <= this.config.topVelocity
          ? 'TOP'
          : undefined
      case 'TOP':
        return features.shoulderVelocity < -this.config.directionVelocity ? 'LOWERING' : undefined
      case 'LOWERING':
        return features.meanShoulderAngle <= this.config.startMaxAngle ? 'COMPLETE' : undefined
      default:
        return undefined
    }
  }

  private confirmTransition(target: ExercisePhase, features: MotionFeatures): void {
    if (!this.persistence.confirm(target, this.config.phasePersistenceFrames)) return

    const previousPhase = this.state.phase
    this.state.phase = target

    if (target === 'RAISING') {
      this.state.repStartedAt = features.timestamp
      this.state.peakShoulderL = features.shoulderAngleL
      this.state.peakShoulderR = features.shoulderAngleR
      this.state.minElbowL = features.elbowAngleL
      this.state.minElbowR = features.elbowAngleR
      this.state.maxSymmetryDiff = features.symmetryDiff
      this.state.maxTorsoLean = features.torsoLean
      this.state.incomplete = false
    }
    if (target === 'TOP') this.state.topEnteredAt = features.timestamp
    if (target === 'LOWERING' && this.state.topEnteredAt !== undefined) {
      this.state.topHoldMs = features.timestamp - this.state.topEnteredAt
    }
    if (target === 'COMPLETE' && this.state.repStartedAt !== undefined) {
      const repIndex = this.state.repCount + 1
      this.state.repCount = repIndex
      this.state.completedRep = {
        exerciseId: 'lateral_raise',
        repIndex,
        startedAt: this.state.repStartedAt,
        completedAt: features.timestamp,
        durationMs: features.timestamp - this.state.repStartedAt,
        topHoldMs: this.state.topHoldMs,
        peakShoulderL: this.state.peakShoulderL,
        peakShoulderR: this.state.peakShoulderR,
        minElbowL: this.state.minElbowL,
        minElbowR: this.state.minElbowR,
        maxSymmetryDiff: this.state.maxSymmetryDiff,
        maxTorsoLean: this.state.maxTorsoLean,
      }
    }
    if (previousPhase === 'LOWERING' && target !== 'COMPLETE') this.state.incomplete = true
  }
}
