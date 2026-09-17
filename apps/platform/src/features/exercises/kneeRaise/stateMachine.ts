import type { KneeRaiseFeatures } from '../../motion/types'
import type { ExercisePhase, ExerciseState, KneeRaiseRepSummary } from '../types'
import { PhasePersistenceGate } from '../phasePersistence'
import { KNEE_RAISE_V1, type KneeRaiseConfig } from './config'
import { calculateKneeRaiseMetrics, weightedKneeRaiseScore } from './scoring'

export type KneeRaiseSide = 'left' | 'right'

export interface KneeRaiseStateSnapshot extends ExerciseState {
  phase: ExercisePhase
  repCount: number
  cycleCount: number
  currentSide?: KneeRaiseSide
  lastCompletedSide?: KneeRaiseSide
  repStartedAt?: number
  topEnteredAt?: number
  peakKneeHeight: number
  hipShiftMax: number
  maxTorsoLean: number
  lastLeftPeak?: number
  lastRightPeak?: number
  wrongSideSequence: boolean
  incompleteReturn: boolean
  baselineReady: boolean
  completedRep?: KneeRaiseRepSummary
}

function initial(repCount = 0, cycleCount = 0, lastCompletedSide?: KneeRaiseSide, left?: number, right?: number): KneeRaiseStateSnapshot {
  return { phase: 'CENTER', repCount, cycleCount, lastCompletedSide, lastLeftPeak: left, lastRightPeak: right,
    peakKneeHeight: -1, hipShiftMax: 0, maxTorsoLean: 0, wrongSideSequence: false, incompleteReturn: false, baselineReady: false }
}

export class KneeRaiseStateMachine {
  private state = initial()
  private readonly persistence = new PhasePersistenceGate<ExercisePhase>()
  private completeWasEmitted = false
  private unmatchedSide?: KneeRaiseSide
  constructor(private readonly config: KneeRaiseConfig = KNEE_RAISE_V1) {}
  reset(): void { this.state = initial(); this.unmatchedSide = undefined; this.persistence.reset(); this.completeWasEmitted = false }
  getSnapshot(): KneeRaiseStateSnapshot { return { ...this.state } }

  update(features: KneeRaiseFeatures): KneeRaiseStateSnapshot {
    if (this.state.phase === 'COMPLETE' && this.completeWasEmitted) {
      this.state = initial(this.state.repCount, this.state.cycleCount, this.state.lastCompletedSide, this.state.lastLeftPeak, this.state.lastRightPeak)
      this.completeWasEmitted = false
    }
    this.state.baselineReady = features.baselineReady
    if (!features.baselineReady) { this.persistence.clear(); this.state.phase = 'CENTER'; return this.emit() }
    if (features.confidence < this.config.visibilityThreshold || !features.bodyInFrame) { this.persistence.clear(); return this.emit() }

    if (this.state.currentSide) {
      const height = this.state.currentSide === 'left' ? features.leftKneeHeight : features.rightKneeHeight
      const oppositeHeight = this.state.currentSide === 'left' ? features.rightKneeHeight : features.leftKneeHeight
      this.state.peakKneeHeight = Math.max(this.state.peakKneeHeight, height)
      this.state.hipShiftMax = Math.max(this.state.hipShiftMax, features.hipHorizontalShift)
      this.state.maxTorsoLean = Math.max(this.state.maxTorsoLean, features.torsoLean)
      if (oppositeHeight >= this.config.raiseStartHeight && !this.isCenter(features)) this.state.incompleteReturn = true
    }
    const target = this.nextPhase(features)
    if (target) this.confirm(target, features)
    else this.persistence.clear()
    return this.emit()
  }

  private emit(): KneeRaiseStateSnapshot {
    const result = { ...this.state }
    if (result.phase === 'COMPLETE') this.completeWasEmitted = true
    this.state.completedRep = undefined
    return result
  }

  private isCenter(f: KneeRaiseFeatures): boolean {
    return f.leftKneeHeight <= this.config.centerHeightMax && f.rightKneeHeight <= this.config.centerHeightMax
      && Math.abs(f.leftKneeVelocity) <= this.config.centerVelocityMax && Math.abs(f.rightKneeVelocity) <= this.config.centerVelocityMax
  }

