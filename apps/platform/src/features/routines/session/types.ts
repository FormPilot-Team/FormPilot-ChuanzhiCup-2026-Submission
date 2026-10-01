import { isRoutineTechniqueRecord, type RoutineTechniqueRecord } from '../../scoring/routine/techniqueRecord'
import type { RoutineAnalysisRecord } from '../analyzers/analysisRecord'
import type { FollowAlongRegion } from '../followAlong/matcher'
import type { RoutineId, RoutineScope } from '../types'

// 跟练会话记录，与智能训练的 TrainingSessionState 分开：跟练按章节衡量跟随标准视频的程度
export const ROUTINE_SESSION_SCHEMA_VERSION = 1

export type RoutineSessionSource = 'live' | 'synthetic'
export type RoutineSessionMode = 'normal' | 'fast'
export type RoutineSessionOutcome = 'in_progress' | 'completed' | 'incomplete'
export type FollowAlongCountedStatus = 'in_sync' | 'ahead' | 'behind' | 'mismatch'

export interface RoutineChapterResult {
  chapterId: string
  /** 章节整秒数，完成度的分母 */
  totalSeconds: number
  coveredSeconds: number
  samples: number
  /** 姿态不可靠而跳过的比对 */
  insufficientSamples: number
  /** 平滑后相似度（0..1）之和 */
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
  matcher: { version: string; available: boolean }
  startedAt: number
  endedAt?: number
  /** 实际跟练时长（不含暂停） */
  activeMs: number
  outcome: RoutineSessionOutcome
  chapters: RoutineChapterResult[]
  /** 动作规范证据（可选，旧记录没有） */
  technique?: RoutineTechniqueRecord
  /** 分析器结果（可选）；这里只检查是对象，深层校验在报告中，异常时忽略而不拒绝整条记录 */
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
