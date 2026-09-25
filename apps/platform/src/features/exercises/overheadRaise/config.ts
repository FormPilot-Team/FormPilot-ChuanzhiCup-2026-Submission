export interface OverheadRaiseConfig extends Record<string, number> {
  visibilityThreshold: number
  startMaxAngle: number
  raisingMinAngle: number
  topPhaseAngle: number
  topMinAngle: number
  elbowMinAngle: number
  elbowCorrectionAngle: number
  elbowCorrectionConfirmMs: number
  elbowRecoveryMs: number
  symmetryMaxDiff: number
  torsoLeanMax: number
  repDurationMinMs: number
  repDurationMaxMs: number
  incompleteTimeoutMs: number
  phasePersistenceFrames: number
  directionVelocity: number
  topVelocity: number
}

export const OVERHEAD_RAISE_V1: Readonly<OverheadRaiseConfig> = Object.freeze({
  visibilityThreshold: .65, startMaxAngle: 25, raisingMinAngle: 30, topPhaseAngle: 138,
  topMinAngle: 150, elbowMinAngle: 150, elbowCorrectionAngle: 135,
  elbowCorrectionConfirmMs: 650, elbowRecoveryMs: 500, symmetryMaxDiff: 12, torsoLeanMax: 10,
  repDurationMinMs: 2000, repDurationMaxMs: 4000, incompleteTimeoutMs: 6000,
  phasePersistenceFrames: 3, directionVelocity: 6, topVelocity: 30,
})

export const OVERHEAD_RAISE_SCORING = Object.freeze({ weights: Object.freeze({ amplitude: .35, elbow: .25, synchronization: .2, stability: .1, tempo: .1 }) })
