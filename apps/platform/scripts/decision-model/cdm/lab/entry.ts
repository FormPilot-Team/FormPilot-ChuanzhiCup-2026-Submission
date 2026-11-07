// Browser bundle entry for the Coach Decision Model Lab (offline, standalone page; not an app route).
export { COACH_KNOWLEDGE } from '../../../../src/features/coachAgent/recommendation/catalogue'
export { recommendCoach } from '../../../../src/features/coachAgent/recommendation/engine'
export { getCoachWebRecommendation } from '../../../../src/features/coachAgent/recommendation/webService'
export { rankCoachDecision, isLimitedProfile } from '../../../../src/features/coachAgent/decisionModel/ranker'
export { getCoachDecisionRecommendation } from '../../../../src/features/coachAgent/decisionModel/adapter'
export { createCdmService, loadWeights, stateFromScenario, FEATURE_GROUPS } from '../../../../src/features/coachAgent/decisionModel/cdm'
export { scenarioEvidence } from '../evidence'
