import { describe, expect, it } from 'vitest'
import { buildRecentReports } from '../src/features/coachContext/recentReports'
import { buildTrainingHistoryItems } from '../src/features/history/TrainingHistory'
import { buildRoutineHistoryItems, isPrimaryRoutineRecord, loadRoutineHistory, mergeHistoryEntries } from '../src/features/history/routineHistory'
import { buildRoutineReport, compareWithPrevious, ROUTINE_REPORT_CONFIG, similarityBand } from '../src/features/routines/report/routineReport'
import { getRoutineProgram } from '../src/features/routines/programs'
import { FIRST_SESSION, at } from './analysis-fixtures'
import { routineRecord } from './helpers/routineFixtures'

describe('routine report', () => {
  it('summarises a complete run by coverage, similarity, rhythm and body region', () => {
    const report = buildRoutineReport(routineRecord())
    expect(report).toBeDefined()
    expect(report?.complete).toBe(true)
    expect(report?.coverage).toBe(1)
    expect(report?.similarity).toBe(80)
    expect(report?.band).toBe('high')
    expect(report?.syncShare).toBe(80)
    expect(report?.tempo).toBeNull()
    expect(report?.regions).toEqual({ arms: 80, torso: 85, legs: 75 })
    expect(report?.chapters).toHaveLength(10)
    expect(report?.headline).toBe('完整跟练 · 跟练相似度 80%（高度一致）')
    expect(report?.notes.at(-1)).toContain('只反映二维姿态')
  })

  it('points to the weakest chapter and body region, and the rhythm tendency', () => {
    const report = buildRoutineReport(routineRecord({
      chapters: {
        'bdj-2': { similarity: 0.55 },
        'bdj-5': { similarity: 0.62, statusCounts: { in_sync: 400, ahead: 0, behind: 600, mismatch: 0 } },
      },
    }))
    expect(report?.weakestChapter?.chapter.id).toBe('bdj-2')
    expect(report?.weakestChapter?.band).toBe('low')
    expect(report?.strongestChapter?.similarity).toBe(80)
    expect(report?.weakestRegion).toBe('legs')
    expect(report?.focus[0]).toBe('重点复习「第二式 · 左右开弓似射雕」：跟练相似度 55%，低于本次平均，可以在「八段锦」页单独练习这一式。')
    expect(report?.chapters.find((item) => item.chapter.id === 'bdj-5')?.tempo).toBe('behind')
    expect(report?.focus.length).toBeLessThanOrEqual(3)
  })

  it('reports partial coverage honestly and ignores chapters without enough evidence', () => {
    const report = buildRoutineReport(routineRecord({
      outcome: 'incomplete',
      chapters: {
        'bdj-7': { coveredSeconds: 20, samples: 5, similaritySum: 5 * 0.1 },
        'bdj-8': { coveredSeconds: 0, samples: 0, similaritySum: 0 },
        'bdj-close': { coveredSeconds: 0, samples: 0, similaritySum: 0 },
      },
    }))
    expect(report?.complete).toBe(false)
    expect(report?.coverage).toBeGreaterThan(0.8)
    expect(report?.coverage).toBeLessThan(0.9)
    expect(report?.chapters.find((item) => item.chapter.id === 'bdj-7')).toMatchObject({ enoughData: false, similarity: null, covered: false })
    // The 0.1 similarity of the thin chapter does not pull the average down.
    expect(report?.similarity).toBe(80)
    expect(report?.notes.some((note) => note.includes('1 段识别数据不足'))).toBe(true)
    expect(report?.headline).toMatch(/^跟练完成 8\d% · /)
    expect(report?.focus).toContain('有部分段落没有完整跟练，下次尽量从头到尾连续完成。')
  })

  it('notes mirrored following, test records and a missing reference track', () => {
    const mirrored = buildRoutineReport(routineRecord({ chapters: Object.fromEntries(getRoutineProgram('baduanjin').chapters.map((chapter) => [chapter.id, { mirroredSamples: 100_000 }])) }))
    expect(mirrored?.notes.some((note) => note.includes('镜像方式跟练'))).toBe(true)
    const synthetic = buildRoutineReport(routineRecord({ source: 'synthetic' }))
    expect(synthetic?.notes).toContain('这条记录来自测试模式，不参与历史对比。')
    const noTrack = routineRecord({ matcherAvailable: false })
    noTrack.chapters = noTrack.chapters.map((item) => ({ ...item, samples: 0, similaritySum: 0 }))
    const blind = buildRoutineReport(noTrack)
    expect(blind?.similarity).toBeNull()
    expect(blind?.headline).toBe('完整跟练 · 暂无跟练相似度')
    expect(blind?.notes[0]).toContain('没有加载到标准动作姿态数据')
    expect(buildRoutineReport({ ...routineRecord(), programId: 'unknown' as 'baduanjin' })).toBeUndefined()
  })

  it('compares only with an earlier reliable run of the same routine version and scope', () => {
    const program = getRoutineProgram('baduanjin')
    const previous = routineRecord({ id: 'p', startedAt: at(1), chapters: { 'bdj-1': { similarity: 0.6 } } })
    const current = routineRecord({ id: 'c', startedAt: at(2) })
    const comparison = compareWithPrevious(current, program, [previous, current])
    expect(comparison).toMatchObject({ available: true, previousId: 'p', similarityTrend: 'up' })
    expect(comparison.similarityDelta).toBeGreaterThanOrEqual(ROUTINE_REPORT_CONFIG.similarityDeadband)
    const same = compareWithPrevious(routineRecord({ id: 'c2', startedAt: at(3) }), program, [current])
    expect(same).toMatchObject({ available: true, previousId: 'c', similarityDelta: 0, similarityTrend: 'flat', syncTrend: 'flat' })
    expect(compareWithPrevious(current, program, [current]).reason).toBe('这是同一练习范围内第一条可对比的记录。')
    const otherScope = routineRecord({ id: 'o', startedAt: at(1), scope: { kind: 'form', chapterId: 'bdj-1' } })
    const otherVersion = { ...routineRecord({ id: 'v', startedAt: at(1) }), programVersion: '0.9.0' }
    const fast = routineRecord({ id: 'f', startedAt: at(1), mode: 'fast' })
    const unfinished = routineRecord({ id: 'u', startedAt: at(1), outcome: 'in_progress' })
    const later = routineRecord({ id: 'l', startedAt: at(5) })
    expect(compareWithPrevious(current, program, [otherScope, otherVersion, fast, unfinished, later]).available).toBe(false)
    expect(compareWithPrevious(routineRecord({ id: 't', startedAt: at(2), source: 'synthetic' }), program, [previous]).available).toBe(false)
    const short = routineRecord({ id: 's', startedAt: at(2), chapters: Object.fromEntries(program.chapters.slice(2).map((chapter) => [chapter.id, { coveredSeconds: 0 }])) })
    expect(compareWithPrevious(short, program, [previous]).reason).toBe('本次跟练时长不足一半，暂不与历史对比。')
  })

  it('bands similarity at 80 and 60', () => {
    expect([95, 80, 79, 60, 59].map(similarityBand)).toEqual(['high', 'high', 'fair', 'fair', 'low'])
  })
})