  private nextPhase(f: KneeRaiseFeatures): ExercisePhase | undefined {
    switch (this.state.phase) {
      case 'CENTER':
        if (f.leftKneeHeight >= this.config.raiseStartHeight && f.leftKneeVelocity >= this.config.raisingVelocityMin) return 'LEFT_RAISING'
        if (f.rightKneeHeight >= this.config.raiseStartHeight && f.rightKneeVelocity >= this.config.raisingVelocityMin) return 'RIGHT_RAISING'
        return undefined
      case 'LEFT_RAISING':
        return f.leftKneeHeight >= this.config.topDetectionMinHeight
          && (Math.abs(f.leftKneeVelocity) <= this.config.topVelocityMax || f.leftKneeVelocity < 0) ? 'LEFT_TOP' : undefined
      case 'RIGHT_RAISING':
        return f.rightKneeHeight >= this.config.topDetectionMinHeight
          && (Math.abs(f.rightKneeVelocity) <= this.config.topVelocityMax || f.rightKneeVelocity < 0) ? 'RIGHT_TOP' : undefined
      case 'LEFT_TOP': return f.leftKneeVelocity <= -this.config.returnVelocityMin ? 'LEFT_RETURNING' : undefined
      case 'RIGHT_TOP': return f.rightKneeVelocity <= -this.config.returnVelocityMin ? 'RIGHT_RETURNING' : undefined
      case 'LEFT_RETURNING':
      case 'RIGHT_RETURNING': return this.isCenter(f) ? 'COMPLETE' : undefined
      default: return undefined
    }
  }

  private confirm(target: ExercisePhase, f: KneeRaiseFeatures): void {
    if (!this.persistence.confirm(target, this.config.phasePersistenceFrames)) return
    const previous = this.state.phase
    this.state.phase = target
    if (target === 'LEFT_RAISING' || target === 'RIGHT_RAISING') {
      const side: KneeRaiseSide = target === 'LEFT_RAISING' ? 'left' : 'right'
      this.state.currentSide = side
      this.state.repStartedAt = f.timestamp
      this.state.topEnteredAt = undefined
      this.state.peakKneeHeight = side === 'left' ? f.leftKneeHeight : f.rightKneeHeight
      this.state.hipShiftMax = f.hipHorizontalShift
      this.state.maxTorsoLean = f.torsoLean
      this.state.wrongSideSequence = this.state.lastCompletedSide === side
      this.state.incompleteReturn = false
    }
    if (target === 'LEFT_TOP' || target === 'RIGHT_TOP') this.state.topEnteredAt = f.timestamp
    if (target === 'COMPLETE' && this.state.currentSide && this.state.repStartedAt !== undefined) {
      const side = this.state.currentSide
      const repIndex = this.state.repCount + 1
      const durationMs = f.timestamp - this.state.repStartedAt
      const nextLeft = side === 'left' ? this.state.peakKneeHeight : this.state.lastLeftPeak
      const nextRight = side === 'right' ? this.state.peakKneeHeight : this.state.lastRightPeak
      if (this.unmatchedSide && this.unmatchedSide !== side) { this.state.cycleCount += 1; this.unmatchedSide = undefined }
      else this.unmatchedSide = side
      this.state.repCount = repIndex
      this.state.lastCompletedSide = side
      this.state.lastLeftPeak = nextLeft
      this.state.lastRightPeak = nextRight
      const draft: KneeRaiseRepSummary = {
        exerciseId: 'knee_raise', repIndex, side, startedAt: this.state.repStartedAt, completedAt: f.timestamp, durationMs,
        startTime: this.state.repStartedAt, topTime: this.state.topEnteredAt ?? f.timestamp, endTime: f.timestamp,
        peakKneeHeight: this.state.peakKneeHeight, hipShiftMax: this.state.hipShiftMax, maxTorsoLean: this.state.maxTorsoLean,
        amplitudeScore: 0, stabilityScore: 0, alternationScore: 0, symmetryScore: 0, tempoScore: 0, overallScore: 0,
        errors: [], wrongSideSequence: this.state.wrongSideSequence, incompleteReturn: this.state.incompleteReturn,
      }
      const metrics = calculateKneeRaiseMetrics({ ...this.state, completedRep: draft }, f, true, this.config)
      this.state.completedRep = { ...draft, amplitudeScore: metrics.amplitude.score, stabilityScore: metrics.stability.score,
        alternationScore: metrics.alternation.score, symmetryScore: metrics.symmetry.score, tempoScore: metrics.tempo.score,
        overallScore: weightedKneeRaiseScore(metrics) }
    } else if (target === 'CENTER' && previous !== 'COMPLETE') {
      this.state.currentSide = undefined
    }
  }
}
