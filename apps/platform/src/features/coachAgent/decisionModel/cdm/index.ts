/**
 * fp-cdm: trained FormPilot coach decision model (M2 pairwise preference ranker + M1 content features).
 * Default mode 'off'. Ranks only when human-label-trained weights are bundled (status TRAINED).
 */
export { getCoachCdmRecommendation, createCdmService, guardCdmOutput, DEFAULT_CDM_MODE, type CdmOptions, type CdmResponse, type CdmFallbackReason } from './adapter'
export { inferCdm, loadWeights, BUNDLED_WEIGHTS, CDM_MODEL_ID, CDM_MODEL_VERSION, type CdmOutput, type CdmWeights, type CdmCandidateScore } from './model'
export { buildFeatures, FEATURE_NAMES, FEATURE_GROUPS, FEATURE_SET_VERSION } from './features'
export { stateFromEvidence, stateFromScenario, type DecisionState } from './state'