describe('routine history', () => {
  it('lists only real sessions, newest first, with their reports', () => {
    const records = [
      routineRecord({ id: 'a', startedAt: at(1) }),
      routineRecord({ id: 'b', startedAt: at(3), outcome: 'incomplete' }),
      routineRecord({ id: 'c', startedAt: at(2), source: 'synthetic' }),
      routineRecord({ id: 'd', startedAt: at(4), mode: 'fast' }),
    ]
    expect(records.map(isPrimaryRoutineRecord)).toEqual([true, true, false, false])
    const items = buildRoutineHistoryItems(records)
    expect(items.map((item) => [item.record.id, item.incomplete])).toEqual([['b', true], ['a', false]])
    // An early-ended run that still covered the routine is compared with the earlier real one.
    expect(items[0].report.comparison).toMatchObject({ available: true, previousId: 'a' })
    expect(items[1].report.comparison.available).toBe(false)
    expect(loadRoutineHistory({ save: () => true, get: () => undefined, list: () => { throw new Error('boom') } })).toEqual({ status: 'error' })
  })

  it('merges Smart Training and routine history into one timeline and one recent-report list', () => {
    const smart = buildTrainingHistoryItems([{ ...FIRST_SESSION, startedAt: at(2) }])
    const routine = buildRoutineHistoryItems([routineRecord({ id: 'r-old', startedAt: at(1) }), routineRecord({ id: 'r-new', startedAt: at(3), programId: 'taijiquan' })])
    const merged = mergeHistoryEntries(smart, routine)
    expect(merged.map((entry) => [entry.kind, entry.id])).toEqual([['routine', 'r-new'], ['smart', FIRST_SESSION.id], ['routine', 'r-old']])
    const recent = buildRecentReports(smart, routine, 2)
    expect(recent).toHaveLength(2)
    expect(recent[0]).toMatchObject({ sessionId: 'r-new', modeId: 'taijiquan', modeTitle: '太极拳 · 整套跟练', reportPath: '/report/r-new', completed: true })
    expect(recent[0].headline).toContain('跟练相似度')
    expect(recent[1]).toMatchObject({ modeId: 'smart-training', modeTitle: '智能训练 · 完整训练' })
  })
})
