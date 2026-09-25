import { ENGINEERING_THRESHOLD_VERSION, EXERCISE_SPEC_VERSION } from '../exercises/thresholdVersioning'
import type { TrainingSessionState } from '../training/types'
import type { AnalysisMode, RulesAssessment } from './types'

export const SUPPORTED_RULES_VERSION = Object.freeze({
  spec: EXERCISE_SPEC_VERSION,
  threshold: ENGINEERING_THRESHOLD_VERSION,
})

export function assessRulesSupport(session: TrainingSessionState): RulesAssessment {
  if (!session.rulesVersion) return { support: 'LEGACY_UNVERSIONED', version: null }
  const version = { spec: session.rulesVersion.spec, threshold: session.rulesVersion.threshold }
  return {
    support: version.spec === SUPPORTED_RULES_VERSION.spec && version.threshold === SUPPORTED_RULES_VERSION.threshold
      ? 'SUPPORTED'
      : 'UNSUPPORTED',
    version,
  }
}
export function resolveAnalysisMode(session: TrainingSessionState): AnalysisMode {
  return session.mode === 'normal' || session.mode === 'fast' ? session.mode : 'unknown'
}

export function sameRulesVersion(left: TrainingSessionState, right: TrainingSessionState): boolean {
  return Boolean(left.rulesVersion && right.rulesVersion
    && left.rulesVersion.spec === right.rulesVersion.spec
    && left.rulesVersion.threshold === right.rulesVersion.threshold)
}
