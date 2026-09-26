import { CustomActionValidationError, normalizeCustomAction } from './definition'
import {
  CUSTOM_ACTION_SCHEMA_VERSION, CUSTOM_ACTION_STORAGE_KEY, MAX_CUSTOM_ACTIONS, type CustomActionDefinition, type CustomActionLoadResult,
} from './types'

export interface CustomActionRepository {
  load(): CustomActionLoadResult
  get(id: string): CustomActionDefinition | undefined
  /** False when storage is unavailable, full, or holds data from a newer version (never overwritten). */
  save(action: CustomActionDefinition): boolean
  remove(id: string): boolean
}

interface StoredPayload {
  schemaVersion: number
  actions: unknown[]
}

/** Parses the stored library. Invalid entries are skipped, never "repaired" into something the user did not make. */
export function parseStoredActions(raw: unknown): CustomActionLoadResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { actions: [], readOnly: false, skipped: 0 }
  const payload = raw as Partial<StoredPayload>
  if (typeof payload.schemaVersion === 'number' && payload.schemaVersion > CUSTOM_ACTION_SCHEMA_VERSION) {
    return { actions: [], readOnly: true, skipped: Array.isArray(payload.actions) ? payload.actions.length : 0 }
  }
  if (payload.schemaVersion !== CUSTOM_ACTION_SCHEMA_VERSION || !Array.isArray(payload.actions)) return { actions: [], readOnly: false, skipped: 0 }
  const actions: CustomActionDefinition[] = []
  let skipped = 0
  const seen = new Set<string>()
  for (const item of payload.actions) {
    try {
      const action = normalizeCustomAction(item)
      if (seen.has(action.id)) { skipped += 1; continue }
      seen.add(action.id)
      actions.push(action)
    } catch (error) {
      if (!(error instanceof CustomActionValidationError)) throw error
      skipped += 1
    }
  }
  return { actions, readOnly: false, skipped }
}

/** Most recently changed first. */
export function sortActions(actions: readonly CustomActionDefinition[]): CustomActionDefinition[] {
  return [...actions].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || (left.id < right.id ? -1 : 1))
}

function upsert(actions: readonly CustomActionDefinition[], action: CustomActionDefinition): CustomActionDefinition[] | undefined {
  const next = actions.filter((item) => item.id !== action.id)
  if (next.length >= MAX_CUSTOM_ACTIONS) return undefined
  return sortActions([action, ...next])
}

export class LocalStorageCustomActionRepository implements CustomActionRepository {
  constructor(private readonly key = CUSTOM_ACTION_STORAGE_KEY) {}

  private storage(): Storage | undefined {
    try {
      return typeof localStorage === 'undefined' ? undefined : localStorage
    } catch {
      return undefined
    }
  }

  load(): CustomActionLoadResult {
    const storage = this.storage()
    if (!storage) return { actions: [], readOnly: false, skipped: 0 }
    try {
      const raw = storage.getItem(this.key)
      const result = raw ? parseStoredActions(JSON.parse(raw) as unknown) : { actions: [], readOnly: false, skipped: 0 }
      return { ...result, actions: sortActions(result.actions) }
    } catch {
      // Unreadable JSON is kept as it is (read only) rather than replaced by an empty library on the next save.
      return { actions: [], readOnly: true, skipped: 0 }
    }
  }

  get(id: string): CustomActionDefinition | undefined {
    return this.load().actions.find((item) => item.id === id)
  }

  save(action: CustomActionDefinition): boolean {
    const storage = this.storage()
    if (!storage) return false
    const current = this.load()
    if (current.readOnly) return false
    try {
      const next = upsert(current.actions, normalizeCustomAction(action))
      if (!next) return false
      storage.setItem(this.key, JSON.stringify({ schemaVersion: CUSTOM_ACTION_SCHEMA_VERSION, actions: next }))
      return true
    } catch {
      return false
    }
  }

  remove(id: string): boolean {
    const storage = this.storage()
    if (!storage) return false
    const current = this.load()
    if (current.readOnly) return false
    try {
      storage.setItem(this.key, JSON.stringify({ schemaVersion: CUSTOM_ACTION_SCHEMA_VERSION, actions: current.actions.filter((item) => item.id !== id) }))
      return true
    } catch {
      return false
    }
  }
}

export class MemoryCustomActionRepository implements CustomActionRepository {
  private actions: CustomActionDefinition[]

  constructor(actions: CustomActionDefinition[] = [], private readonly readOnly = false) {
    this.actions = sortActions(actions.map((item) => structuredClone(item)))
  }

  load(): CustomActionLoadResult {
    return { actions: this.actions.map((item) => structuredClone(item)), readOnly: this.readOnly, skipped: 0 }
  }

  get(id: string): CustomActionDefinition | undefined {
    const found = this.actions.find((item) => item.id === id)
    return found ? structuredClone(found) : undefined
  }

  save(action: CustomActionDefinition): boolean {
    if (this.readOnly) return false
    const next = upsert(this.actions, normalizeCustomAction(action))
    if (!next) return false
    this.actions = next
    return true
  }

  remove(id: string): boolean {
    if (this.readOnly) return false
    this.actions = this.actions.filter((item) => item.id !== id)
    return true
  }
}
