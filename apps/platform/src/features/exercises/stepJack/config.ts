export interface StepJackConfig {
  visibilityThreshold: number
  centerMaxRatio: number
  openingMinRatio: number
  openMinRatio: number
  armTopMinAngle: number
  armSymmetryMaxDiff: number
  syncExcellentMs: number
  syncAcceptableMs: number
  repDurationMinMs: number
  repDurationMaxMs: number
  torsoLeanMax: number
  phasePersistenceFrames: number
  directionVelocity: number
  incompleteReturnTimeoutMs: number
}

export const STEP_JACK_V1: Readonly<StepJackConfig> = Object.freeze({
  visibilityThreshold: 0.65,
  centerMaxRatio: 1.15,
  openingMinRatio: 1.22,
  openMinRatio: 1.6,
  armTopMinAngle: 130,
  armSymmetryMaxDiff: 20,
  syncExcellentMs: 200,
  syncAcceptableMs: 400,
  repDurationMinMs: 1000,
  repDurationMaxMs: 1800,
  torsoLeanMax: 12,
  phasePersistenceFrames: 3,
  directionVelocity: 0.15,
  incompleteReturnTimeoutMs: 2300,
})

export const STEP_JACK_SCORING = Object.freeze({
  syncGoodBandPenalty: 30,
  syncPoorFalloffMs: 400,
  armZeroAtDeg: 70,
  durationFalloffMs: 700,
  torsoIdealMax: 4,
  torsoZeroAt: 22,
  idleTempoScore: 65,
  inProgressCompletionValue: 0.55,
  inProgressCompletionScore: 55,
  weights: Object.freeze({
    coordination: 0.3,
    amplitude: 0.25,
    tempo: 0.2,
    stability: 0.15,
    completion: 0.1,
  }),
})
