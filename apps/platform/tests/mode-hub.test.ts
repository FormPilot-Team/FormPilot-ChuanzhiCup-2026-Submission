import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MODE_STATUS_LABEL, ROUTINE_MODES, TRAINING_MODES, WARM_UP_MODE, WORKSHOP_ENTRY, modeEntryRoute } from '../src/app/modeCatalog'
import { HISTORY_PATH, SMART_TRAINING_PATH, START_TRAINING_PATH, WORKSHOP_PATH } from '../src/app/routes'
import { buildHomeTrainingSummary, startOfLocalWeek, weekChangeText } from '../src/features/history/homeSummary'
import { mergeHistoryEntries } from '../src/features/history/historyEntries'
import { buildTrainingHistoryItems } from '../src/features/history/TrainingHistory'
import { buildRoutineHistoryItems } from '../src/features/history/routineHistory'
import type { TrainingSessionRepository } from '../src/features/training/TrainingSessionRepository'
import type { TrainingSessionState } from '../src/features/training/types'
import { HomePage } from '../src/pages/Home/HomePage'
import { COACH_WELCOME_ASSET, COACH_WELCOME_FALLBACK, COACH_WELCOME_FAMILY_A } from '../src/components/coach/coachIdentity'
import { MODE_ACCENT } from '../src/components/home/modeAccent'
import { MODE_FIGURES } from '../src/components/home/modeFigures'
import { WORKSHOP_NEUTRAL_FIGURE } from '../src/components/home/workshopTeaserArt'
import { REQUIREMENTS } from '../src/features/workshop/catalog'
import { ROUTINE_PROGRAMS } from '../src/features/routines/programs'
import { MemoryRoutineSessionRepository } from '../src/features/routines/session/RoutineSessionRepository'
import { FIRST_SESSION, PARTIAL_SESSION, at, makeSession } from './analysis-fixtures'
import { routineRecord } from './helpers/routineFixtures'

function repository(sessions: TrainingSessionState[]): TrainingSessionRepository {
  return { save: () => true, get: (id) => sessions.find((item) => item.id === id), list: () => sessions }
}

function home(sessions: TrainingSessionState[] = [], now = at(60)): string {
  return renderToStaticMarkup(createElement(HomePage, { repository: repository(sessions), now }))
}

/** The markup of one element, from its data-testid to the end of its element. */
function card(html: string, testId: string): string {
  const start = html.indexOf(`data-testid="${testId}"`)
  expect(start, testId).toBeGreaterThan(-1)
  const open = html.lastIndexOf('<', start)
  const tag = html.slice(open + 1, html.indexOf(' ', open))
  // Count nested elements of the same tag so a section containing sections is cut at its own end.
  let depth = 0
  let index = open
  const pattern = new RegExp(`<(/?)${tag}[\\s>]`, 'g')
  pattern.lastIndex = open
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[1] ? -1 : 1
    index = match.index
    if (depth === 0) break
  }
  return html.slice(open, index + tag.length + 3)
}

function mainContent(html: string): string {
  return html.slice(html.indexOf('<main'), html.indexOf('</main>'))
}

const COURSE_EXERCISE_NAMES = ['肩部环绕', '双臂上举', '侧平举', '侧步开合', '徒手深蹲', '交替提膝']

