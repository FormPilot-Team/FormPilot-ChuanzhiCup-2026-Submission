/**
 * FormPilot Coach Decision engine — the ONLY entry point the Web needs.
 *
 *   import { recommendCoachDecision, COACH_DECISION_CONTRACT } from '<relative path>/features/coachAgent/decisionModel/engine'
 *   const res = recommendCoachDecision({ contract: COACH_DECISION_CONTRACT, profile }, { mode: 'shadow' })
 *   render(res.display)            // always the thing to show; res.ranking / res.model for explanation panels
 *
 * Browser-only, synchronous, no network, no paid API, no Qwen / StartLux weights. Default mode 'off' = Agent Web P0 rules.
 * See docs/ai-coach-agent/decision-model/WEB_INTEGRATION_READY.md.
 */
export { recommendCoachDecision, describeCoachDecisionModel, createCoachDecisionEngine, type CoachDecisionEngine, type CoachDecisionEngineConfig } from './engine'
export * from './contract'
// Local-record helpers (routine session store + consent-gated report reader) live in './platform' so this core import stays small:
//   import { collectLocalDecisionInput, historyFromRoutineSessions } from '<relative path>/features/coachAgent/decisionModel/engine/platform'
export { FP_CDM_RELEASE, weightsFingerprint, contentTableFingerprint, fingerprintText } from './release'
export { featureLabel } from '../cdm/explain'
