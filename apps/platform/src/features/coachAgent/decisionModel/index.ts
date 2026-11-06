/**
 * Optional FormPilot decision model adapter (fp-coach-ranker v1). Default mode is 'off'.
 * The P0 rules service (recommendation/webService.ts) stays the independent default path.
 */
export { getCoachDecisionRecommendation, createCoachDecisionService, compareSlates, DEFAULT_DECISION_MODEL_MODE, VALIDATED_CATALOGUE_FINGERPRINT } from './adapter'
export { rankCoachDecision, candidatePool, catalogueFingerprint, isLimitedProfile, profileNeeds, RANKER_WEIGHTS, SLATE_LIMITS } from './ranker'
export { guardModelOutput } from './guard'
export { DESCRIPTOR_USAGE, DESCRIPTOR_META, MOTION_DESCRIPTORS, descriptorIntegrity } from './descriptors'
export * from './types'
