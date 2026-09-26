import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseRoutineRoute, routinePath, routineTrainingPath } from '../src/app/routes'
import { buildRoutineCoachContext } from '../src/features/coachContext/routineCoachContext'
import { buildTrainingHistoryItems, buildTrainingHistoryOverview } from '../src/features/history/TrainingHistory'
import { buildRoutineHistoryItems } from '../src/features/history/routineHistory'
import { buildRoutineReport } from '../src/features/routines/report/routineReport'
import { getRoutineProgram } from '../src/features/routines/programs'
import { MemoryRoutineSessionRepository } from '../src/features/routines/session/RoutineSessionRepository'
import { TrainingHistoryView } from '../src/pages/History/TrainingHistoryPage'
import { RoutineReportView } from '../src/pages/Report/RoutineReportView'
import { loadRoutineReport } from '../src/pages/Report/useRoutineReport'
import { RoutineEntryPage } from '../src/pages/Routines/RoutineEntryPage'
import { RoutinesIndexPage } from '../src/pages/Routines/RoutinesIndexPage'
import { FIRST_SESSION, at } from './analysis-fixtures'
import { routineRecord } from './helpers/routineFixtures'

const html = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(element)

describe('routine routes', () => {
  it('parses the index, entry and training paths and builds them back', () => {
    expect(parseRoutineRoute('/routines')).toEqual({ kind: 'index' })
    expect(parseRoutineRoute('/routines/')).toEqual({ kind: 'index' })
    expect(parseRoutineRoute('/routines/baduanjin')).toEqual({ kind: 'entry', routineId: 'baduanjin' })
    expect(parseRoutineRoute('/routines/taijiquan/train')).toEqual({ kind: 'train', routineId: 'taijiquan' })
    expect(parseRoutineRoute('/routines/x/y/z')).toBeUndefined()
    expect(parseRoutineRoute('/routines/%E0%A4%A')).toBeUndefined()
    expect(parseRoutineRoute('/train')).toBeUndefined()
    expect(routinePath('wuqinxi')).toBe('/routines/wuqinxi')
    expect(routineTrainingPath('baduanjin')).toBe('/routines/baduanjin/train')
    expect(routineTrainingPath('baduanjin', 'bdj-3')).toBe('/routines/baduanjin/train?form=bdj-3')
  })
})

