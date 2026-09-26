import { GOAL_LIMITS } from './catalog'
import { CustomActionValidationError, DESCRIPTION_MAX, NAME_MAX, POSE_DESCRIPTION_MAX, createActionId, defaultRequirements, normalizeCustomAction } from './definition'
import { templateProgressThresholds } from './recognition/templates'
import {
  CUSTOM_ACTION_EXPORT_FORMAT, CUSTOM_ACTION_SCHEMA_VERSION, LEGACY_ACTION_LIBRARY_KEY, MAX_CUSTOM_ACTIONS, type CustomActionBodyArea,
  type CustomActionDefinition, type FeatureTemplateId, type RecognitionProfile,
} from './types'

/** JSON import / export of custom actions, and the one-way import of the teammate workbench's library. */

export interface CustomActionExport {
  format: typeof CUSTOM_ACTION_EXPORT_FORMAT
  schemaVersion: typeof CUSTOM_ACTION_SCHEMA_VERSION
  exportedAt: string
  actions: CustomActionDefinition[]
}

export function buildExport(actions: readonly CustomActionDefinition[], now = new Date()): CustomActionExport {
  return { format: CUSTOM_ACTION_EXPORT_FORMAT, schemaVersion: CUSTOM_ACTION_SCHEMA_VERSION, exportedAt: now.toISOString(), actions: actions.map((item) => structuredClone(item)) }
}

/** `action`: one action's file, named after it; otherwise the whole library. */
export function exportFileName(action?: CustomActionDefinition, now = new Date()): string {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  if (!action) return `formpilot-我的动作-${stamp}.json`
  const name = action.name.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 20) || '未命名'
  return `formpilot-动作-${name}-${stamp}.json`
}

export class CustomActionImportError extends Error {}

export interface ImportPlan {
  actions: CustomActionDefinition[]
  /** Came with an id that already exists: imported as a copy with a new id. */
  copies: number
  /** Invalid, unsupported or already imported entries left out. */
  skipped: number
  /** Did not fit under the library limit. */
  overLimit: number
  format: 'formpilot' | 'legacy-library'
}

// ---- the teammate workbench's library (ai-coach.action-library:v1) ------------------------------------------------------

const LEGACY_PROFILES = new Set<RecognitionProfile>(['upper-body', 'hip-lateral', 'hip-rotation', 'lower-body', 'full-body', 'mixed'])
const LEGACY_TEMPLATES = new Set<FeatureTemplateId>([
  'generic', 'arm-raise', 'arm-circle', 'punch-horizontal', 'squat-depth', 'lunge-single-leg', 'toe-raise', 'seated-leg-raise',
  'core-flexion', 'plank-shoulder-tap', 'mountain-climber', 'stretch-hold',
])
const PROFILE_AREA: Readonly<Record<RecognitionProfile, CustomActionBodyArea>> = {
  'upper-body': 'upper',
  'hip-lateral': 'lower',
  'hip-rotation': 'core',
  'lower-body': 'lower',
  'full-body': 'full',
  mixed: 'full',
}

interface LegacyItem {
  id?: unknown
  kind?: unknown
  sandboxProfile?: unknown
  sandboxFeatureProfile?: unknown
  displayName?: unknown
  subtitle?: unknown
  teachingGoal?: unknown
  teachingSteps?: unknown
}

function shortText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/**
 * One workbench entry → one custom action, or null when it has no recognition rule to carry over (built-in exercises
 * and tutorial-only entries). The explicit profile is required: nothing is guessed from a name or a file path.
 */
export function convertLegacyItem(item: LegacyItem, now = new Date(), id = createActionId(now.getTime())): CustomActionDefinition | null {
  if (item.kind !== 'imported' || typeof item.id !== 'string') return null
  if (!LEGACY_PROFILES.has(item.sandboxProfile as RecognitionProfile)) return null
  const profile = item.sandboxProfile as RecognitionProfile
  const source = LEGACY_TEMPLATES.has(item.sandboxFeatureProfile as FeatureTemplateId) ? item.sandboxFeatureProfile as FeatureTemplateId : 'generic'
  const name = shortText(item.displayName, NAME_MAX)
  if (!name) return null
  const area = PROFILE_AREA[profile]
  const steps = Array.isArray(item.teachingSteps) ? item.teachingSteps : []
  const iso = now.toISOString()
  return normalizeCustomAction({
    schemaVersion: CUSTOM_ACTION_SCHEMA_VERSION,
    id,
    name,
    description: shortText(item.subtitle, DESCRIPTION_MAX) || shortText(item.teachingGoal, DESCRIPTION_MAX),
    bodyArea: area,
    goal: { type: 'reps', target: GOAL_LIMITS.reps.defaultValue },
    startPose: { description: shortText(steps[0], POSE_DESCRIPTION_MAX) },
    finishPose: { description: shortText(steps[1], POSE_DESCRIPTION_MAX) },
    requirements: defaultRequirements(area),
    recognition: { source, profile, thresholds: templateProgressThresholds(source, profile), minRepMs: 400, holdSeconds: 2 },
    test: { status: 'not-tested' },
    source: { kind: 'legacy-library', legacyId: item.id.slice(0, 240), importedAt: iso },
    createdAt: iso,
    updatedAt: iso,
  })
}

