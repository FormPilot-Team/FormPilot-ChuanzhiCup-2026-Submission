export interface SquatConfig {
  visibilityThreshold: number
  standingReturnHipDrop: number
  standingVelocityMax: number
  descentStartHipDrop: number
  descentVelocity: number
  minDescentForBottom: number
  bottomVelocity: number
  validDepthHipDrop: number
  depthVeryLow: number
  depthPartial: number
  depthPlateau: number
  kneeValgusMaxRatio: number
  kneeHeightDiffMax: number
  torsoLeanMax: number
  repDurationMinMs: number
  repDurationMaxMs: number
  incompleteTimeoutMs: number
  phasePersistenceFrames: number
  baselineStableFrames: number
  baselineMinHipKneeSeparation: number
  baselineLostFramesToReset: number
  baselineVelocityMax: number
}

export const SQUAT_V1: Readonly<SquatConfig> = Object.freeze({
  visibilityThreshold: 0.65,
  standingReturnHipDrop: 0.08,
  standingVelocityMax: 0.025,
  descentStartHipDrop: 0.05,
  descentVelocity: 0.04,
  minDescentForBottom: 0.15,
  bottomVelocity: 0.05,
  validDepthHipDrop: 0.3,
  depthVeryLow: 0.1,
  depthPartial: 0.2,
  depthPlateau: 0.35,
  kneeValgusMaxRatio: 0.75,
  kneeHeightDiffMax: 0.08,
  torsoLeanMax: 10,
  repDurationMinMs: 3000,
  repDurationMaxMs: 5000,
  incompleteTimeoutMs: 8000,
  phasePersistenceFrames: 3,
  baselineStableFrames: 10,
  baselineMinHipKneeSeparation: 0.7,
  baselineLostFramesToReset: 12,
  baselineVelocityMax: 0.03,
})

export const SQUAT_SCORING = Object.freeze({
  durationFalloffMs: 1500,
  kneeHeightIdealMax: 0.03,
  kneeHeightZeroAt: 0.16,
  kneeSpreadIdealMin: 0.92,
  kneeSpreadZeroAt: 0.55,
  torsoIdealMax: 3,
  torsoZeroAt: 20,
  idleTempoScore: 65,
  inProgressCompletionValue: 0.55,
  inProgressCompletionScore: 55,
  stabilityKneeWeight: 0.6,
  stabilityTorsoWeight: 0.4,
  weights: Object.freeze({
    amplitude: 0.3,
    stability: 0.25,
    symmetry: 0.2,
    completion: 0.15,
    tempo: 0.1,
  }),
})
