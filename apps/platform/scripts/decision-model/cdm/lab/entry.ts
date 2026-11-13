// Browser bundle entry for the Coach Decision Lab (offline, standalone page; not an app route).
// The Lab calls the SAME public engine the Web uses (recommendCoachDecision); P0 and PR #49 are bundled only as baselines.
export { COACH_KNOWLEDGE } from '../../../../src/features/coachAgent/recommendation/catalogue'
export { recommendCoach } from '../../../../src/features/coachAgent/recommendation/engine'
export { getCoachWebRecommendation } from '../../../../src/features/coachAgent/recommendation/webService'
export { rankCoachDecision, isLimitedProfile } from '../../../../src/features/coachAgent/decisionModel/ranker'
export { getCoachDecisionRecommendation } from '../../../../src/features/coachAgent/decisionModel/adapter'
export { recommendCoachDecision, describeCoachDecisionModel, createCoachDecisionEngine, COACH_DECISION_CONTRACT, FP_CDM_RELEASE, featureLabel } from '../../../../src/features/coachAgent/decisionModel/engine'
export { scenarioEvidence } from '../evidence'
