import { ELECTRONIC_COACH_COURSE_V1 } from '../course/CourseDefinition'
import type { TrainingCaptureSource, TrainingSessionState } from '../training/types'
import { ANALYSIS_CONFIG_V1 } from './config'
import { finite } from './ratio'
import type { AnalysisMode, RulesSupport } from './types'

export const SUPPORTED_RULES_VERSION = ANALYSIS_CONFIG_V1.supportedRulesVersions[0]

export function assessRulesSupport(session: TrainingSessionState): RulesSupport {
  const version = session.rulesVersion
  if (!version) return 'LEGACY_UNVERSIONED'
  return ANALYSIS_CONFIG_V1.supportedRulesVersions.some((item) => item.spec === version.spec && item.threshold === version.threshold)
    ? 'SUPPORTED'
    : 'UNSUPPORTED'
}

/** Missing mode is NOT normal: `?fast=1` was not DEV-gated before d259fde. */
export function resolveAnalysisMode(session: TrainingSessionState): AnalysisMode {
  return session.mode === 'normal' || session.mode === 'fast' ? session.mode : 'unknown'
}

/** Mirrors the repository's `withSessionSource` default; eligibility never relies on source alone. */
export function resolveSource(session: TrainingSessionState): TrainingCaptureSource {
  return session.source ?? 'live'
}

export function sameRulesVersion(left: TrainingSessionState, right: TrainingSessionState): boolean {
  return Boolean(left.rulesVersion && right.rulesVersion
    && left.rulesVersion.spec === right.rulesVersion.spec
    && left.rulesVersion.threshold === right.rulesVersion.threshold)
}

const COURSE_ORDER = ELECTRONIC_COACH_COURSE_V1.steps.map((step) => step.exerciseId)

/** Standalone entry points and demo writers reuse the same courseId, so the exercise order is the discriminator. */
export function isCourseFlow(session: TrainingSessionState): boolean {
  return session.courseId === ELECTRONIC_COACH_COURSE_V1.id
    && session.courseVersion === ELECTRONIC_COACH_COURSE_V1.version
    && Array.isArray(session.exerciseOrder)
    && session.exerciseOrder.length === COURSE_ORDER.length
    && session.exerciseOrder.every((id, index) => id === COURSE_ORDER[index])
}

export function isFinalized(session: TrainingSessionState): boolean {
  return session.status === 'completed'
    && finite(session.endedAt)
    && (session.courseStatus === 'completed' || session.courseStatus === 'incomplete')
}
