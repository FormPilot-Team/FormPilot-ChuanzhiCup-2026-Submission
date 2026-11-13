/**
 * fp-cdm internals: trained FormPilot coach decision model (M2 pairwise preference ranker + M1 content features).
 * The product entry point is ../engine (recommendCoachDecision); these exports serve the engine, evaluation and the Lab.
 */
export { guardCdmOutput } from './guard'
export { inferCdm, loadWeights, tierOf, BUNDLED_WEIGHTS, CDM_MODEL_ID, CDM_MODEL_VERSION, CDM_RUNTIME_VERSION, LABEL_TIER_OF, RETRIEVAL_K, retrieveCandidates,
  type CdmOutput, type CdmWeights, type CdmWeightsStatus, type CdmWeightsFailure, type CdmLabelTier, type CdmCandidateScore } from './model'
export { buildFeatures, FEATURE_NAMES, FEATURE_GROUPS, FEATURE_SET_VERSION, type FeatureGroup } from './features'
export { featureLabel, reasonSentences, GROUP_LABELS } from './explain'
export { stateFromEvidence, stateFromScenario, type DecisionState, type DataOriginTag } from './state'
