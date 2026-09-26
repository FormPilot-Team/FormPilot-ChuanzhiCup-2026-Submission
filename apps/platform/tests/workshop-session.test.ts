import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildCustomHistoryItems, loadCustomHistory } from '../src/features/history/customHistory'
import { historyEntryHeadline, historyEntryModeId, historyEntryTitle, mergeHistoryEntries } from '../src/features/history/historyEntries'
import { buildHomeTrainingSummary } from '../src/features/history/homeSummary'
import { buildRecentReports } from '../src/features/coachContext/recentReports'
import { createDraftAction } from '../src/features/workshop/definition'
import { standingPose } from '../src/features/workshop/fixture'
import { buildCustomActionReport } from '../src/features/workshop/report'
import {
  MemoryCustomSessionRepository, createCustomSessionId, isCustomSessionId, parseStoredCustomSessions, recordFeedback, recordRep,
  retainCustomSessions, startCustomSession, type CustomActionSessionRecord,
} from '../src/features/workshop/session'
import { MemoryCustomActionRepository } from '../src/features/workshop/store'
import type { CapturedPose, CustomActionDefinition } from '../src/features/workshop/types'
import { HomePage } from '../src/pages/Home/HomePage'
import { CustomActionReportView } from '../src/pages/Report/CustomActionReportView'

const NOW = new Date('2026-09-27T08:00:00.000Z')
const DAY = 86_400_000

function capture(degrees: number): CapturedPose {
  return { landmarks: standingPose(degrees).map(({ x, y, z, visibility }) => ({ x, y, z, visibility })), aspect: 16 / 9, frames: 12, capturedAt: NOW.toISOString() }
}

function action(patch: Partial<CustomActionDefinition> = {}): CustomActionDefinition {
  return {
    ...createDraftAction(NOW, 'custom-raise'),
    name: '侧平举练习',
    goal: { type: 'reps', target: 10 },
    startPose: { description: '双臂下垂', capture: capture(8) },
    finishPose: { description: '双臂抬到肩高', capture: capture(90) },
    ...patch,
  }
}

function session(id: string, startedAt: number, reps: number, passed: number, patch: Partial<CustomActionSessionRecord> = {}): CustomActionSessionRecord {
  const record = startCustomSession(action(), { id, startedAt, recognitionMode: 'pose-match', source: 'live', mode: 'normal', requirements: ['arms-straight', 'torso-stable', 'full-return'] })
  for (let index = 1; index <= reps; index += 1) {
    const ok = index <= passed
    recordRep(record, {
      index,
      durationMs: 1500,
      peakProgress: 1,
      requirements: [{ id: 'arms-straight', passed: ok }, { id: 'torso-stable', passed: true }, { id: 'full-return', passed: true }],
      failed: ok ? [] : ['arms-straight'],
      passed: ok,
    })
    if (!ok) recordFeedback(record, 'REQUIREMENT_ARMS_STRAIGHT')
  }
  return { ...record, outcome: 'completed', endedAt: startedAt + 60_000, activeMs: 55_000, ...patch }
}

describe('custom-action session records', () => {
  it('uses its own id space and store, and tallies each requirement per repetition', () => {
    const id = createCustomSessionId(NOW.getTime(), () => 0.5)
    expect(id).toMatch(/^custom-session-\d+-/)
    expect(isCustomSessionId(id)).toBe(true)
    expect(isCustomSessionId('session-123')).toBe(false)
    const record = session(id, NOW.getTime(), 10, 7)
    expect(record).toMatchObject({ reps: 10, passedReps: 7, actionName: '侧平举练习', actionSource: 'workshop', kind: 'custom-action' })
    expect(record.requirements).toEqual([
      { id: 'arms-straight', checked: 10, passed: 7 },
      { id: 'torso-stable', checked: 10, passed: 10 },
      { id: 'full-return', checked: 10, passed: 10 },
    ])
    expect(record.feedbackCounts).toEqual({ REQUIREMENT_ARMS_STRAIGHT: 3 })
    expect(parseStoredCustomSessions([record, { kind: 'routine' }, null])).toHaveLength(1)
  })

  it('keeps the newest records and drops empty in-progress ones behind them', () => {
    const empty = { ...session('custom-session-1-a', NOW.getTime() - DAY, 0, 0), outcome: 'in_progress' as const }
    const kept = retainCustomSessions([empty, session('custom-session-2-b', NOW.getTime(), 3, 3)])
    expect(kept.map((item) => item.id)).toEqual(['custom-session-2-b'])
  })
})

