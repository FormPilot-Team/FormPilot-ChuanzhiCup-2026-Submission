import { SCORING_VERSION } from '../types'

/**
 * Evidence of one phase window: the standard video's phase (start/end in video seconds), how many user samples
 * fell inside it, and the aggregated user value with its score. `value` is null when the user could not be observed.
 */
export interface TechniqueWindowObservation {
  start: number
  end: number
  samples: number
  value: number | null
  score: number | null
}

export interface TechniqueCriterionRecord {
  criterionId: string
  chapterId: string
  windows: TechniqueWindowObservation[]
}

/** Stored inside the routine session record (optional field, added by Scoring v2). */
export interface RoutineTechniqueRecord {
  version: typeof SCORING_VERSION | string
  criteria: TechniqueCriterionRecord[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

const finiteOrNull = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value))

function isWindow(value: unknown): value is TechniqueWindowObservation {
  return isRecord(value)
    && typeof value.start === 'number' && Number.isFinite(value.start)
    && typeof value.end === 'number' && Number.isFinite(value.end)
    && typeof value.samples === 'number' && Number.isFinite(value.samples)
    && finiteOrNull(value.value) && finiteOrNull(value.score)
}

export function isRoutineTechniqueRecord(value: unknown): value is RoutineTechniqueRecord {
  return isRecord(value)
    && typeof value.version === 'string'
    && Array.isArray(value.criteria)
    && value.criteria.every((item) => isRecord(item)
      && typeof item.criterionId === 'string'
      && typeof item.chapterId === 'string'
      && Array.isArray(item.windows)
      && item.windows.every(isWindow))
}
