import type { StepJackFeatures } from '../../motion/types'
import type { ExercisePhase, ExerciseState, StepJackRepSummary } from '../types'
import { PhasePersistenceGate } from '../phasePersistence'
import { STEP_JACK_V1, type StepJackConfig } from './config'

type StepSide = 'left' | 'right'

export interface StepJackStateSnapshot extends ExerciseState {
  phase: ExercisePhase
  repCount: number
  lastCompletedSide?: StepSide
  activeSide?: StepSide
  repStartedAt?: number
  armOpenAt?: number
  legOpenAt?: number
  peakOpenRatio: number
  peakMeanShoulderAngle: number
  maxArmAngleDiff: number
  maxTorsoLean: number
  wrongSideSequence: boolean
  incompleteReturn: boolean
  completedRep?: StepJackRepSummary
}

function initialState(repCount = 0, lastCompletedSide?: StepSide): StepJackStateSnapshot {
  return {
    phase: 'CENTER',
    repCount,
    lastCompletedSide,
    peakOpenRatio: 1,
    peakMeanShoulderAngle: 0,
    maxArmAngleDiff: 0,
    maxTorsoLean: 0,
    wrongSideSequence: false,
    incompleteReturn: false,
  }
}

export class StepJackStateMachine {
  private state = initialState()
  private readonly persistence = new PhasePersistenceGate<ExercisePhase>()

  constructor(private readonly config: StepJackConfig = STEP_JACK_V1) {}

  reset(): void {
    this.state = initialState()
    this.persistence.reset()
  }

  getSnapshot(): StepJackStateSnapshot {
    return { ...this.state }
  }

  update(features: StepJackFeatures): StepJackStateSnapshot {
    this.state.completedRep = undefined
    if (this.state.repStartedAt !== undefined) {
      this.state.peakOpenRatio = Math.max(this.state.peakOpenRatio, features.openRatio)
      this.state.peakMeanShoulderAngle = Math.max(this.state.peakMeanShoulderAngle, features.meanShoulderAngle)
      this.state.maxArmAngleDiff = Math.max(this.state.maxArmAngleDiff, features.armAngleDiff)
      this.state.maxTorsoLean = Math.max(this.state.maxTorsoLean, features.torsoLean)
      if (this.state.armOpenAt === undefined && features.meanShoulderAngle >= this.config.armTopMinAngle) this.state.armOpenAt = features.timestamp
      if (this.state.legOpenAt === undefined && features.openRatio >= this.config.openMinRatio) this.state.legOpenAt = features.timestamp
      this.state.incompleteReturn = features.timestamp - this.state.repStartedAt > this.config.incompleteReturnTimeoutMs
    }

    const target = this.nextPhase(features)
    if (target) this.confirmTransition(target, features)
    else this.persistence.clear()
    return { ...this.state }
  }

  private nextPhase(features: StepJackFeatures): ExercisePhase | undefined {
    switch (this.state.phase) {
      case 'CENTER':
        if (features.openRatio <= this.config.openingMinRatio || features.legVelocity <= this.config.directionVelocity) return undefined
        return features.leftStepOffset >= features.rightStepOffset ? 'LEFT_OPENING' : 'RIGHT_OPENING'
      case 'LEFT_OPENING':
      case 'RIGHT_OPENING':
        if (features.openRatio >= this.config.openMinRatio) return this.state.phase === 'LEFT_OPENING' ? 'LEFT_OPEN' : 'RIGHT_OPEN'
        if (features.legVelocity < -this.config.directionVelocity) return this.state.phase === 'LEFT_OPENING' ? 'RETURNING_FROM_LEFT' : 'RETURNING_FROM_RIGHT'
        return undefined
      case 'LEFT_OPEN':
        return features.legVelocity < -this.config.directionVelocity || features.openRatio < this.config.openMinRatio ? 'RETURNING_FROM_LEFT' : undefined
      case 'RIGHT_OPEN':
        return features.legVelocity < -this.config.directionVelocity || features.openRatio < this.config.openMinRatio ? 'RETURNING_FROM_RIGHT' : undefined
      case 'RETURNING_FROM_LEFT':
      case 'RETURNING_FROM_RIGHT':
        return features.openRatio <= this.config.centerMaxRatio ? 'CENTER' : undefined
      default:
        return undefined
    }
  }

  private confirmTransition(target: ExercisePhase, features: StepJackFeatures): void {
    if (!this.persistence.confirm(target, this.config.phasePersistenceFrames)) return

    if (target === 'LEFT_OPENING' || target === 'RIGHT_OPENING') {
      const side: StepSide = target === 'LEFT_OPENING' ? 'left' : 'right'
      const expected: StepSide = this.state.lastCompletedSide === 'left' ? 'right' : 'left'
      this.state = {
        ...this.state,
        phase: target,
        activeSide: side,
        repStartedAt: features.timestamp,
        armOpenAt: features.meanShoulderAngle >= this.config.armTopMinAngle ? features.timestamp : undefined,
        legOpenAt: features.openRatio >= this.config.openMinRatio ? features.timestamp : undefined,
        peakOpenRatio: features.openRatio,
        peakMeanShoulderAngle: features.meanShoulderAngle,
        maxArmAngleDiff: features.armAngleDiff,
        maxTorsoLean: features.torsoLean,
        wrongSideSequence: side !== expected,
        incompleteReturn: false,
      }
      return
    }

    if (target === 'CENTER' && this.state.repStartedAt !== undefined && this.state.activeSide) {
      const durationMs = features.timestamp - this.state.repStartedAt
      const syncGapMs = this.state.armOpenAt !== undefined && this.state.legOpenAt !== undefined
        ? Math.abs(this.state.armOpenAt - this.state.legOpenAt)
        : durationMs
      const repIndex = this.state.repCount + 1
      const completedRep: StepJackRepSummary = {
        exerciseId: 'step_jack',
        repIndex,
        startedAt: this.state.repStartedAt,
        completedAt: features.timestamp,
        durationMs,
        maxTorsoLean: this.state.maxTorsoLean,
        side: this.state.activeSide,
        peakOpenRatio: this.state.peakOpenRatio,
        peakMeanShoulderAngle: this.state.peakMeanShoulderAngle,
        maxArmAngleDiff: this.state.maxArmAngleDiff,
        syncGapMs,
        wrongSideSequence: this.state.wrongSideSequence,
        incompleteReturn: this.state.incompleteReturn,
      }
      this.state = { ...initialState(repIndex, this.state.activeSide), completedRep }
      return
    }

    this.state.phase = target
  }
}