describe('custom-action report', () => {
  it('reports completion and requirement results without inventing a score', () => {
    const report = buildCustomActionReport(session('custom-session-1-a', NOW.getTime(), 10, 7))
    expect(report).toMatchObject({ complete: true, progress: { done: 10, target: 10, unit: '次', share: 1 }, passRate: 70, headline: '完成 10 / 10 次 · 达标 7 次' })
    expect(report.requirements.map((row) => [row.id, row.rate])).toEqual([['arms-straight', 70], ['torso-stable', 100]])
    expect(report.primaryFeedback).toEqual({ code: 'REQUIREMENT_ARMS_STRAIGHT', message: '手臂再伸直一些' })
    expect(report.focus[0]).toMatchObject({ kind: 'requirement', title: '手臂保持伸直', value: '7 / 10 次达标' })
    expect(report.comparison).toMatchObject({ available: false, reason: '这是这个动作的第一条训练记录，暂无可对比的历史。' })
    expect(JSON.stringify(report)).not.toMatch(/综合评分|score|capabilit/i)
  })

  it('compares with the previous training of the same action', () => {
    const previous = session('custom-session-1-a', NOW.getTime() - DAY, 6, 3, { outcome: 'incomplete' })
    const current = session('custom-session-2-b', NOW.getTime(), 10, 9)
    const other = { ...session('custom-session-3-c', NOW.getTime() - 2 * DAY, 10, 10), actionId: 'custom-other' }
    const report = buildCustomActionReport(current, [previous, current, other])
    expect(report.comparison).toMatchObject({ available: true, previousId: 'custom-session-1-a', doneDelta: 4, passRateDelta: 40 })
  })

  it('points to completion and amplitude when those were the problems', () => {
    const short = session('custom-session-1-a', NOW.getTime(), 4, 4, { outcome: 'incomplete', feedbackCounts: { MOTION_TOO_SMALL: 3 } })
    const report = buildCustomActionReport(short)
    expect(report.focus.map((item) => item.kind)).toEqual(['completion', 'amplitude'])
    expect(report.primaryFeedback?.code).toBe('MOTION_TOO_SMALL')
    const clean = buildCustomActionReport(session('custom-session-2-b', NOW.getTime(), 10, 10))
    expect(clean.focus.map((item) => item.kind)).toEqual(['steady'])
    expect(clean.primaryFeedback).toBeNull()
  })

  it('renders in the shared report shell without warm-up or follow-along metrics', () => {
    const html = renderToStaticMarkup(createElement(CustomActionReportView, { report: buildCustomActionReport(session('custom-session-1-a', NOW.getTime(), 10, 7)), actionExists: true }))
    expect(html).toContain('data-report-kind="custom"')
    expect(html).toContain('侧平举练习训练报告')
    expect(html).toContain('完成度 · 10 / 10 次')
    expect(html).toContain('href="/workshop/custom-raise/train"')
    expect(html).toContain('下次训练重点')
    expect(html).not.toMatch(/综合评分|五维|跟练相似度/)
    const gone = renderToStaticMarkup(createElement(CustomActionReportView, { report: buildCustomActionReport(session('custom-session-1-a', NOW.getTime(), 10, 7)), actionExists: false }))
    expect(gone).toContain('这个动作已经从动作工坊删除')
  })
})

describe('custom actions in History, Home and the coach context', () => {
  it('joins the shared timeline as the third scope with its own label', () => {
    const items = buildCustomHistoryItems([session('custom-session-1-a', NOW.getTime(), 10, 7), session('custom-session-2-b', NOW.getTime() + 1000, 2, 2, { source: 'synthetic' })])
    expect(items.map((item) => item.record.id)).toEqual(['custom-session-1-a'])
    const [entry] = mergeHistoryEntries([], [], items)
    expect(entry.kind).toBe('custom')
    expect(historyEntryTitle(entry)).toBe('我的动作 · 侧平举练习')
    expect(historyEntryHeadline(entry)).toBe('完成 10 / 10 次 · 达标 7 次')
    expect(historyEntryModeId(entry)).toBe('custom-action')
    expect(buildRecentReports([], [], 5, items)[0]).toMatchObject({ modeId: 'custom-action', modeTitle: '我的动作 · 侧平举练习', reportPath: '/report/custom-session-1-a' })
    expect(buildHomeTrainingSummary([entry], NOW.getTime()).latest?.title).toBe('我的动作 · 侧平举练习')
    expect(loadCustomHistory({ save: () => true, get: () => undefined, list: () => { throw new Error('boom') } })).toEqual({ status: 'error' })
  })

  it('shows 我的动作 on Home: recent actions with a direct start, or a compact empty state', () => {
    const empty = renderToStaticMarkup(createElement(HomePage, { actionRepository: new MemoryCustomActionRepository(), customRepository: new MemoryCustomSessionRepository(), now: NOW.getTime() }))
    expect(empty).toContain('data-testid="home-my-actions-empty"')
    expect(empty).toContain('还没有自定义动作')
    expect(empty).toContain('href="/workshop/new"')
    const actions = ['a', 'b', 'c', 'd'].map((suffix, index) => action({ id: `custom-${suffix}`, name: `动作${suffix}`, updatedAt: new Date(NOW.getTime() + index * 1000).toISOString() }))
    const trained = { ...session('custom-session-1-a', NOW.getTime() - DAY, 3, 3), actionId: 'custom-a' }
    const html = renderToStaticMarkup(createElement(HomePage, { actionRepository: new MemoryCustomActionRepository(actions), customRepository: new MemoryCustomSessionRepository([trained]), now: NOW.getTime() }))
    const strip = html.slice(html.indexOf('data-testid="home-my-actions"'), html.indexOf('data-testid="home-workshop"'))
    expect(strip.match(/aria-label="开始训练 · /g)).toHaveLength(3)
    // Last trained first, then last edited.
    expect(strip.indexOf('custom-a/train')).toBeLessThan(strip.indexOf('custom-d/train'))
    expect(strip).not.toContain('custom-b/train')
    expect(strip).toContain('查看全部 4 个')
  })
})
