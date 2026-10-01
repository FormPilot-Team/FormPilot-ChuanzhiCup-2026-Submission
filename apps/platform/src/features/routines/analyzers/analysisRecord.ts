import type { AnalyzerEvaluation, MetricResult } from './types'

/** One chapter's analyzer result as saved in the session record: the evaluation of its whole feature sequence. */
export interface AnalysisChapterRecord {
  chapterId: string
  /** Feature samples taken in this chapter (usable or not). */
  samples: number
  evaluation: AnalyzerEvaluation | null
}

/**
 * Stored inside `RoutineSessionRecord.analysis` (optional, added with the routine analyzers). Summary numbers only —
 * never the pose sequence — so a full routine stays a few kilobytes in localStorage.
 */
export interface RoutineAnalysisRecord {
  analyzerId: string
  version: string
  chapters: AnalysisChapterRecord[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const finiteOrNull = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value))

function isMetric(value: unknown): value is MetricResult {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && finiteOrNull(value.value)
    && typeof value.unit === 'string'
    && typeof value.display === 'string'
    && typeof value.target === 'string'
    && finiteOrNull(value.score)
    && typeof value.weight === 'number' && Number.isFinite(value.weight)
    && typeof value.evaluated === 'boolean'
    && (value.note === undefined || typeof value.note === 'string')
}

export function isAnalyzerEvaluation(value: unknown): value is AnalyzerEvaluation {
  return isRecord(value)
    && finiteOrNull(value.score)
    && typeof value.usableSamples === 'number' && Number.isFinite(value.usableSamples)
    && Array.isArray(value.metrics) && value.metrics.every(isMetric)
}

/**
 * Deep check used by the report. The session record's own guard only checks that `analysis` is an object, so a
 * malformed analysis is ignored by the report instead of discarding the whole session.
 */
export function isRoutineAnalysisRecord(value: unknown): value is RoutineAnalysisRecord {
  return isRecord(value)
    && typeof value.analyzerId === 'string'
    && typeof value.version === 'string'
    && Array.isArray(value.chapters)
    && value.chapters.every((item) => isRecord(item)
      && typeof item.chapterId === 'string'
      && typeof item.samples === 'number' && Number.isFinite(item.samples)
      && (item.evaluation === null || isAnalyzerEvaluation(item.evaluation)))
}
