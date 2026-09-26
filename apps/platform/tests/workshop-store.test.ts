import { describe, expect, it } from 'vitest'
import { createDraftAction, normalizeCustomAction } from '../src/features/workshop/definition'
import { standingPose } from '../src/features/workshop/fixture'
import { templateProgressThresholds } from '../src/features/workshop/recognition/templates'
import { LocalStorageCustomActionRepository, MemoryCustomActionRepository, parseStoredActions } from '../src/features/workshop/store'
import { buildExport, convertLegacyItem, importSummary, planImport, readLegacyLibrary, CustomActionImportError } from '../src/features/workshop/transfer'
import { CUSTOM_ACTION_STORAGE_KEY, LEGACY_ACTION_LIBRARY_KEY, MAX_CUSTOM_ACTIONS, type CapturedPose, type CustomActionDefinition } from '../src/features/workshop/types'

const NOW = new Date('2026-09-27T08:00:00.000Z')

function capture(degrees: number): CapturedPose {
  return { landmarks: standingPose(degrees).map(({ x, y, z, visibility }) => ({ x, y, z, visibility })), aspect: 16 / 9, frames: 12, capturedAt: NOW.toISOString() }
}

function action(id: string, name = '侧平举练习', updatedAt = NOW.toISOString()): CustomActionDefinition {
  return {
    ...createDraftAction(NOW, id),
    name,
    startPose: { description: '双臂下垂', capture: capture(8) },
    finishPose: { description: '双臂抬到肩高', capture: capture(90) },
    updatedAt,
  }
}

class FakeStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function withStorage<T>(storage: FakeStorage, run: () => T): T {
  const previous = (globalThis as { localStorage?: unknown }).localStorage
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  try {
    return run()
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true })
  }
}

/** A workbench library as `ai-coach.action-library:v1` stores it (trimmed to the fields that matter). */
const LEGACY_LIBRARY = {
  schemaVersion: 1,
  items: [
    { id: 'overhead_raise', kind: 'registered', exerciseId: 'overhead_raise', runtimeStatus: 'registered', displayName: '双臂上举', subtitle: '', teachingGoal: '', teachingSteps: [], cautions: [] },
    { id: 'ref-arm-raise', kind: 'imported', runtimeStatus: 'sandbox-only', sandboxProfile: 'upper-body', sandboxProfileSource: 'human-selected', sandboxFeatureProfile: 'arm-raise', displayName: '直臂上举', subtitle: '参考视频 · 手臂', teachingGoal: '双臂伸直上举', teachingSteps: ['双臂自然下垂', '双臂举过头顶'], cautions: [] },
    { id: 'tutorial-only', kind: 'imported', runtimeStatus: 'semantic-only', displayName: '只有教程', subtitle: '', teachingGoal: '', teachingSteps: [], cautions: [] },
    { id: 'ref-squat', kind: 'imported', runtimeStatus: 'sandbox-only', sandboxProfile: 'lower-body', sandboxProfileSource: 'template', displayName: '下蹲候选', subtitle: '', teachingGoal: '下蹲', teachingSteps: [], cautions: [] },
  ],
}

describe('custom action storage', () => {
  it('saves, lists newest first, edits in place and removes', () => {
    const storage = new FakeStorage()
    withStorage(storage, () => {
      const repository = new LocalStorageCustomActionRepository()
      expect(repository.save(action('custom-a', '动作一', '2026-09-27T08:00:00.000Z'))).toBe(true)
      expect(repository.save(action('custom-b', '动作二', '2026-09-27T09:00:00.000Z'))).toBe(true)
      expect(repository.load().actions.map((item) => item.id)).toEqual(['custom-b', 'custom-a'])
      expect(repository.save({ ...action('custom-a', '动作一改名'), updatedAt: '2026-09-27T10:00:00.000Z' })).toBe(true)
      expect(repository.load().actions.map((item) => [item.id, item.name])).toEqual([['custom-a', '动作一改名'], ['custom-b', '动作二']])
      expect(repository.remove('custom-b')).toBe(true)
      expect(repository.load().actions.map((item) => item.id)).toEqual(['custom-a'])
      expect(JSON.parse(storage.getItem(CUSTOM_ACTION_STORAGE_KEY)!)).toMatchObject({ schemaVersion: 1 })
    })
  })

  it('keeps its own namespace and never writes the warm-up, follow-along or workbench keys', () => {
    const storage = new FakeStorage()
    storage.setItem('ai-coach.sessions:v2', '[]')
    storage.setItem('formpilot.routine-sessions:v1', '[]')
    storage.setItem(LEGACY_ACTION_LIBRARY_KEY, JSON.stringify(LEGACY_LIBRARY))
    withStorage(storage, () => new LocalStorageCustomActionRepository().save(action('custom-a')))
    expect(storage.getItem('ai-coach.sessions:v2')).toBe('[]')
    expect(storage.getItem('formpilot.routine-sessions:v1')).toBe('[]')
    expect(storage.getItem(LEGACY_ACTION_LIBRARY_KEY)).toBe(JSON.stringify(LEGACY_LIBRARY))
    expect(CUSTOM_ACTION_STORAGE_KEY).toBe('formpilot.custom-actions:v1')
  })

  it('shows data from a newer version read-only and never overwrites it', () => {
    const storage = new FakeStorage()
    const newer = JSON.stringify({ schemaVersion: 2, actions: [{ anything: true }] })
    storage.setItem(CUSTOM_ACTION_STORAGE_KEY, newer)
    withStorage(storage, () => {
      const repository = new LocalStorageCustomActionRepository()
      expect(repository.load()).toMatchObject({ readOnly: true, actions: [] })
      expect(repository.save(action('custom-a'))).toBe(false)
      expect(repository.remove('custom-a')).toBe(false)
    })
    expect(storage.getItem(CUSTOM_ACTION_STORAGE_KEY)).toBe(newer)
    storage.setItem(CUSTOM_ACTION_STORAGE_KEY, '{broken')
    withStorage(storage, () => expect(new LocalStorageCustomActionRepository().save(action('custom-a'))).toBe(false))
    expect(storage.getItem(CUSTOM_ACTION_STORAGE_KEY)).toBe('{broken')
  })

  it('skips invalid or duplicate entries instead of dropping the whole library', () => {
    const good = action('custom-good')
    const result = parseStoredActions({ schemaVersion: 1, actions: [good, { ...good }, { ...good, id: 'bad id!' }, { ...good, id: 'custom-x', name: '' }] })
    expect(result.actions.map((item) => item.id)).toEqual(['custom-good'])
    expect(result.skipped).toBe(3)
  })

  it('enforces the library limit', () => {
    const repository = new MemoryCustomActionRepository(Array.from({ length: MAX_CUSTOM_ACTIONS }, (_, index) => action(`custom-${index}`)))
    expect(repository.save(action('custom-one-more'))).toBe(false)
    expect(repository.save({ ...action('custom-3'), name: '编辑已有的仍然可以' })).toBe(true)
  })

  it('validates in user language', () => {
    expect(() => normalizeCustomAction({ ...action('custom-a'), name: '一'.repeat(21) })).toThrow('动作名称最多 20 个字')
    expect(() => normalizeCustomAction({ ...action('custom-a'), goal: { type: 'reps', target: 0 } })).toThrow('目标次数超出范围')
    expect(() => normalizeCustomAction({ ...action('custom-a'), recognition: { ...action('custom-a').recognition, thresholds: { moving: 0.5, peak: 0.4, returnThreshold: 0.2 } } })).toThrow('阈值需要满足')
  })
})

