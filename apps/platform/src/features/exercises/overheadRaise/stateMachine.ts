import type { OverheadRaiseFeatures } from '../../motion/types'
import { PhasePersistenceGate } from '../phasePersistence'
import type { ExercisePhase, ExerciseState, MotionErrorCode, OverheadRaiseRepSummary } from '../types'
import { OVERHEAD_RAISE_V1, type OverheadRaiseConfig } from './config'
import { calculateOverheadRaiseScoreComponents } from './scoring'

export interface OverheadRaiseStateSnapshot extends ExerciseState {
  phase: ExercisePhase; repCount: number; repStartedAt?: number; peakShoulderL: number; peakShoulderR: number
  minElbowL: number; minElbowR: number; topElbowL?: number; topElbowR?: number
  maxSymmetryDiff: number; maxTorsoLean: number; incomplete: boolean
  completedRep?: OverheadRaiseRepSummary
}
const initial = (): OverheadRaiseStateSnapshot => ({ phase: 'START', repCount: 0, peakShoulderL: 0, peakShoulderR: 0, minElbowL: 180, minElbowR: 180, maxSymmetryDiff: 0, maxTorsoLean: 0, incomplete: false })

function percentile(samples: ReadonlyArray<number>, fraction: number): number | undefined {
  if (!samples.length) return undefined
  const sorted = [...samples].sort((a, b) => a - b)
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

export class OverheadRaiseStateMachine {
  private state = initial(); private gate = new PhasePersistenceGate<ExercisePhase>(); private emitted = false
  private topElbowSamplesL: number[] = []; private topElbowSamplesR: number[] = []
  constructor(private readonly config: OverheadRaiseConfig = OVERHEAD_RAISE_V1) {}
  reset(): void { this.state = initial(); this.gate.reset(); this.emitted = false; this.topElbowSamplesL = []; this.topElbowSamplesR = [] }
  getSnapshot(): OverheadRaiseStateSnapshot { return { ...this.state } }
  update(f: OverheadRaiseFeatures): OverheadRaiseStateSnapshot {
    if (this.state.phase === 'COMPLETE' && this.emitted) { this.state = { ...initial(), repCount: this.state.repCount }; this.emitted = false }
    if (this.state.repStartedAt !== undefined) {
      this.state.peakShoulderL = Math.max(this.state.peakShoulderL, f.shoulderAngleL); this.state.peakShoulderR = Math.max(this.state.peakShoulderR, f.shoulderAngleR)
      this.state.minElbowL = Math.min(this.state.minElbowL, f.elbowAngleL); this.state.minElbowR = Math.min(this.state.minElbowR, f.elbowAngleR)
      this.state.maxSymmetryDiff = Math.max(this.state.maxSymmetryDiff, f.symmetryDiff); this.state.maxTorsoLean = Math.max(this.state.maxTorsoLean, f.torsoLean)
      this.state.incomplete = f.timestamp - this.state.repStartedAt >= this.config.incompleteTimeoutMs
    }
    let target: ExercisePhase | undefined
    if (this.state.phase === 'START' && f.meanShoulderAngle > this.config.raisingMinAngle && f.shoulderVelocity > this.config.directionVelocity) target = 'RAISING'
    else if (this.state.phase === 'RAISING' && f.meanShoulderAngle >= this.config.topPhaseAngle) target = 'TOP'
    else if (this.state.phase === 'TOP' && f.shoulderVelocity < -this.config.directionVelocity) target = 'LOWERING'
    else if (this.state.phase === 'LOWERING' && f.meanShoulderAngle <= this.config.startMaxAngle) target = 'COMPLETE'
    if (target && this.gate.confirm(target, this.config.phasePersistenceFrames)) this.transition(target, f); else if (!target) this.gate.clear()
    if (this.state.phase === 'TOP' && target !== 'LOWERING' && f.confidence >= this.config.visibilityThreshold && f.bodyInFrame) {
      if (Number.isFinite(f.elbowAngleL)) this.topElbowSamplesL.push(f.elbowAngleL)
      if (Number.isFinite(f.elbowAngleR)) this.topElbowSamplesR.push(f.elbowAngleR)
      this.state.topElbowL = percentile(this.topElbowSamplesL, 0.25)
      this.state.topElbowR = percentile(this.topElbowSamplesR, 0.25)
    }
    const output = { ...this.state }; if (output.phase === 'COMPLETE') this.emitted = true; this.state.completedRep = undefined; return output
  }
  private transition(target: ExercisePhase, f: OverheadRaiseFeatures): void {
    this.state.phase = target
    if (target === 'RAISING') { this.state.repStartedAt = f.timestamp; this.state.peakShoulderL = f.shoulderAngleL; this.state.peakShoulderR = f.shoulderAngleR; this.state.minElbowL = f.elbowAngleL; this.state.minElbowR = f.elbowAngleR; this.state.topElbowL = undefined; this.state.topElbowR = undefined; this.topElbowSamplesL = []; this.topElbowSamplesR = []; this.state.maxSymmetryDiff = f.symmetryDiff; this.state.maxTorsoLean = f.torsoLean; this.state.incomplete = false }
    if (target === 'COMPLETE' && this.state.repStartedAt !== undefined && !this.state.incomplete) {
      const errors: MotionErrorCode[] = []
      if (Math.min(this.state.peakShoulderL, this.state.peakShoulderR) < this.config.topMinAngle) errors.push('ARMS_TOO_LOW')
      if (this.state.topElbowL !== undefined && this.state.topElbowL < this.config.elbowCorrectionAngle) errors.push('ELBOW_TOO_BENT_L')
      if (this.state.topElbowR !== undefined && this.state.topElbowR < this.config.elbowCorrectionAngle) errors.push('ELBOW_TOO_BENT_R')
      if (this.state.maxSymmetryDiff > this.config.symmetryMaxDiff) errors.push('ASYMMETRY')
      if (this.state.maxTorsoLean > this.config.torsoLeanMax) errors.push('TORSO_LEAN')
      const durationMs = f.timestamp - this.state.repStartedAt
      if (durationMs < this.config.repDurationMinMs) errors.push('TOO_FAST')
      const scores = calculateOverheadRaiseScoreComponents(this.state.peakShoulderL, this.state.peakShoulderR,
        this.state.topElbowL ?? 110, this.state.topElbowR ?? 110, this.state.maxSymmetryDiff, this.state.maxTorsoLean, durationMs, this.config)
      this.state.repCount += 1; this.state.completedRep = { exerciseId: 'overhead_raise', repIndex: this.state.repCount, startedAt: this.state.repStartedAt, completedAt: f.timestamp, durationMs, peakShoulderL: this.state.peakShoulderL, peakShoulderR: this.state.peakShoulderR, minElbowL: this.state.minElbowL, minElbowR: this.state.minElbowR, topElbowL: this.state.topElbowL, topElbowR: this.state.topElbowR, maxSymmetryDiff: this.state.maxSymmetryDiff, maxTorsoLean: this.state.maxTorsoLean, amplitudeScore: scores.amplitude, elbowScore: scores.elbow, synchronizationScore: scores.synchronization, stabilityScore: scores.stability, tempoScore: scores.tempo, overallScore: scores.overall, errors }
    }
  }
}
