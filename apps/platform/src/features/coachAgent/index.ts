export * from './contracts'
export { createRemoteCoachProvider, type RemoteCoachProviderOptions } from './remoteProvider'
export { parseRemoteContext, validateRemoteStep, type RemoteCoachContext } from './remoteProtocol'
export {
  validateScoringEvidence,
  validateMotionEvent,
  validateTrainingSessionSummary,
  validateCoachIntervention,
  validateTrainingPlanDraft,
  validateAgentToolResult,
} from './validation'
