import type { PoseLandmark } from '../../pose/types'
import type { CapturedPose } from '../types'
import { bodyCoords, buildPoseMatch, readPoseMatch, type PoseMatchModel } from './poseMatch'

/** Research-only three-pose stage matcher; current saved actions have no middle-pose field. */
export class ThreeStagePrototype {
  private readonly outward: PoseMatchModel
  private readonly upper: PoseMatchModel
  private stage: 'need-start' | 'need-middle' | 'need-finish' | 'need-return-middle' | 'need-return-start' = 'need-start'
  private stable = 0
  private reps = 0

  constructor(start: CapturedPose, middle: CapturedPose, finish: CapturedPose) {
    const outward = buildPoseMatch(start, middle).model
    const upper = buildPoseMatch(middle, finish).model
    if (!outward || !upper) throw new Error('三个阶段的姿势差别不足。')
    this.outward = outward
    this.upper = upper
  }

  push(landmarks: ReadonlyArray<PoseLandmark> | null, aspect: number): number {
    if (!landmarks) { this.reset(); return this.reps }
    const coords = bodyCoords(landmarks, aspect)
    if (!coords) { this.reset(); return this.reps }
    const model = this.stage === 'need-finish' || this.stage === 'need-return-middle' ? this.upper : this.outward
    const reading = readPoseMatch(model, coords)
    if (reading.progress === null || reading.deviation === null || reading.deviation > 0.45) {
      this.stable = 0
      return this.reps
    }
    const target = this.stage === 'need-middle' || this.stage === 'need-finish' ? 1 : 0
    const reached = Math.abs(reading.progress - target) <= 0.15
    this.stable = reached ? this.stable + 1 : 0
    if (this.stable < 2) return this.reps
    this.stable = 0
    switch (this.stage) {
      case 'need-start': this.stage = 'need-middle'; break
      case 'need-middle': this.stage = 'need-finish'; break
      case 'need-finish': this.stage = 'need-return-middle'; break
      case 'need-return-middle': this.stage = 'need-return-start'; break
      case 'need-return-start': this.reps += 1; this.stage = 'need-start'; break
    }
    return this.reps
  }

  reset(): void { this.stage = 'need-start'; this.stable = 0 }
}
