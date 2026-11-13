import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { ROUTINE_SESSION_STORAGE_KEY } from '../../src/features/routines/session/RoutineSessionRepository'
import { SESSION_STORAGE_KEY } from '../../src/features/training/LocalStorageTrainingSessionRepository'
import { ONBOARDING_STORAGE_KEY } from '../../src/features/onboarding/onboarding'
import { makeSession } from '../analysis-fixtures'
import { routineRecord } from '../helpers/routineFixtures'

const OUT = resolve(process.env.WEB_V1_SHOTS ?? 'test-results/web-v1-shots')
const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'laptop-1024x768', width: 1024, height: 768 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'phone-390x844', width: 390, height: 844 },
] as const

interface Shot { viewport: string; page: string; state: string; file: string; overflowPx: number; errors: string[]; overlaps: number }
const results: Shot[] = []

/** Seeded fixture records (labelled "seeded" in the evidence): two warm-up courses and one 八段锦 session. */
async function seedRecords(page: Page) {
  const now = Date.now()
  const training = [makeSession({ id: 'shot-course-1', startedAt: now - 3 * 86_400_000 }), makeSession({ id: 'shot-course-2', startedAt: now - 86_400_000 })]
  const routines = [routineRecord({ id: 'shot-routine-1', startedAt: now - 2 * 3_600_000, chapters: { 'bdj-2': { similarity: 0.55 } } })]
  await page.addInitScript(({ keys, values }) => {
    localStorage.setItem(keys[0], values[0])
    localStorage.setItem(keys[1], values[1])
  }, { keys: [SESSION_STORAGE_KEY, ROUTINE_SESSION_STORAGE_KEY], values: [JSON.stringify(training), JSON.stringify(routines)] })
}

/** Visible, non-fixed cards that overlap each other by more than 4 px (layout collisions). */
async function overlapCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('.fpw .card, .fpw .gc-card, .fpw .metric')]
      .filter((element) => element.offsetParent !== null && getComputedStyle(element).position !== 'fixed' && !element.classList.contains('fh-float-card'))
    const boxes = cards.map((element) => element.getBoundingClientRect())
    let count = 0
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]; const b = boxes[j]
      if (cards[i].contains(cards[j]) || cards[j].contains(cards[i])) continue
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (x > 4 && y > 4) count += 1
    }
    return count
  })
}

const PAGES: ReadonlyArray<{ name: string; path: string; seeded: boolean; prepare?: (page: Page) => Promise<void> }> = [
  { name: 'home-empty', path: '/', seeded: false },
  { name: 'home', path: '/', seeded: true },
  { name: 'training-center', path: '/training', seeded: true },
  { name: 'routines', path: '/routines', seeded: true },
  { name: 'routine-detail', path: '/routines/baduanjin', seeded: true },
  { name: 'games', path: '/games', seeded: false },
  { name: 'coach-intro', path: '/coach', seeded: false },
  {
    name: 'coach-result', path: '/coach?view=profile', seeded: false, prepare: async (page) => {
      for (const label of ['上肢动作练习', '肩部僵硬', '肩部', '上肢']) await page.getByTestId('coach-profile').locator('label.check-chip', { hasText: new RegExp(`^${label}$`) }).locator('input').check()
      await page.getByTestId('coach-ack').check()
      await page.getByTestId('coach-submit').click()
      await expect(page.getByTestId('coach-origin')).toBeVisible()
    },
  },
  { name: 'me', path: '/me', seeded: true },
  { name: 'report', path: '/report/shot-routine-1', seeded: true },
  { name: 'history', path: '/history', seeded: true },
  { name: 'workshop', path: '/workshop', seeded: false },
  { name: 'settings', path: '/me/settings', seeded: false },
]

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'visual-summary.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8')
})

for (const viewport of VIEWPORTS) {
  for (const target of PAGES) {
    test(`${viewport.name} · ${target.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ version: 1, outcome: 'completed', at: 1 })), { key: ONBOARDING_STORAGE_KEY })
      if (target.seeded) await seedRecords(page)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(message.text())) errors.push(message.text()) })
      await page.goto(target.path)
      await page.waitForLoadState('networkidle')
      if (target.prepare) await target.prepare(page)
      await page.waitForTimeout(600)
      const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      const overlaps = await overlapCount(page)
      const dir = join(OUT, viewport.name)
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `${target.name}.png`)
      await page.screenshot({ path: file, fullPage: true })
      results.push({ viewport: viewport.name, page: target.name, state: target.seeded ? 'seeded fixture records' : 'empty local storage', file, overflowPx, errors, overlaps })
      expect(overflowPx, 'horizontal overflow').toBeLessThanOrEqual(1)
      expect(errors, 'console errors').toEqual([])
    })
  }
}