describe('routine pages', () => {
  it('lists the four routines on the index, each linking to its entry page', () => {
    const markup = html(createElement(RoutinesIndexPage))
    for (const id of ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']) expect(markup).toContain(`href="/routines/${id}"`)
    expect(markup).toContain('跟练课程')
    expect(markup).not.toContain('功法跟练')
    expect(markup).not.toContain('routine-not-found')
    expect(html(createElement(RoutinesIndexPage, { unknownRoutine: true }))).toContain('没有找到这个课程')
  })

  it('shows a routine entry with its chapters, single-form practice and recent runs', () => {
    const program = getRoutineProgram('baduanjin')
    const repository = new MemoryRoutineSessionRepository([
      routineRecord({ id: 'r1', startedAt: at(1) }),
      routineRecord({ id: 'r2', startedAt: at(2), programId: 'taijiquan' }),
    ])
    const markup = html(createElement(RoutineEntryPage, { program, repository }))
    expect(markup).toContain('<h1')
    expect(markup).toContain('href="/routines/baduanjin/train"')
    expect(markup).toContain('href="/routines/baduanjin/train?form=bdj-3"')
    expect(markup).not.toContain('train?form=bdj-open')
    expect(markup).toContain('两手托天理三焦')
    expect(markup).toContain('全套 12:08')
    expect(markup).toContain('8 式 · 含预备势与收势')
    expect(markup).toContain('href="/report/r1"')
    expect(markup).not.toContain('href="/report/r2"')
    const empty = html(createElement(RoutineEntryPage, { program: getRoutineProgram('taijiquan'), repository: new MemoryRoutineSessionRepository() }))
    expect(empty).toContain('还没有太极拳的跟练记录')
    expect(empty).toContain('24 式')
  })
})

describe('routine history and report views', () => {
  it('merges routine records into the training history with their own labels', () => {
    const smart = buildTrainingHistoryItems([{ ...FIRST_SESSION, startedAt: at(1) }])
    const routine = buildRoutineHistoryItems([routineRecord({ id: 'routine-a', startedAt: at(2), programId: 'wuqinxi' })])
    const markup = html(createElement(TrainingHistoryView, { items: smart, overview: buildTrainingHistoryOverview(smart.map((item) => item.analysis)), routineItems: routine }))
    expect(markup).toContain('data-testid="history-card-routine-a"')
    expect(markup).toContain('五禽戏 · 整套跟练')
    expect(markup).toContain('跟练相似度 80%')
    expect(markup.indexOf('history-card-routine-a')).toBeLessThan(markup.indexOf(`history-card-${FIRST_SESSION.id}`))
    expect(markup).toContain('热身训练 · 近期进步')
    expect(markup).toContain('按训练模式筛选')
    const onlyRoutines = html(createElement(TrainingHistoryView, { items: [], overview: buildTrainingHistoryOverview([]), routineItems: routine }))
    expect(onlyRoutines).not.toContain('history-empty')
    expect(html(createElement(TrainingHistoryView, { items: [], overview: buildTrainingHistoryOverview([]), routineUnavailable: true }))).toContain('跟练课程记录暂时无法读取')
  })

  it('renders a routine report in the shared report shell', () => {
    const previous = routineRecord({ id: 'prev', startedAt: at(1), chapters: { 'bdj-2': { similarity: 0.5 } } })
    const current = routineRecord({ id: 'cur', startedAt: at(2), chapters: { 'bdj-2': { similarity: 0.6 } } })
    const report = buildRoutineReport(current, [previous, current])
    expect(report).toBeDefined()
    const markup = html(createElement(RoutineReportView, { report: report! }))
    expect(markup).toContain('data-report-kind="routine"')
    expect(markup).toContain('八段锦跟练报告')
    expect(markup).toContain('跟练相似度 · 基本一致')
    expect(markup).toContain('data-testid="routine-report-chapter-bdj-2"')
    expect(markup).toContain('href="/routines/baduanjin/train?form=bdj-2"')
    expect(markup).toContain('data-testid="routine-report-progress"')
    expect(markup).toContain('href="/report/prev"')
    expect(markup).toContain('重点复习「第二式 · 左右开弓似射雕」')
    expect(markup).toContain('比对规则：follow-along-v1')
  })

  it('loads a routine report by id and distinguishes missing from unreadable', () => {
    const repository = new MemoryRoutineSessionRepository([routineRecord({ id: 'x' })])
    expect(loadRoutineReport('x', repository).status).toBe('ready')
    expect(loadRoutineReport('session-1', repository).status).toBe('not_found')
    expect(loadRoutineReport('x', { save: () => true, get: () => undefined, list: () => { throw new Error('boom') } }).status).toBe('error')
  })
})

describe('routine coach context', () => {
  it('exposes the mode, current chapter, feedback, live stats and recent reports for a future AI Coach', () => {
    const program = getRoutineProgram('baduanjin')
    const chapter = program.chapters[3]
    const context = buildRoutineCoachContext({
      program,
      chapter,
      chapterPosition: { index: 3, total: 10 },
      courseState: 'ACTIVE',
      elapsedSeconds: 250.4,
      totalSeconds: 728.3,
      coveredSeconds: 240,
      match: { status: 'behind', similarity: 0.734, timingOffsetMs: -1320, matchedAt: 249, videoTime: 250.4, regionScores: { arms: 0.61, torso: 0.9, legs: null }, mirrored: false },
      feedback: { code: 'BEHIND', tone: 'warning', message: '稍慢了一点，跟上视频节奏' },
      recentReports: [],
    })
    expect(context).toEqual({
      currentMode: { id: 'baduanjin', title: '八段锦', kind: 'routine' },
      currentExercise: { id: 'bdj-3', name: '第三式 · 调理脾胃须单举', position: '4 / 10', cue: chapter.cue },
      currentFeedback: { code: 'BEHIND', message: '稍慢了一点，跟上视频节奏', tone: 'warning' },
      sessionStats: { state: 'ACTIVE', elapsedSeconds: 250, totalSeconds: 728, metrics: { similarity: 73, timingOffsetMs: -1320, arms: 61, torso: 90, legs: null, coverage: 33 } },
      recentReports: [],
    })
    const idle = buildRoutineCoachContext({ program, chapter, chapterPosition: { index: 3, total: 10 }, courseState: 'PREPARING', elapsedSeconds: 0, totalSeconds: 0, coveredSeconds: 0, recentReports: [] })
    expect(idle.currentFeedback).toBeNull()
    expect(idle.sessionStats?.metrics).toMatchObject({ similarity: null, coverage: null })
  })
})
