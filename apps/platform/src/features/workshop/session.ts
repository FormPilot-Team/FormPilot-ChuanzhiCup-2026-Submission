import type { RecognizerMode, RepEvent } from './recognition/recognizer'
import type { CustomActionBodyArea, CustomActionDefinition, CustomActionGoal, CustomActionSourceKind, RequirementId } from './types'

// 自定义动作训练记录：与热身训练、跟练课程分开存储，只记录完成情况、次数和识别重点结果，
// 不给综合分、五维能力或跟练相似度
export const CUSTOM_SESSION_STORAGE_KEY = 'formpilot.custom-action-sessions:v1'
export const CUSTOM_SESSION_SCHEMA_VERSION = 1 as const
export const CUSTOM_SESSION_ID_PREFIX = 'custom-session-'
export const MAX_CUSTOM_SESSIONS = 40

export interface RequirementTally {
  id: RequirementId
  /** 能够判断的次数（或保持秒数） */
  checked: number
  passed: number
}

export interface CustomActionSessionRecord {
  schemaVersion: typeof CUSTOM_SESSION_SCHEMA_VERSION
  kind: 'custom-action'
  id: string
  actionId: string
  /** 训练时的动作名；动作之后可能改名或删除 */
  actionName: string
  actionSource: CustomActionSourceKind
  bodyArea: CustomActionBodyArea
  goal: CustomActionGoal
  recognitionMode: RecognizerMode
  source: 'live' | 'synthetic'
  mode: 'normal' | 'fast'
  startedAt: number
  endedAt?: number
  activeMs: number
  outcome: 'in_progress' | 'completed' | 'incomplete'
  /** 完成次数；保持目标时为判断过的保持秒数 */
  reps: number
  passedReps: number
  holdMs: number
  requirements: RequirementTally[]
  /** 训练中显示过的反馈，按代码计数 */
  feedbackCounts: Record<string, number>
}

export function createCustomSessionId(now = Date.now(), random = Math.random): string {
  return `${CUSTOM_SESSION_ID_PREFIX}${now}-${Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0')}`
}

export function isCustomSessionId(id: string): boolean {
  return id.startsWith(CUSTOM_SESSION_ID_PREFIX)
}

export function startCustomSession(action: CustomActionDefinition, options: { id: string; startedAt: number; recognitionMode: RecognizerMode; source: 'live' | 'synthetic'; mode: 'normal' | 'fast'; requirements: ReadonlyArray<RequirementId> }): CustomActionSessionRecord {
  return {
    schemaVersion: CUSTOM_SESSION_SCHEMA_VERSION,
    kind: 'custom-action',
    id: options.id,
    actionId: action.id,
    actionName: action.name,
    actionSource: action.source.kind,
    bodyArea: action.bodyArea,
    goal: structuredClone(action.goal),
    recognitionMode: options.recognitionMode,
    source: options.source,
    mode: options.mode,
    startedAt: options.startedAt,
    activeMs: 0,
    outcome: 'in_progress',
    reps: 0,
    passedReps: 0,
    holdMs: 0,
    requirements: options.requirements.map((id) => ({ id, checked: 0, passed: 0 })),
    feedbackCounts: {},
  }
}

export function recordRep(record: CustomActionSessionRecord, event: RepEvent): void {
  record.reps = Math.max(record.reps, event.index)
  if (event.passed) record.passedReps += 1
  for (const result of event.requirements) {
    const tally = record.requirements.find((item) => item.id === result.id)
    if (!tally || result.passed === null) continue
    tally.checked += 1
    if (result.passed) tally.passed += 1
  }
}

export function recordFeedback(record: CustomActionSessionRecord, code: string): void {
  record.feedbackCounts[code] = (record.feedbackCounts[code] ?? 0) + 1
}

export function goalProgress(record: Pick<CustomActionSessionRecord, 'goal' | 'reps' | 'holdMs'>): { done: number; target: number; unit: '次' | '秒' } {
  return record.goal.type === 'reps'
    ? { done: record.reps, target: record.goal.target, unit: '次' }
    : { done: Math.floor(record.holdMs / 1000), target: record.goal.seconds, unit: '秒' }
}

export interface CustomSessionRepository {
  save(record: CustomActionSessionRecord): boolean
  get(id: string): CustomActionSessionRecord | undefined
  list(): CustomActionSessionRecord[]
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 结构校验；不符合的记录直接忽略，不做猜测 */
export function isCustomSessionRecord(value: unknown): value is CustomActionSessionRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<CustomActionSessionRecord>
  return record.schemaVersion === CUSTOM_SESSION_SCHEMA_VERSION
    && record.kind === 'custom-action'
    && typeof record.id === 'string' && isCustomSessionId(record.id)
    && typeof record.actionId === 'string'
    && typeof record.actionName === 'string'
    && Boolean(record.goal && (record.goal.type === 'reps' || record.goal.type === 'duration'))
    && isFiniteNumber(record.startedAt)
    && isFiniteNumber(record.activeMs)
    && isFiniteNumber(record.reps)
    && isFiniteNumber(record.passedReps)
    && isFiniteNumber(record.holdMs)
    && (record.outcome === 'in_progress' || record.outcome === 'completed' || record.outcome === 'incomplete')
    && Array.isArray(record.requirements)
    && Boolean(record.feedbackCounts && typeof record.feedbackCounts === 'object')
}

export function parseStoredCustomSessions(raw: unknown): CustomActionSessionRecord[] {
  return Array.isArray(raw) ? raw.filter(isCustomSessionRecord) : []
}

/** 保留最新的记录；存在更新记录时，丢弃没有任何动作的进行中记录 */
export function retainCustomSessions(records: readonly CustomActionSessionRecord[]): CustomActionSessionRecord[] {
  const sorted = [...records].sort((left, right) => right.startedAt - left.startedAt)
  return sorted.filter((item, index) => !(index > 0 && item.outcome === 'in_progress' && item.reps === 0 && item.holdMs === 0)).slice(0, MAX_CUSTOM_SESSIONS)
}

export class LocalStorageCustomSessionRepository implements CustomSessionRepository {
  save(record: CustomActionSessionRecord): boolean {
    if (typeof localStorage === 'undefined') return false
    try {
      const records = this.list()
      const index = records.findIndex((item) => item.id === record.id)
      if (index >= 0) records[index] = structuredClone(record)
      else records.push(structuredClone(record))
      localStorage.setItem(CUSTOM_SESSION_STORAGE_KEY, JSON.stringify(retainCustomSessions(records)))
      return true
    } catch {
      return false
    }
  }

  get(id: string): CustomActionSessionRecord | undefined {
    return this.list().find((item) => item.id === id)
  }

  list(): CustomActionSessionRecord[] {
    if (typeof localStorage === 'undefined') return []
    try {
      const raw = localStorage.getItem(CUSTOM_SESSION_STORAGE_KEY)
      return raw ? parseStoredCustomSessions(JSON.parse(raw) as unknown) : []
    } catch {
      return []
    }
  }
}

export class MemoryCustomSessionRepository implements CustomSessionRepository {
  constructor(private records: CustomActionSessionRecord[] = []) {}

  save(record: CustomActionSessionRecord): boolean {
    const index = this.records.findIndex((item) => item.id === record.id)
    if (index >= 0) this.records[index] = structuredClone(record)
    else this.records.push(structuredClone(record))
    return true
  }

  get(id: string): CustomActionSessionRecord | undefined {
    return this.records.find((item) => item.id === id)
  }

  list(): CustomActionSessionRecord[] {
    return [...this.records]
  }
}
