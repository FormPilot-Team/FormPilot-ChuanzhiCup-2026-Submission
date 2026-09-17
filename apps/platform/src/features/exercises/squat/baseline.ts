import { median } from '../../pose/PoseFilter'
import { SQUAT_V1, type SquatConfig } from './config'

export interface BaselineSample {
  hipY: number
  torsoLength: number
  hipWidth: number
  kneeWidth: number
  hipKneeSeparation: number
  hipVerticalVelocity: number
  confidence: number
  bodyInFrame: boolean
}

export interface StandingBaselineSnapshot {
  ready: boolean
  standingHipY: number
  standingTorsoLength: number
  standingHipWidth: number
  standingKneeWidth: number
}

function emptySnapshot(): StandingBaselineSnapshot {
  return {
    ready: false,
    standingHipY: 0,
    standingTorsoLength: 0,
    standingHipWidth: 0,
    standingKneeWidth: 0,
  }
}

export class StandingBaseline {
  private window: BaselineSample[] = []
  private lostFrames = 0
  private frozen?: StandingBaselineSnapshot

  constructor(private readonly config: SquatConfig = SQUAT_V1) {}

  reset(): void {
    this.window = []
    this.lostFrames = 0
    this.frozen = undefined
  }

  snapshot(): StandingBaselineSnapshot {
    return this.frozen ?? emptySnapshot()
  }

  update(sample: BaselineSample): StandingBaselineSnapshot {
    const qualityOk = sample.bodyInFrame && sample.confidence >= this.config.visibilityThreshold
    if (!qualityOk) {
      this.lostFrames += 1
      if (this.lostFrames >= this.config.baselineLostFramesToReset) {
        this.window = []
        this.frozen = undefined
        this.lostFrames = 0
      }
      return this.snapshot()
    }

    this.lostFrames = 0
    if (this.frozen) return this.frozen

    const standingLike =
      sample.hipKneeSeparation >= this.config.baselineMinHipKneeSeparation &&
      Math.abs(sample.hipVerticalVelocity) <= this.config.baselineVelocityMax

    if (!standingLike) {
      this.window = []
      return this.snapshot()
    }

    this.window.push(sample)
    if (this.window.length > this.config.baselineStableFrames) this.window.shift()
    if (this.window.length >= this.config.baselineStableFrames) {
      this.frozen = {
        ready: true,
        standingHipY: median(this.window.map((item) => item.hipY)),
        standingTorsoLength: median(this.window.map((item) => item.torsoLength)),
        standingHipWidth: median(this.window.map((item) => item.hipWidth)),
        standingKneeWidth: median(this.window.map((item) => item.kneeWidth)),
      }
      this.window = []
    }
    return this.snapshot()
  }
}