describe('JSON export and import', () => {
  it('round-trips an export without touching existing actions', () => {
    const exported = JSON.stringify(buildExport([action('custom-a')], NOW))
    const plan = planImport(exported, [], NOW)
    expect(plan).toMatchObject({ format: 'formpilot', copies: 0, skipped: 0, overLimit: 0 })
    expect(plan.actions[0]).toMatchObject({ id: 'custom-a', name: '侧平举练习', source: { kind: 'imported-file' } })
    expect(plan.actions[0].finishPose.capture?.landmarks).toHaveLength(33)
  })

  it('imports an id that already exists as a copy instead of overwriting it', () => {
    const existing = [action('custom-a', '我原来的动作')]
    const plan = planImport(JSON.stringify(buildExport([action('custom-a', '文件里的动作')], NOW)), existing, NOW)
    expect(plan.copies).toBe(1)
    expect(plan.actions[0].id).not.toBe('custom-a')
    expect(plan.actions[0].name).toBe('文件里的动作')
    expect(importSummary(plan)).toBe('已导入 1 个动作，1 个与现有动作同名编号，已作为副本导入。')
  })

  it('rejects files it cannot use with a clear reason', () => {
    expect(() => planImport('not json', [], NOW)).toThrow(CustomActionImportError)
    expect(() => planImport(JSON.stringify({ format: 'formpilot-custom-actions', schemaVersion: 2, actions: [] }), [], NOW)).toThrow('更新版本')
    expect(() => planImport(JSON.stringify({ hello: 'world' }), [], NOW)).toThrow('无法识别')
    expect(() => planImport(JSON.stringify(buildExport([], NOW)), [], NOW)).toThrow('没有可以导入的动作')
  })
})

describe('the teammate workbench library (ai-coach.action-library:v1)', () => {
  it('converts only entries with an explicit recognition profile, keeping their template', () => {
    const converted = convertLegacyItem(LEGACY_LIBRARY.items[1], NOW, 'custom-legacy')
    expect(converted).toMatchObject({
      id: 'custom-legacy',
      name: '直臂上举',
      bodyArea: 'upper',
      startPose: { description: '双臂自然下垂' },
      finishPose: { description: '双臂举过头顶' },
      recognition: { source: 'arm-raise', profile: 'upper-body', thresholds: templateProgressThresholds('arm-raise', 'upper-body') },
      test: { status: 'not-tested' },
      source: { kind: 'legacy-library', legacyId: 'ref-arm-raise' },
    })
    expect(convertLegacyItem(LEGACY_LIBRARY.items[0], NOW)).toBeNull()
    expect(convertLegacyItem(LEGACY_LIBRARY.items[2], NOW)).toBeNull()
    expect(convertLegacyItem(LEGACY_LIBRARY.items[3], NOW)).toMatchObject({ bodyArea: 'lower', recognition: { source: 'generic', profile: 'lower-body' } })
  })

  it('reads the library without modifying it and skips entries already imported', () => {
    const storage = new FakeStorage()
    storage.setItem(LEGACY_ACTION_LIBRARY_KEY, JSON.stringify(LEGACY_LIBRARY))
    const { candidates, total } = readLegacyLibrary(storage)
    expect(total).toBe(4)
    expect(candidates.map((item) => item.id)).toEqual(['ref-arm-raise', 'ref-squat'])
    const first = planImport(JSON.stringify(LEGACY_LIBRARY), [], NOW)
    expect(first).toMatchObject({ format: 'legacy-library', skipped: 2 })
    expect(first.actions.map((item) => item.source.legacyId)).toEqual(['ref-arm-raise', 'ref-squat'])
    expect(() => planImport(JSON.stringify(LEGACY_LIBRARY), first.actions, NOW)).toThrow('这些动作已经导入过了。')
    expect(storage.getItem(LEGACY_ACTION_LIBRARY_KEY)).toBe(JSON.stringify(LEGACY_LIBRARY))
  })
})
