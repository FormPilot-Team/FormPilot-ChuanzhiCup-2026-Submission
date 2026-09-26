import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MODE_STATUS_LABEL, TOOL_ENTRIES, TRAINING_MODES, modeEntryRoute, type ModeHubEntry } from '../src/app/modeCatalog'
import { HISTORY_PATH, SMART_TRAINING_PATH } from '../src/app/routes'
import type { TrainingSessionRepository } from '../src/features/training/TrainingSessionRepository'
import type { TrainingSessionState } from '../src/features/training/types'
import { HomePage } from '../src/pages/Home/HomePage'
import { FIRST_SESSION, PARTIAL_SESSION, at, makeSession } from './analysis-fixtures'

function repository(sessions: TrainingSessionState[]): TrainingSessionRepository {
  return { save: () => true, get: (id) => sessions.find((item) => item.id === id), list: () => sessions }
}

function home(sessions: TrainingSessionState[] = []): string {
  return renderToStaticMarkup(createElement(HomePage, { repository: repository(sessions) }))
}

/** The markup of one card, from its data-testid to the end of its element. */
function card(html: string, testId: string): string {
  const start = html.indexOf(`data-testid="${testId}"`)
  expect(start, testId).toBeGreaterThan(-1)
  const open = html.lastIndexOf('<', start)
  const tag = html.slice(open + 1, html.indexOf(' ', open))
  const close = html.indexOf(`</${tag}>`, start)
  return html.slice(open, close + tag.length + 3)
}

const COURSE_EXERCISE_NAMES = ['肩部环绕', '双臂上举', '侧平举', '侧步开合', '徒手深蹲', '交替提膝']

describe('Mode Hub catalog', () => {
  it('lists the five FormPilot entries with only smart training and history available', () => {
    expect(TRAINING_MODES.map((item) => [item.id, item.title, item.status])).toEqual([
      ['smart-training', '智能训练', 'available'],
      ['baduanjin', '八段锦', 'coming_soon'],
      ['taichi', '太极拳', 'coming_soon'],
    ])
    expect(TOOL_ENTRIES.map((item) => [item.id, item.title, item.status])).toEqual([
      ['motion-workshop', '动作工坊', 'coming_soon'],
      ['history', '训练记录', 'available'],
    ])
    expect(MODE_STATUS_LABEL).toEqual({ available: '可使用', coming_soon: '即将整合' })
  })

  it('links available entries to real routes and never gives a coming-soon entry a route', () => {
    const all = [...TRAINING_MODES, ...TOOL_ENTRIES]
    expect(modeEntryRoute(all.find((item) => item.id === 'smart-training') as ModeHubEntry)).toBe(SMART_TRAINING_PATH)
    expect(modeEntryRoute(all.find((item) => item.id === 'history') as ModeHubEntry)).toBe(HISTORY_PATH)
    for (const entry of all.filter((item) => item.status === 'coming_soon')) {
      expect(entry.route, entry.id).toBeUndefined()
      // Even a route typed in by mistake does not make a coming-soon card clickable.
      expect(modeEntryRoute({ ...entry, route: '/somewhere' }), entry.id).toBeUndefined()
    }
  })

  it('describes the primary mode by its capabilities and keeps developer wording out of the workshop', () => {
    expect(TRAINING_MODES[0].cta).toBe('进入训练')
    expect(TRAINING_MODES[0].highlights).toEqual(['实时姿态识别', 'AI 纠错', '语音指导', '训练报告'])
    const copy = [...TRAINING_MODES, ...TOOL_ENTRIES].map((item) => `${item.title}${item.description}`).join('\n')
    expect(copy).not.toMatch(/工作台|JSON|参数|开发|编辑器/)
  })
})

describe('Home Mode Hub', () => {
  it('answers what to do today with the modes first and the six exercises out of the first level', () => {
    const html = home()
    expect(html).toContain('<h1')
    expect(html).toContain('FormPilot')
    expect(html).toContain('实时动作识别与智能训练指导')
    expect(html).toContain('今天想用 FormPilot 做什么？')
    for (const name of COURSE_EXERCISE_NAMES) expect(html, name).not.toContain(name)
    expect(html).not.toContain('六动作课程概览')
    expect(html.indexOf('智能训练')).toBeLessThan(html.indexOf('八段锦'))
    expect(html.indexOf('太极拳')).toBeLessThan(html.indexOf('工具与记录'))
    expect(html.indexOf('工具与记录')).toBeLessThan(html.indexOf('最近训练'))
  })

  it('enters smart training through its card', () => {
    const smart = card(home(), 'mode-card-smart-training')
    expect(smart).toContain(`href="${SMART_TRAINING_PATH}"`)
    expect(smart).toContain('进入训练')
    expect(smart).toContain('可使用')
  })

  it('shows 八段锦, 太极拳 and 动作工坊 as coming soon without any link or button', () => {
    const html = home()
    for (const testId of ['mode-card-baduanjin', 'mode-card-taichi', 'tool-card-motion-workshop']) {
      const markup = card(html, testId)
      expect(markup, testId).toContain('即将整合')
      expect(markup, testId).not.toContain('可使用')
      expect(markup, testId).not.toContain('href=')
      expect(markup, testId).not.toContain('<button')
      expect(markup, testId).not.toContain('tabindex')
    }
  })

  it('keeps 训练记录 and 使用说明 available as smaller tool cards', () => {
    const html = home()
    expect(card(html, 'tool-card-history')).toContain(`href="${HISTORY_PATH}"`)
    const guide = card(html, 'tool-card-guide')
    expect(guide).toContain('<button')
    expect(guide).toContain('使用说明')
  })

  it('shows the empty recent-training state with a way into History', () => {
    const recent = card(home(), 'home-training-history')
    expect(recent).toContain('最近训练')
    expect(recent).toContain('还没有训练记录')
    expect(recent).toContain(`href="${HISTORY_PATH}"`)
  })

  it('summarises the latest finished training, skipping unfinished records', () => {
    const recent = card(home([FIRST_SESSION, { ...PARTIAL_SESSION.current, startedAt: at(20) }]), 'home-training-history')
    expect(recent).toContain(`href="/report/${FIRST_SESSION.id}"`)
    expect(recent).toContain('综合评分')
    expect(recent).toContain('查看报告')
  })

  it('labels a latest free training as free training, never as a course score', () => {
    const free = makeSession({ id: 'free-squat', startedAt: at(30), include: ['squat'], exerciseOrder: ['squat'], courseStatus: 'completed' })
    const recent = card(home([FIRST_SESSION, free]), 'home-training-history')
    expect(recent).toContain('href="/report/free-squat"')
    expect(recent).toContain('自由训练 · 徒手深蹲')
    expect(recent).toContain('已完成动作平均分')
    expect(recent).not.toContain('综合评分')
  })

  it('opens the first-run guide when it has never been seen', () => {
    // No browser storage in this environment, so the guide counts as unseen.
    const html = home()
    expect(html).toContain('data-testid="onboarding-dialog"')
    expect(html).toContain('欢迎使用 FormPilot')
  })
})
