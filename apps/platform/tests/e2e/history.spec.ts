import { expect, test, type Page } from '@playwright/test'
import { SESSION_STORAGE_KEY } from '../../src/features/training/LocalStorageTrainingSessionRepository'
import type { TrainingSessionState } from '../../src/features/training/types'
import { LEGACY_SESSION, PARTIAL_SESSION, at, makeSession } from '../analysis-fixtures'
import { markOnboardingSeen } from './support/onboarding'

function course(id: string, day: number, issue = false): TrainingSessionState {
  return makeSession({
    id,
    startedAt: at(day),
    exercises: issue ? { squat: { raw: () => ({ maxHipDrop: 0.2 }) } } : undefined,
  })
}

async function seed(page: Page, sessions: TrainingSessionState[]) {
  await page.addInitScript(({ key, records }) => localStorage.setItem(key, JSON.stringify(records)), {
    key: SESSION_STORAGE_KEY,
    records: sessions,
  })
}

test('History A: zero records has a useful empty state and Home keeps the entry', async ({ page }) => {
  await markOnboardingSeen(page)
  await page.goto('/history')
  await expect(page.getByTestId('history-empty')).toContainText('还没有训练记录')
  await page.goto('/')
  await expect(page.getByTestId('home-training-history')).toContainText('还没有训练记录')
  await expect(page.getByRole('link', { name: '训练记录', exact: true })).toHaveAttribute('href', '/history')
  await expect(page.getByTestId('tool-card-history')).toHaveAttribute('href', '/history')
})

test('History B: three complete courses show the list, trend, and recurring issue', async ({ page }) => {
  const sessions = [course('course-1', 1, true), course('course-2', 2, true), course('course-3', 3, true)]
  await seed(page, sessions)
  await page.goto('/history')

  await expect(page.getByTestId('history-list').locator('article')).toHaveCount(3)
  await expect(page.getByTestId('history-card-course-3')).toContainText('综合评分')
  await expect(page.getByTestId('history-progress-overview')).toBeVisible()
  await expect(page.getByTestId('history-score-trend')).toBeVisible()
  await expect(page.getByTestId('history-progress-overview')).toContainText('最近 3 次训练中有 3 次需要关注')
  await expect(page.locator('body')).not.toContainText(/canonicalId|runtime code|analysis-v1|courseOverallScore|\bTOP\b/)
})

test('History C: incomplete records are hidden until the native toggle is enabled', async ({ page }) => {
  await seed(page, [PARTIAL_SESSION.current])
  await page.goto('/history')

  await expect(page.getByTestId('history-card-partial')).toHaveCount(0)
  await expect(page.getByTestId('history-incomplete-hidden')).toBeVisible()
  await page.getByRole('checkbox', { name: /显示未完成训练/ }).check()
  await expect(page.getByTestId('history-card-partial')).toContainText('训练未完成')
  await expect(page.getByTestId('history-card-partial')).toContainText('已完成动作平均分')
})

test('History D: legacy records remain openable without a progress chart', async ({ page }) => {
  await seed(page, [LEGACY_SESSION])
  await page.goto('/history')

  await expect(page.getByTestId(`history-card-${LEGACY_SESSION.id}`)).toContainText('旧版本记录')
  await expect(page.getByTestId('history-score-trend')).toHaveCount(0)
  await page.getByTestId(`history-card-${LEGACY_SESSION.id}`).getByRole('link').click()
  await expect(page).toHaveURL(`/report/${LEGACY_SESSION.id}`)
  await expect(page.getByTestId('report-summary')).toBeVisible()
})

test('History E: a user can move History to Report and back to History', async ({ page }) => {
  const session = course('round-trip', 1)
  await seed(page, [session])
  await page.goto('/history')
  await page.getByTestId('history-card-round-trip').getByRole('link').click()
  await expect(page).toHaveURL('/report/round-trip')
  await page.getByRole('link', { name: '查看训练记录' }).click()
  await expect(page).toHaveURL('/history')
  await expect(page.getByTestId('history-card-round-trip')).toBeVisible()
})

test('History F: records remain available after a full page reload', async ({ page }) => {
  const session = course('reload-persisted', 1)
  await page.goto('/')
  await page.evaluate(({ key, records }) => localStorage.setItem(key, JSON.stringify(records)), {
    key: SESSION_STORAGE_KEY,
    records: [session],
  })
  await page.goto('/history')
  await expect(page.getByTestId('history-card-reload-persisted')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('history-card-reload-persisted')).toBeVisible()
})

test('History responsive audit: cards and trend never overflow target viewports', async ({ page }) => {
  const sessions = [course('course-1', 1, true), course('course-2', 2, true), course('course-3', 3, true)]
  await seed(page, sessions)
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/history')
    await expect(page.getByRole('heading', { name: '训练记录', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (viewport.width === 1440) await page.screenshot({ path: 'test-results/history-1440x900.png', fullPage: true })
    if (viewport.width === 390) await page.screenshot({ path: 'test-results/history-390x844.png', fullPage: true })
  }
})
