import { isRoutineTechniqueRecord, type RoutineTechniqueRecord } from '../../scoring/routine/techniqueRecord'
import type { RoutineAnalysisRecord } from '../analyzers/analysisRecord'
import type { FollowAlongRegion } from '../followAlong/matcher'
import type { RoutineId, RoutineScope } from '../types'

/**
 * A follow-along routine session. Kept apart from Smart Training's `TrainingSessionState` on purpose: that schema
 * and its analysis (analysis-v1) are built around the six scored exercises, while a routine is measured by how
 * closely and how completely the user followed the standard video, chapter by chapter.
 */
export const ROUTINE_SESSION_SCHEMA_VERSION = 1

export type RoutineSessionSource = 'live' | 'synthetic'
export type RoutineSessionMode = 'normal' | 'fast'
export type RoutineSessionOutcome = 'in_progress' | 'completed' | 'incomplete'
export type FollowAlongCountedStatus = 'in_sync' | 'ahead' | 'behind' | 'mismatch'

export interface RoutineChapterResult {
  chapterId: string
  /** Chapter length in whole seconds (the coverage denominator). */
  totalSeconds: number
  /** Distinct seconds of this chapter that played while the user was training. */
  coveredSeconds: number
  /** Comparisons that produced a result. */
  samples: number
  /** Comparisons skipped because the pose was not reliable enough. */
  insufficientSamples: number
  /** Sum of the smoothed similarity (0..1) over `samples`. */
  similaritySum: number
  regionSums: Record<FollowAlongRegion, number>
  regionSamples: Record<FollowAlongRegion, number>
  statusCounts: Record<FollowAlongCountedStatus, number>
  mirroredSamples: number
}

export interface RoutineSessionRecord {
  schemaVersion: typeof ROUTINE_SESSION_SCHEMA_VERSION
  kind: 'routine'
  id: string
  programId: RoutineId
  programVersion: string
  scope: RoutineScope
  source: RoutineSessionSource
  mode: RoutineSessionMode
  /** Comparison rules used, and whether the reference track was available at all. */
  matcher: { version: string; available: boolean }
  startedAt: number
  endedAt?: number
  /** Wall-clock time spent actively following (pauses excluded). */
  activeMs: number
  outcome: RoutineSessionOutcome
  chapters: RoutineChapterResult[]
  /**
   * Scoring v2 technique evidence (optional; records saved before it have none). Kept apart from the similarity
   * data above: it says whether specific movement requirements were met, not how close the pose was to the video.
   */
  technique?: RoutineTechniqueRecord
  /**
   * Routine analyzer evidence (optional; added with the per-routine analyzers). Only checked to be an object here:
   * the report validates it in depth and ignores it when malformed, so the session itself is never rejected for it.
   */
  analysis?: RoutineAnalysisRecord
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isChapterResult(value: unknown): value is RoutineChapterResult {
  if (!isRecord(value)) return false
  const regionSums = value.regionSums
  const regionSamples = value.regionSamples
  const statusCounts = value.statusCounts
  return typeof value.chapterId === 'string'
    && isFiniteNumber(value.totalSeconds)
    && isFiniteNumber(value.coveredSeconds)
    && isFiniteNumber(value.samples)
    && isFiniteNumber(value.insufficientSamples)
    && isFiniteNumber(value.similaritySum)
    && isFiniteNumber(value.mirroredSamples)
    && isRecord(regionSums) && ['arms', 'torso', 'legs'].every((key) => isFiniteNumber(regionSums[key]))
    && isRecord(regionSamples) && ['arms', 'torso', 'legs'].every((key) => isFiniteNumber(regionSamples[key]))
    && isRecord(statusCounts) && ['in_sync', 'ahead', 'behind', 'mismatch'].every((key) => isFiniteNumber(statusCounts[key]))
}

function isScope(value: unknown): value is RoutineScope {
  if (!isRecord(value)) return false
  return value.kind === 'full' || (value.kind === 'form' && typeof value.chapterId === 'string')
}

export function isRoutineSessionRecord(value: unknown): value is RoutineSessionRecord {
  if (!isRecord(value)) return false
  return value.schemaVersion === ROUTINE_SESSION_SCHEMA_VERSION
    && value.kind === 'routine'
    && typeof value.id === 'string'
    && typeof value.programId === 'string'
    && typeof value.programVersion === 'string'
    && isScope(value.scope)
    && (value.source === 'live' || value.source === 'synthetic')
    && (value.mode === 'normal' || value.mode === 'fast')
    && isRecord(value.matcher) && typeof value.matcher.version === 'string' && typeof value.matcher.available === 'boolean'
    && isFiniteNumber(value.startedAt)
    && (value.endedAt === undefined || isFiniteNumber(value.endedAt))
    && isFiniteNumber(value.activeMs)
    && (value.outcome === 'in_progress' || value.outcome === 'completed' || value.outcome === 'incomplete')
    && Array.isArray(value.chapters) && value.chapters.every(isChapterResult)
    && (value.technique === undefined || isRoutineTechniqueRecord(value.technique))
    && (value.analysis === undefined || isRecord(value.analysis))
}

export function createRoutineSessionId(now: number): string {
  return `routine-${now}-${Math.random().toString(36).slice(2, 10)}`
}