describe('training mode catalog', () => {
  it('lists five official modes on one level: 热身训练 first, then the four follow-along courses', () => {
    expect(TRAINING_MODES.map((item) => [item.id, item.title, item.status])).toEqual([
      ['smart-training', '热身训练', 'available'],
      ['baduanjin', '八段锦', 'available'],
      ['taijiquan', '太极拳', 'available'],
      ['wuqinxi', '五禽戏', 'available'],
      ['yijinjing', '易筋经', 'available'],
    ])
    expect(TRAINING_MODES.map((item) => item.route)).toEqual([
      SMART_TRAINING_PATH, '/routines/baduanjin', '/routines/taijiquan', '/routines/wuqinxi', '/routines/yijinjing',
    ])
    // Light emphasis only: the warm-up is the one recommended mode, and every mode carries the same kind of data.
    expect(TRAINING_MODES.filter((item) => item.badge).map((item) => item.id)).toEqual(['smart-training'])
    for (const mode of TRAINING_MODES) {
      expect(mode.meta, mode.id).toBeTruthy()
      expect(mode.cta, mode.id).toBeTruthy()
      expect(mode.motif, mode.id).toBeTruthy()
    }
    expect(new Set(TRAINING_MODES.map((item) => item.motif)).size).toBe(5)
    expect(ROUTINE_MODES.map((item) => item.meta)).toEqual(['全套 12:08 · 8 式', '全套 5:40 · 24 式', '全套 13:42 · 10 动', '全套 12:45 · 12 势'])
    expect(MODE_STATUS_LABEL).toEqual({ available: '可使用', coming_soon: '即将开放' })
  })

  it('links available entries and never gives a coming-soon entry a route', () => {
    expect(modeEntryRoute(WARM_UP_MODE)).toBe(SMART_TRAINING_PATH)
    expect(WORKSHOP_ENTRY).toMatchObject({ status: 'available', route: WORKSHOP_PATH, cta: '进入动作工坊' })
    expect(modeEntryRoute(WORKSHOP_ENTRY)).toBe(WORKSHOP_PATH)
    // A coming-soon entry stays static even with a route typed in by mistake.
    expect(modeEntryRoute({ ...WORKSHOP_ENTRY, status: 'coming_soon' })).toBeUndefined()
  })

  it('keeps product language: no smart-training or 功法跟练 names, no developer wording', () => {
    const copy = [...TRAINING_MODES, WORKSHOP_ENTRY].map((item) => `${item.title}${item.description}${item.meta ?? ''}${item.cta ?? ''}`).join('\n')
    expect(copy).not.toMatch(/智能训练|功法跟练|工作台|JSON|参数|开发|编辑器/)
  })
})

