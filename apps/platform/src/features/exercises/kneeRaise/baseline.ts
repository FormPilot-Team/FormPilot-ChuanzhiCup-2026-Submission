import { median } from '../../pose/PoseFilter'
import { KNEE_RAISE_V1, type KneeRaiseConfig } from './config'

export interface KneeRaiseBaselineSample {
  hipMidX: number
  hipY: number
  torsoLength: number
  leftKneeHeight: number
  rightKneeHeight: number
  leftKneeVelocity: number
  rightKneeVelocity: number
  confidence: number
  bodyInFrame: boolean
}

export interface KneeRaiseBaselineSnapshot {
  ready: boolean
  baselineHipMidX: number
  baselineHipY: number
  baselineTorsoLength: number
}

const empty = (): KneeRaiseBaselineSnapshot => ({ ready: false, baselineHipMidX: 0, baselineHipY: 0, baselineTorsoLength: 0 })

export class KneeRaiseCenterBaseline {
  private samples: KneeRaiseBaselineSample[] = []
  private frozen?: KneeRaiseBaselineSnapshot
  private lostFrames = 0

  constructor(private readonly config: KneeRaiseConfig = KNEE_RAISE_V1) {}

  reset(): void { this.samples = []; this.frozen = undefined; this.lostFrames = 0 }
  snapshot(): KneeRaiseBaselineSnapshot { return this.frozen ?? empty() }

  update(sample: KneeRaiseBaselineSample): KneeRaiseBaselineSnapshot {
    if (!sample.bodyInFrame || sample.confidence < this.config.visibilityThreshold) {
      this.lostFrames += 1
      if (this.lostFrames >= this.config.baselineLostFramesToReset) this.reset()
      return this.snapshot()
    }
    this.lostFrames = 0
    if (this.frozen) return this.frozen
    const stableCenter = sample.leftKneeHeight <= this.config.baselineCenterHeightMax
      && sample.rightKneeHeight <= this.config.baselineCenterHeightMax
      && Math.abs(sample.leftKneeVelocity) <= this.config.baselineVelocityMax
      && Math.abs(sample.rightKneeVelocity) <= this.config.baselineVelocityMax
    if (!stableCenter) { this.samples = []; return this.snapshot() }
    this.samples.push(sample)
    if (this.samples.length > this.config.baselineStableFrames) this.samples.shift()
    if (this.samples.length >= this.config.baselineStableFrames) {
      this.frozen = {
        ready: true,
        baselineHipMidX: median(this.samples.map((item) => item.hipMidX)),
        baselineHipY: median(this.samples.map((item) => item.hipY)),
        baselineTorsoLength: median(this.samples.map((item) => item.torsoLength)),
      }
      this.samples = []
    }
    return this.snapshot()
  }
}
