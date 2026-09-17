import { clamp } from '../motion/geometry'
import type { BaseMotionFeatures } from '../motion/types'
import type { MotionError, MotionErrorCode } from './types'

export function makeMotionError(
  code: MotionErrorCode,
  severity: number,
  message: string,
  side?: MotionError['side'],
): MotionError {
  return { code, severity: clamp(severity), message, side }
}

export function collectPoseQualityErrors(
  features: Pick<BaseMotionFeatures, 'bodyInFrame' | 'confidence'>,
  visibilityThreshold: number,
  lowConfidenceMessage: string,
): MotionError[] {
  if (!features.bodyInFrame) {
    return [makeMotionError('BODY_OUT_OF_FRAME', 1, '请调整位置，确保身体完整入镜')]
  }
  if (features.confidence < visibilityThreshold) {
    return [makeMotionError('POSE_LOW_CONFIDENCE', 1 - features.confidence, lowConfidenceMessage)]
  }
  return []
}

export function sortMotionErrors(
  errors: MotionError[],
  priority: Partial<Record<MotionErrorCode, number>>,
): MotionError[] {
  return errors.sort((a, b) => (priority[b.code] ?? 0) - (priority[a.code] ?? 0) || b.severity - a.severity)
}