describe('Home', () => {
  it('opens with the FormPilot hero: positioning, the coach welcoming you, light capability hints', () => {
    const html = home()
    expect(html).toContain('<h1')
    expect(html).toContain('FormPilot')
    const hero = card(html, 'home-hero')
    expect(hero).toContain('你的专属动作教练')
    expect(hero).toContain('实时动作识别 · 动作纠正 · 训练复盘')
    // The coach picture comes from the single replacement point, with its own aspect ratio and framing.
    expect(hero).toContain(`src="${COACH_WELCOME_ASSET.src}"`)
    expect(hero).toContain(`aspect-ratio:${COACH_WELCOME_ASSET.width} / ${COACH_WELCOME_ASSET.height}`)
    expect(hero).toContain(`object-position:${COACH_WELCOME_ASSET.focus}`)
    expect(hero.match(/<img /g)).toHaveLength(1)
    // A short welcome of at most three lines, not a chat window.
    const welcome = card(hero, 'home-coach-welcome')
    expect(welcome.match(/class="block/g)).toHaveLength(3)
    for (const line of ['你好！', '今天想练什么？', '我会陪你一起完成训练。']) expect(welcome).toContain(line)
    expect(welcome).not.toMatch(/<input|<textarea|<button/)
    // Three light hints, only on wide screens.
    const hints = card(hero, 'home-hero-capabilities')
    expect(hints).toMatch(/^<ul class="[^"]*\bhidden\b[^"]*\bxl:flex\b/)
    expect(hints.match(/<li /g)).toHaveLength(3)
    for (const title of ['实时动作识别', '动作纠正', '训练复盘']) expect(hints).toContain(title)
    // The old pixel-skeleton card art is gone from the page itself (the first-run guide keeps its own diagrams).
    expect(mainContent(html)).not.toMatch(/示意图|<circle cx="120" cy="36"/)
    expect(html).not.toMatch(/智能训练|功法跟练|工具与记录|最近训练/)
    for (const name of COURSE_EXERCISE_NAMES) expect(html, name).not.toContain(name)
  })

  it('puts the five modes in one 开始训练 grid as same-size cards, warm-up first', () => {
    const html = home()
    const section = card(html, 'home-start-training')
    expect(section).toContain('id="start-training"')
    expect(section).toContain('开始训练')
    const positions = TRAINING_MODES.map((mode) => section.indexOf(`data-testid="mode-card-${mode.id}"`))
    expect(positions.every((position) => position > -1)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)
    for (const mode of TRAINING_MODES) {
      const markup = card(section, `mode-card-${mode.id}`)
      expect(markup.startsWith('<a '), mode.id).toBe(true)
      expect(markup, mode.id).toContain(`href="${mode.route}"`)
      expect(markup, mode.id).toContain(`aria-label="${mode.cta} · ${mode.title}"`)
      expect(markup, mode.id).not.toContain('即将开放')
    }
    expect(card(section, 'mode-card-smart-training')).toContain('推荐')
    expect(section.match(/推荐/g)).toHaveLength(2) // one badge per layout (phone row, card top)
    // One row of five on wide screens; 3 + 2 on tablets (the first three span two of six columns, the last two three).
    expect(card(section, 'home-training-modes')).toMatch(/^<ul class="[^"]*md:grid-cols-6[^"]*xl:grid-cols-5/)
    expect(section.match(/md:col-span-2 xl:col-span-1/g)).toHaveLength(3)
    expect(section.match(/md:col-span-3 xl:col-span-1/g)).toHaveLength(2)
  })

  it('gives every mode card its own pale tint, pose silhouette and short lines, in one shared structure', () => {
    const section = card(home(), 'home-start-training')
    expect(TRAINING_MODES.map((mode) => mode.accent)).toEqual(['brand', 'orange', 'violet', 'emerald', 'rose'])
    expect(ROUTINE_PROGRAMS.map((program) => program.accent)).toEqual(['orange', 'violet', 'emerald', 'rose'])
    for (const mode of TRAINING_MODES) {
      const markup = card(section, `mode-card-${mode.id}`)
      expect(markup, mode.id).toContain(`data-mode-accent="${mode.accent}"`)
      expect(markup, mode.id).toContain(`data-figure="${mode.motif}"`)
      expect(markup, mode.id).toContain(`url(#mode-figure-${mode.id})`)
      // The summary shows as two short lines; the full description stays for screen readers.
      expect(mode.summary?.split(' · '), mode.id).toHaveLength(2)
      for (const part of mode.summary?.split(' · ') ?? []) expect(part.length, part).toBeLessThanOrEqual(7)
      expect(markup, mode.id).toContain(`id="mode-${mode.id}-description" class="sr-only">${mode.description}`)
    }
    // A faint character only on the classical forms.
    expect(TRAINING_MODES.map((mode) => mode.mark ?? null)).toEqual([null, '锦', '太极', '禽', '经'])
    // Tints stay pale: the card surfaces use -50-level colours or lighter, never saturated fills.
    for (const accent of Object.values(MODE_ACCENT)) expect(accent.surface).not.toMatch(/-(?:[3-9]00)\b/)
    // Only the warm-up's button is filled, as its light emphasis.
    expect(card(section, 'mode-card-smart-training')).toContain('md:bg-blue-600')
    expect(section.match(/md:bg-blue-600/g)).toHaveLength(1)
  })

  it('draws the silhouettes from real landmarks, inside the figure box', () => {
    expect(Object.keys(MODE_FIGURES).sort()).toEqual(TRAINING_MODES.map((mode) => mode.motif).sort())
    for (const [motif, figure] of Object.entries(MODE_FIGURES)) {
      expect(figure.source, motif).toMatch(/^\/assets\/.+\.pose\.json/)
      const [cx, cy, r] = figure.head
      expect(cx - r).toBeGreaterThanOrEqual(0)
      expect(cy - r).toBeGreaterThanOrEqual(0)
      for (const [x1, y1, x2, y2, width] of figure.segments) {
        for (const value of [x1 - width / 2, y1 - width / 2, x2 - width / 2, y2 - width / 2]) expect(value, motif).toBeGreaterThanOrEqual(-0.1)
        for (const value of [x1 + width / 2, y1 + width / 2, x2 + width / 2, y2 + width / 2]) expect(value, motif).toBeLessThanOrEqual(100.1)
      }
    }
  })

  it('shows 动作工坊 as its own product section with its flow and one way in', () => {
    const workshop = card(home(), 'home-workshop')
    expect(workshop).toContain('动作工坊')
    expect(workshop).not.toContain('即将开放')
    for (const step of ['创建动作', '设置识别要求', '测试', '保存', '开始训练']) expect(workshop).toContain(step)
    expect(workshop.match(/href="/g)).toHaveLength(1)
    expect(workshop).toContain(`href="${WORKSHOP_PATH}"`)
    expect(workshop).toContain('进入动作工坊')
  })

  it('illustrates 动作工坊 as teaching FormPilot any action — record, learn, check, test — never one named move', () => {
    const workshop = card(home(), 'home-workshop')
    const illustration = card(workshop, 'home-workshop-illustration')
    for (const part of ['workshop-record', 'workshop-learn', 'workshop-requirements', 'workshop-tested']) expect(illustration).toContain(`data-part="${part}"`)
    for (const text of ['记录动作', '理解动作', '姿态', '动作范围', '完成条件', '测试通过']) expect(illustration).toContain(text)
    // Nothing that shows or names one particular action: no training, no start → finish pair, no action-specific
    // requirement, no mode-card pose and no landmark skeleton.
    expect(workshop).not.toContain('data-testid="pose-sketch"')
    const named = ['八段锦', '太极拳', '五禽戏', '易筋经', '热身', '开始姿势', '完成姿势', ...Object.values(REQUIREMENTS).map((requirement) => requirement.label)]
    for (const text of named) expect(illustration, text).not.toContain(text)
    for (const motif of Object.keys(MODE_FIGURES)) expect(illustration, motif).not.toContain(`data-figure="${motif}"`)
    expect(illustration).toContain('data-figure="workshop-neutral"')
    // The person in front of the camera stands at ease: nothing but the head above the shoulders, and mirror-symmetric.
    const { axis, shoulderY, segments } = WORKSHOP_NEUTRAL_FIGURE
    const limbs = segments.filter(([x1, , x2]) => x1 !== axis || x2 !== axis)
    expect(limbs).toHaveLength(8)
    for (const [, y1, , y2] of limbs) expect(Math.min(y1, y2)).toBeGreaterThanOrEqual(shoulderY)
    const key = (x1: number, y1: number, x2: number, y2: number, width: number) => [x1, y1, x2, y2, width].map((value) => value.toFixed(1)).join(' ')
    const mirrored = new Set(limbs.map(([x1, y1, x2, y2, width]) => key(2 * axis - x1, y1, 2 * axis - x2, y2, width)))
    expect(mirrored).toEqual(new Set(limbs.map(([x1, y1, x2, y2, width]) => key(x1, y1, x2, y2, width))))
  })

  it('keeps 使用说明 as a small utility button next to the hero', () => {
    const guide = card(card(home(), 'home-hero'), 'home-guide')
    expect(guide.startsWith('<button')).toBe(true)
    expect(guide).toContain('使用说明')
  })

  it('merges 训练记录 and 最近训练 into one 我的训练 summary with a single way into History', () => {
    const html = home()
    const summary = card(html, 'home-training-history')
    expect(summary).toContain('我的训练')
    expect(summary).toContain('还没有训练记录')
    expect(summary).toContain('查看训练记录')
    expect(summary).toContain(`href="${HISTORY_PATH}"`)
    expect(mainContent(html).match(new RegExp(`href="${HISTORY_PATH}"`, 'g'))).toHaveLength(1)
  })

  it('summarises the latest finished training, skipping unfinished records', () => {
    const summary = card(home([FIRST_SESSION, { ...PARTIAL_SESSION.current, startedAt: at(20) }]), 'home-training-history')
    expect(summary).toContain(`href="/report/${FIRST_SESSION.id}"`)
    expect(summary).toContain('热身训练 · 完整训练')
    expect(summary).toContain('综合评分')
    expect(summary).toContain('查看报告')
  })

  it('summarises a latest follow-along course next to warm-up records', () => {
    const routine = routineRecord({ id: 'routine-latest', startedAt: at(40), programId: 'yijinjing' })
    const html = renderToStaticMarkup(createElement(HomePage, { repository: repository([FIRST_SESSION]), routineRepository: new MemoryRoutineSessionRepository([routine]), now: at(41) }))
    const summary = card(html, 'home-training-history')
    expect(summary).toContain('href="/report/routine-latest"')
    expect(summary).toContain('易筋经 · 整套跟练')
    expect(summary).toContain('跟练相似度 80%')
  })

  it('labels a latest free training as free training, never as a course score', () => {
    const free = makeSession({ id: 'free-squat', startedAt: at(30), include: ['squat'], exerciseOrder: ['squat'], courseStatus: 'completed' })
    const summary = card(home([FIRST_SESSION, free]), 'home-training-history')
    expect(summary).toContain('href="/report/free-squat"')
    expect(summary).toContain('自由训练 · 徒手深蹲')
    expect(summary).toContain('已完成动作平均分')
    expect(summary).not.toContain('综合评分')
  })

  it('opens the first-run guide when it has never been seen', () => {
    // No browser storage in this environment, so the guide counts as unseen.
    const html = home()
    expect(html).toContain('data-testid="onboarding-dialog"')
    expect(html).toContain('欢迎使用 FormPilot')
  })

  it('links the header 开始训练 to Home\'s training section and 我的训练 to History', () => {
    const html = home()
    const nav = html.slice(html.indexOf('aria-label="主导航"'), html.indexOf('</nav>'))
    expect(nav).toContain(`href="${START_TRAINING_PATH}"`)
    expect(nav).toContain('开始训练')
    expect(nav).toContain(`href="${HISTORY_PATH}"`)
    expect(nav).toContain('我的训练')
    expect(nav).toContain(`href="${WORKSHOP_PATH}"`)
    expect(nav).toContain('动作工坊')
    expect(nav.indexOf('开始训练')).toBeLessThan(nav.indexOf('动作工坊'))
    expect(nav.indexOf('动作工坊')).toBeLessThan(nav.indexOf('我的训练'))
    expect(nav).not.toMatch(/智能训练|功法跟练|训练记录/)
  })
})

describe('coach welcome asset', () => {
  it('is one replacement point: a described picture with a Family A fallback', () => {
    expect(COACH_WELCOME_FALLBACK).toBe(COACH_WELCOME_FAMILY_A)
    expect(COACH_WELCOME_FAMILY_A).toMatchObject({ src: '/assets/coach/coach-welcome.webp', width: 765, height: 744, background: 'transparent', fadeBottom: true })
    for (const asset of [COACH_WELCOME_ASSET, COACH_WELCOME_FALLBACK]) {
      expect(asset.src).toMatch(/^\/assets\/coach\/.+\.(?:webp|png)$/)
      expect(asset.width).toBeGreaterThan(0)
      expect(asset.height).toBeGreaterThan(0)
      expect(['transparent', 'light']).toContain(asset.background)
      expect(asset.focus).toMatch(/^\d+% \d+%$/)
      expect(asset.bubble.right).toMatch(/^\d+%$/)
      expect(asset.bubble.top).toMatch(/^\d+%$/)
    }
  })
})

describe('我的训练 weekly summary', () => {
  // A Wednesday at 10:00 local time.
  const now = new Date(2026, 8, 23, 10, 0).getTime()
  const entry = (id: string, startedAt: number) => makeSession({ id, startedAt })

  it('counts finished trainings of the current local week, Monday first, and compares with last week', () => {
    const sessions = [
      entry('mon', new Date(2026, 8, 21, 8).getTime()),
      entry('wed-a', new Date(2026, 8, 23, 7).getTime()),
      entry('wed-b', new Date(2026, 8, 23, 9).getTime()),
      entry('last-sun', new Date(2026, 8, 20, 21).getTime()),
      { ...PARTIAL_SESSION.current, id: 'unfinished', startedAt: new Date(2026, 8, 22, 9).getTime() },
    ]
    const summary = buildHomeTrainingSummary(mergeHistoryEntries(buildTrainingHistoryItems(sessions), []), now)
    expect(startOfLocalWeek(now).getTime()).toBe(new Date(2026, 8, 21).getTime())
    expect(summary.weekCount).toBe(3)
    expect(summary.previousWeekCount).toBe(1)
    expect(summary.week.map((day) => [day.label, day.count, day.today, day.future])).toEqual([
      ['一', 1, false, false], ['二', 0, false, false], ['三', 2, true, false], ['四', 0, false, true],
      ['五', 0, false, true], ['六', 0, false, true], ['日', 0, false, true],
    ])
    expect(summary.latest).toMatchObject({ id: 'wed-b', title: '热身训练 · 完整训练' })
    expect(weekChangeText(summary)).toBe('比上周多 2 次')
  })

  it('describes the week-over-week change without inventing one', () => {
    expect(weekChangeText({ weekCount: 0, previousWeekCount: 0 })).toBeNull()
    expect(weekChangeText({ weekCount: 2, previousWeekCount: 0 })).toBe('上周没有完成的训练')
    expect(weekChangeText({ weekCount: 1, previousWeekCount: 1 })).toBe('与上周持平')
    expect(weekChangeText({ weekCount: 1, previousWeekCount: 3 })).toBe('比上周少 2 次')
  })

  it('includes follow-along courses in the same week', () => {
    const routine = buildRoutineHistoryItems([routineRecord({ id: 'r-tue', startedAt: new Date(2026, 8, 22, 18).getTime() })])
    const summary = buildHomeTrainingSummary(mergeHistoryEntries([], routine), now)
    expect(summary.weekCount).toBe(1)
    expect(summary.week[1].count).toBe(1)
    expect(summary.latest?.title).toBe('八段锦 · 整套跟练')
  })
})
