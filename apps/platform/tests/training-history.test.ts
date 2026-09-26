import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { analyzeTraining } from '../src/features/analysis'
import {
  buildTrainingHistoryItems, buildTrainingHistoryOverview, historyComparisonText, historyScoreText,
  loadTrainingHistory,
} from '../src/features/history/TrainingHistory'
import type { TrainingSessionRepository } from '../src/features/training/TrainingSessionRepository'
import type { TrainingSessionState } from '../src/features/training/types'
import { HomePage } from '../src/pages/Home/HomePage'
import { TrainingHistoryError, TrainingHistoryView } from '../src/pages/History/TrainingHistoryPage'
import { TrainingReportView } from '../src/pages/Report/TrainingReportPage'
import {
  DEMO_SESSION, FAST_SESSION, FIRST_SESSION, FULL_IMPROVEMENT, LEGACY_SESSION, PARTIAL_SESSION,
  at, makeSession,
} from './analysis-fixtures'

function markup(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(element)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function repository(sessions: TrainingSessionState[]): TrainingSessionRepository {
  return { save: () => true, get: (id) => sessions.find((item) => item.id === id), list: () => sessions }
}

function reliableSession(id: string, day: number, issue: 'squat' | 'elbow' | null = null): TrainingSessionState {
  return makeSession({
    id,
    startedAt: at(day),
    exercises: issue === 'squat'
      ? { squat: { raw: () => ({ maxHipDrop: 0.2 }) } }
      : issue === 'elbow'
        ? { overhead_raise: { raw: () => ({ topElbowL: 120, topElbowR: 150 }) } }
        : undefined,
  })
}

describe('training history list model', () => {
  it('sorts newest first with a deterministic descending id tie-break', () => {
    const older = reliableSession('older', 1)
    const sameA = reliableSession('same-a', 2)
    const sameB = reliableSession('same-b', 2)
    expect(buildTrainingHistoryItems([sameA, older, sameB]).map((item) => item.session.id)).toEqual(['same-b', 'same-a', 'older'])
  })

  it('excludes demo, synthetic, and explicit fast records while retaining legacy live records', () => {
    const synthetic = { ...clone(FIRST_SESSION), id: 'synthetic', source: 'synthetic' as const }
    const ids = buildTrainingHistoryItems([DEMO_SESSION, synthetic, FAST_SESSION, LEGACY_SESSION, FIRST_SESSION]).map((item) => item.session.id)
    expect(ids).toEqual([LEGACY_SESSION.id, FIRST_SESSION.id])
    expect(buildTrainingHistoryItems([LEGACY_SESSION])[0]).toMatchObject({ legacy: true, incomplete: false })
  })

  it('keeps incomplete records in the model but hides them in the default view', () => {
    const items = buildTrainingHistoryItems([PARTIAL_SESSION.current, FIRST_SESSION])
    expect(items.find((item) => item.session.id === PARTIAL_SESSION.current.id)?.incomplete).toBe(true)
    const overview = buildTrainingHistoryOverview(items.map((item) => item.analysis))
    const html = markup(createElement(TrainingHistoryView, { items, overview }))
    expect(html).toContain(`history-card-${FIRST_SESSION.id}`)
    expect(html).not.toContain(`history-card-${PARTIAL_SESSION.current.id}`)
    expect(html).toContain('显示未完成训练')
  })

  it('exposes a recoverable repository error state', () => {
    const broken: TrainingSessionRepository = { save: () => false, get: () => undefined, list: () => { throw new Error('read failed') } }
    expect(loadTrainingHistory(broken)).toEqual({ status: 'error' })
    expect(markup(createElement(TrainingHistoryError))).toContain('暂时无法读取训练记录')
  })
})

describe('training history score and comparison copy', () => {
  it('uses the three analysis score scopes without displaying zero for unavailable', () => {
    expect(historyScoreText(analyzeTraining(FIRST_SESSION, []))).toMatch(/^综合评分 \d+$/)
    expect(historyScoreText(analyzeTraining(PARTIAL_SESSION.current, PARTIAL_SESSION.history))).toMatch(/^已完成动作平均分 \d+$/)
    expect(historyScoreText(analyzeTraining(FAST_SESSION, []))).toBe('暂无可靠评分')
  })

  it('shows an overall delta only for FULL comparison and labels PARTIAL honestly', () => {
    const full = analyzeTraining(FULL_IMPROVEMENT.current, FULL_IMPROVEMENT.history)
    expect(historyComparisonText(full)).toBe(`↑ ${full.overall.delta}`)
    expect(historyComparisonText(analyzeTraining(PARTIAL_SESSION.current, PARTIAL_SESSION.history))).toBe('部分动作可对比')
    expect(historyComparisonText(analyzeTraining(FIRST_SESSION, []))).toBeNull()
  })
})

describe('training history progress overview', () => {
  it('does not make progress available below three reliable full courses', () => {
    const sessions = [reliableSession('one', 1), reliableSession('two', 2)]
    const overview = buildTrainingHistoryOverview(sessions.map((session) => analyzeTraining(session, sessions)))
    expect(overview.available).toBe(false)
    expect(overview.trendSessions).toHaveLength(2)
  })

  it('uses at most the most recent ten reliable sessions in chronological chart order', () => {
    const sessions = Array.from({ length: 12 }, (_item, index) => reliableSession(`course-${index + 1}`, index + 1))
    const overview = buildTrainingHistoryOverview(sessions.map((session) => analyzeTraining(session, sessions)))
    expect(overview.available).toBe(true)
    expect(overview.reliableSessionCount).toBe(12)
    expect(overview.trendSessions).toHaveLength(10)
    expect(overview.trendSessions.map((item) => item.sessionId)).toEqual(sessions.slice(2).map((item) => item.id))
  })

  it('excludes legacy, fast, demo, and partial analyses from the long-term trend', () => {
    const reliable = [reliableSession('one', 3), reliableSession('two', 4), reliableSession('three', 5)]
    const all = [...reliable, LEGACY_SESSION, FAST_SESSION, DEMO_SESSION, PARTIAL_SESSION.current]
    const overview = buildTrainingHistoryOverview(all.map((session) => analyzeTraining(session, all)))
    expect(overview.reliableSessionCount).toBe(3)
    expect(overview.trendSessions.map((item) => item.sessionId)).toEqual(reliable.map((item) => item.id))
  })

  it('counts a significant canonical issue by training, requires two of the recent five, and renders explicit training-count copy', () => {
    const sessions = [
      reliableSession('clean-1', 1), reliableSession('clean-2', 2),
      reliableSession('squat-1', 3, 'squat'), reliableSession('squat-2', 4, 'squat'), reliableSession('squat-3', 5, 'squat'),
    ]
    const overview = buildTrainingHistoryOverview(sessions.map((session) => analyzeTraining(session, sessions)))
    const squat = overview.recurringIssues.find((issue) => issue.label.includes('徒手深蹲'))
    expect(squat).toMatchObject({ sessionCount: 3, sampleSize: 5 })
    const items = buildTrainingHistoryItems(sessions)
    const html = markup(createElement(TrainingHistoryView, { items, overview }))
    expect(html).toContain('最近 5 次训练中有 3 次需要关注')
    expect(html).not.toContain('出现 3 次')
  })

  it('does not merge different canonical issues during recurring aggregation', () => {
    const sessions = [
      reliableSession('squat-1', 1, 'squat'), reliableSession('squat-2', 2, 'squat'),
      reliableSession('elbow-1', 3, 'elbow'), reliableSession('elbow-2', 4, 'elbow'), reliableSession('clean', 5),
    ]
    const overview = buildTrainingHistoryOverview(sessions.map((session) => analyzeTraining(session, sessions)))
    expect(overview.recurringIssues.some((issue) => issue.label.includes('徒手深蹲'))).toBe(true)
    expect(overview.recurringIssues.some((issue) => issue.label.includes('双臂上举'))).toBe(true)
    expect(new Set(overview.recurringIssues.map((issue) => issue.id)).size).toBe(overview.recurringIssues.length)
  })
})

describe('training history UI integration and copy hygiene', () => {
  it('renders the empty and legacy-only states without a trend chart', () => {
    const emptyOverview = buildTrainingHistoryOverview([])
    expect(markup(createElement(TrainingHistoryView, { items: [], overview: emptyOverview }))).toContain('还没有训练记录')
    const legacyItems = buildTrainingHistoryItems([LEGACY_SESSION])
    const legacyHtml = markup(createElement(TrainingHistoryView, { items: legacyItems, overview: buildTrainingHistoryOverview(legacyItems.map((item) => item.analysis)) }))
    expect(legacyHtml).toContain('旧版本记录')
    expect(legacyHtml).not.toContain('data-testid="history-score-trend"')
  })

  it('links every visible card to its report and exposes History on Home and Report', () => {
    const items = buildTrainingHistoryItems([FIRST_SESSION])
    const overview = buildTrainingHistoryOverview(items.map((item) => item.analysis))
    expect(markup(createElement(TrainingHistoryView, { items, overview }))).toContain(`href="/report/${FIRST_SESSION.id}"`)
    const home = markup(createElement(HomePage, { repository: repository([FIRST_SESSION]) }))
    expect(home).toContain('href="/history"')
    expect(home).toContain('训练记录')
    expect(home).toContain('查看报告')
    const report = markup(createElement(TrainingReportView, { analysis: analyzeTraining(FIRST_SESSION, []), session: FIRST_SESSION }))
    expect(report).toContain('查看训练记录')
    expect(report).toContain('再次训练')
  })

  it('keeps implementation terms and stored aggregate names out of the History DOM', () => {
    const sessions = [reliableSession('one', 1, 'squat'), reliableSession('two', 2, 'squat'), reliableSession('three', 3, 'squat')]
    const items = buildTrainingHistoryItems(sessions)
    const html = markup(createElement(TrainingHistoryView, { items, overview: buildTrainingHistoryOverview(items.map((item) => item.analysis)) }))
    expect(html).not.toMatch(/canonicalId|runtime code|analysis-v1|JSON key|courseOverallScore|\bTOP\b/)
  })
})
