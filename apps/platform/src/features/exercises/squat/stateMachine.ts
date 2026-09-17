import type { SquatFeatures } from '../../motion/types'
import type { ExercisePhase, ExerciseState, SquatRepSummary } from '../types'
import { PhasePersistenceGate } from '../phasePersistence'
import { SQUAT_V1, type SquatConfig } from './config'
import { calculateSquatMetrics, weightedSquatScore } from './scoring'

export interface SquatStateSnapshot extends ExerciseState {
  phase: ExercisePhase
  repCount: number
  repStartedAt?: number
  bottomEnteredAt?: number
  maxHipDrop: number
  minKneeSpreadRatio: number
  maxKneeHeightDiff: number
  maxTorsoLean: number
  incomplete: boolean
  baselineReady: boolean
  completedRep?: SquatRepSummary
}

function initialSnapshot(repCount = 0): SquatStateSnapshot {
  return {
    phase: 'STANDING',
    repCount,
    maxHipDrop: 0,
    minKneeSpreadRatio: 2,
    maxKneeHeightDiff: 0,
    maxTorsoLean: 0,
    incomplete: false,
    baselineReady: false,
  }
}

export class SquatStateMachine {
  private state = initialSnapshot()
  private readonly persistence = new PhasePersistenceGate<ExercisePhase>()
  private completeWasEmitted = false

  constructor(private readonly config: SquatConfig = SQUAT_V1) {}

  reset(): void {
    this.state = initialSnapshot()
    this.persistence.reset()
    this.completeWasEmitted = false
  }

  getSnapshot(): SquatStateSnapshot {
    return { ...this.state }
  }

  update(features: SquatFeatures): SquatStateSnapshot {
    if (this.state.phase === 'COMPLETE' && this.completeWasEmitted) {
      this.state = { ...initialSnapshot(this.state.repCount), baselineReady: features.baselineReady }
      this.completeWasEmitted = false
    }

    this.state.baselineReady = features.baselineReady
    if (!features.baselineReady) {
      this.persistence.clear()
      this.state.phase = 'STANDING'
      this.state.repStartedAt = undefined
      this.state.bottomEnteredAt = undefined
      this.state.incomplete = false
      return this.emit()
    }

    if (features.confidence < this.config.visibilityThreshold || !features.bodyInFrame) {
      this.persistence.clear()
      return this.emit()
    }

    if (this.state.repStartedAt !== undefined) {
      this.state.maxHipDrop = Math.max(this.state.maxHipDrop, features.hipDrop)
      this.state.minKneeSpreadRatio = Math.min(this.state.minKneeSpreadRatio, features.kneeSpreadRatio)
      this.state.maxKneeHeightDiff = Math.max(this.state.maxKneeHeightDiff, features.kneeHeightDiff)
      this.state.maxTorsoLean = Math.max(this.state.maxTorsoLean, features.torsoLean)
      this.state.incomplete =
        features.timestamp - this.state.repStartedAt >= this.config.incompleteTimeoutMs && this.state.phase !== 'COMPLETE'
    }

    const target = this.nextPhase(features)
    if (target) this.confirmTransition(target, features)
    else this.persistence.clear()

    return this.emit()
  }

  private emit(): SquatStateSnapshot {
    const output = { ...this.state }
    if (output.phase === 'COMPLETE') this.completeWasEmitted = true
    this.state.completedRep = undefined
    return output
  }

  private nextPhase(features: SquatFeatures): ExercisePhase | undefined {
    const { config } = this
    switch (this.state.phase) {
      case 'STANDING':
        return features.hipDrop >= config.descentStartHipDrop && features.hipVerticalVelocity > config.descentVelocity
          ? 'DESCENDING'
          : undefined
      case 'DESCENDING':
        if (features.hipDrop >= config.minDescentForBottom && (Math.abs(features.hipVerticalVelocity) <= config.bottomVelocity || features.hipVerticalVelocity < 0)) {
          return 'BOTTOM'
        }
        if (features.hipDrop <= config.standingReturnHipDrop && Math.abs(features.hipVerticalVelocity) <= config.standingVelocityMax) {
          return 'STANDING'
        }
        return undefined
      case 'BOTTOM':
        return features.hipVerticalVelocity < -config.descentVelocity || (features.hipDrop < this.state.maxHipDrop && features.hipVerticalVelocity < 0)
          ? 'ASCENDING'
          : undefined
      case 'ASCENDING':
        return features.hipDrop <= config.standingReturnHipDrop ? 'COMPLETE' : undefined
      default:
        return undefined
    }
  }

  private confirmTransition(target: ExercisePhase, features: SquatFeatures): void {
    if (!this.persistence.confirm(target, this.config.phasePersistenceFrames)) return

    const previous = this.state.phase
    this.state.phase = target

    if (target === 'DESCENDING' && previous === 'STANDING') {
      this.state.repStartedAt = features.timestamp
      this.state.bottomEnteredAt = undefined
      this.state.maxHipDrop = features.hipDrop
      this.state.minKneeSpreadRatio = features.kneeSpreadRatio
      this.state.maxKneeHeightDiff = features.kneeHeightDiff
      this.state.maxTorsoLean = features.torsoLean
      this.state.incomplete = false
    }
    if (target === 'STANDING' && previous === 'DESCENDING') {
      this.state.repStartedAt = undefined
      this.state.incomplete = false
    }
    if (target === 'BOTTOM') this.state.bottomEnteredAt = features.timestamp
    if (target === 'COMPLETE' && this.state.repStartedAt !== undefined) {
      const durationMs = features.timestamp - this.state.repStartedAt
      const repIndex = this.state.repCount + 1
      this.state.repCount = repIndex
      const draft: SquatRepSummary = {
        exerciseId: 'squat',
        repIndex,
        startedAt: this.state.repStartedAt,
        completedAt: features.timestamp,
        durationMs,
        maxTorsoLean: this.state.maxTorsoLean,
        bottomTime: this.state.bottomEnteredAt ?? features.timestamp,
        maxHipDrop: this.state.maxHipDrop,
        minKneeSpreadRatio: this.state.minKneeSpreadRatio,
        maxKneeHeightDiff: this.state.maxKneeHeightDiff,
        depthScore: 0,
        stabilityScore: 0,
        symmetryScore: 0,
        completionScore: 0,
        tempoScore: 0,
        overallScore: 0,
        errors: [],
      }
      const metrics = calculateSquatMetrics({ ...this.state, completedRep: draft }, features, true, this.config)
      this.state.completedRep = {
        ...draft,
        depthScore: metrics.amplitude.score,
        stabilityScore: metrics.stability.score,
        symmetryScore: metrics.symmetry.score,
        completionScore: metrics.completion.score,
        tempoScore: metrics.tempo.score,
        overallScore: weightedSquatScore(metrics),
      }
    }
  }
}
