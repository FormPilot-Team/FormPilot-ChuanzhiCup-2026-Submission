import { isRoutineSessionRecord, type RoutineSessionRecord } from './types'

export const ROUTINE_SESSION_STORAGE_KEY = 'formpilot.routine-sessions:v1'
export const ROUTINE_SESSION_RETENTION = 30

export interface RoutineSessionRepository {
  save(record: RoutineSessionRecord): boolean
  get(id: string): RoutineSessionRecord | undefined
  list(): RoutineSessionRecord[]
}

export function parseStoredRoutineSessions(raw: unknown): RoutineSessionRecord[] {
  return Array.isArray(raw) ? raw.filter(isRoutineSessionRecord) : []
}

/** Keeps the newest `limit` records, dropping test (synthetic / fast) records before real ones. */
export function retainRoutineSessions(records: readonly RoutineSessionRecord[], limit = ROUTINE_SESSION_RETENTION): RoutineSessionRecord[] {
  if (records.length <= limit) return [...records]
  const lowPriority = (record: RoutineSessionRecord) => record.source !== 'live' || record.mode !== 'normal'
  const removals = new Set(records
    .map((record, index) => ({ record, index }))
    .sort((left, right) => Number(lowPriority(right.record)) - Number(lowPriority(left.record))
      || left.record.startedAt - right.record.startedAt
      || left.index - right.index)
    .slice(0, records.length - limit)
    .map((item) => item.index))
  return records.filter((_record, index) => !removals.has(index))
}

export class LocalStorageRoutineSessionRepository implements RoutineSessionRepository {
  save(record: RoutineSessionRecord): boolean {
    if (typeof localStorage === 'undefined') return false
    try {
      const records = this.list()
      const index = records.findIndex((item) => item.id === record.id)
      if (index >= 0) records[index] = structuredClone(record)
      else records.push(structuredClone(record))
      localStorage.setItem(ROUTINE_SESSION_STORAGE_KEY, JSON.stringify(retainRoutineSessions(records)))
      return true
    } catch {
      return false
    }
  }

  get(id: string): RoutineSessionRecord | undefined {
    return this.list().find((item) => item.id === id)
  }

  list(): RoutineSessionRecord[] {
    if (typeof localStorage === 'undefined') return []
    try {
      const raw = localStorage.getItem(ROUTINE_SESSION_STORAGE_KEY)
      return raw ? parseStoredRoutineSessions(JSON.parse(raw) as unknown) : []
    } catch {
      return []
    }
  }
}

export class MemoryRoutineSessionRepository implements RoutineSessionRepository {
  constructor(private records: RoutineSessionRecord[] = []) {}

  save(record: RoutineSessionRecord): boolean {
    const index = this.records.findIndex((item) => item.id === record.id)
    if (index >= 0) this.records[index] = structuredClone(record)
    else this.records.push(structuredClone(record))
    return true
  }

  get(id: string): RoutineSessionRecord | undefined {
    return this.records.find((item) => item.id === id)
  }

  list(): RoutineSessionRecord[] {
    return [...this.records]
  }
}