function legacyItems(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) return parsed.every((item) => item && typeof item === 'object' && 'displayName' in item && 'kind' in item) ? parsed : undefined
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)) {
    const version = (parsed as { schemaVersion?: unknown }).schemaVersion
    if (version !== 1) throw new CustomActionImportError('这个动作库文件的版本暂不支持导入。')
    return (parsed as { items: unknown[] }).items
  }
  return undefined
}

/** Entries of the teammate's library that can become custom actions, read from localStorage without modifying it. */
export function readLegacyLibrary(storage: Pick<Storage, 'getItem'> | undefined): { candidates: LegacyItem[]; total: number } {
  try {
    const raw = storage?.getItem(LEGACY_ACTION_LIBRARY_KEY)
    if (!raw) return { candidates: [], total: 0 }
    const items = legacyItems(JSON.parse(raw) as unknown) ?? []
    const candidates = items.filter((item): item is LegacyItem => Boolean(item) && typeof item === 'object' && convertLegacyItem(item as LegacyItem) !== null)
    return { candidates, total: items.length }
  } catch {
    return { candidates: [], total: 0 }
  }
}

// ---- import planning ----------------------------------------------------------------------------------------------------

function uniqueId(taken: Set<string>, now: number): string {
  let attempt = 0
  let id = createActionId(now)
  while (taken.has(id)) id = createActionId(now + (attempt += 1))
  return id
}

/**
 * Works out what an import would add, without saving anything. Existing actions are never overwritten: an id that is
 * already taken becomes a copy, and a workbench entry imported before is skipped.
 */
export function planImport(text: string, existing: readonly CustomActionDefinition[], now = new Date()): ImportPlan {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new CustomActionImportError('文件不是有效的动作文件（JSON 格式不正确）。')
  }
  const taken = new Set(existing.map((item) => item.id))
  const importedLegacy = new Set(existing.map((item) => item.source.legacyId).filter((id): id is string => Boolean(id)))
  let room = Math.max(0, MAX_CUSTOM_ACTIONS - existing.length)
  const plan: ImportPlan = { actions: [], copies: 0, skipped: 0, overLimit: 0, format: 'formpilot' }
  const accept = (action: CustomActionDefinition) => {
    if (room <= 0) { plan.overLimit += 1; return }
    room -= 1
    taken.add(action.id)
    plan.actions.push(action)
  }

  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  if (record?.format === CUSTOM_ACTION_EXPORT_FORMAT || (record?.schemaVersion !== undefined && 'recognition' in record)) {
    const version = record.schemaVersion
    if (typeof version === 'number' && version > CUSTOM_ACTION_SCHEMA_VERSION) throw new CustomActionImportError('这个文件来自更新版本的 FormPilot，暂时无法导入。')
    const entries = record.format === CUSTOM_ACTION_EXPORT_FORMAT ? (Array.isArray(record.actions) ? record.actions : []) : [record]
    for (const entry of entries) {
      try {
        const action = normalizeCustomAction(entry)
        const importedAt = now.toISOString()
        const copy = taken.has(action.id)
        if (copy) plan.copies += 1
        accept({ ...action, id: copy ? uniqueId(taken, now.getTime()) : action.id, source: { ...action.source, kind: action.source.kind === 'legacy-library' ? 'legacy-library' : 'imported-file', importedAt } })
      } catch (error) {
        if (!(error instanceof CustomActionValidationError)) throw error
        plan.skipped += 1
      }
    }
    if (!plan.actions.length && !plan.overLimit) throw new CustomActionImportError('文件里没有可以导入的动作。')
    return plan
  }

  const items = legacyItems(parsed)
  if (!items) throw new CustomActionImportError('无法识别这个文件，请选择 FormPilot 导出的动作文件。')
  plan.format = 'legacy-library'
  let alreadyImported = 0
  for (const item of items) {
    const legacy = item as LegacyItem
    if (typeof legacy?.id === 'string' && importedLegacy.has(legacy.id)) { plan.skipped += 1; alreadyImported += 1; continue }
    const action = item && typeof item === 'object' ? convertLegacyItem(legacy, now, uniqueId(taken, now.getTime())) : null
    if (!action) { plan.skipped += 1; continue }
    accept(action)
  }
  if (!plan.actions.length && !plan.overLimit) {
    throw new CustomActionImportError(alreadyImported ? '这些动作已经导入过了。' : '这个动作库里没有带识别规则、可以导入的动作。')
  }
  return plan
}

export function importSummary(plan: ImportPlan): string {
  const parts = [`已导入 ${plan.actions.length} 个动作`]
  if (plan.copies) parts.push(`${plan.copies} 个与现有动作同名编号，已作为副本导入`)
  if (plan.skipped) parts.push(`${plan.skipped} 个无法使用或已导入过，已跳过`)
  if (plan.overLimit) parts.push(`${plan.overLimit} 个超出 ${MAX_CUSTOM_ACTIONS} 个动作的上限，未导入`)
  return `${parts.join('，')}。`
}
