import { expect, test, type Page } from '@playwright/test'
import { SESSION_STORAGE_KEY } from '../../src/features/training/LocalStorageTrainingSessionRepository'
import type { TrainingSessionState } from '../../src/features/training/types'
import {
  FIRST_SESSION, LEGACY_SESSION, MISSING_TOP_ELBOW, PARTIAL_SESSION, THEME_MERGE_AND_CAPS, at, makeSession,
} from '../analysis-fixtures'

async function seed(page: Page, sessions: TrainingSessionState[]) {
  await page.addInitScript(({ key, records }) => localStorage.setItem(key, JSON.stringify(records)), {
    key: SESSION_STORAGE_KEY,
    records: sessions,
  })
}

test('Report V2 scenario A: complete report closes the analysis-to-action loop', async ({ page }) => {
  await seed(page, [THEME_MERGE_AND_CAPS])
  await page.goto(`/report/${THEME_MERGE_AND_CAPS.id}`)

  await expect(page.getByTestId('report-summary')).toContainText('综合评分')
  await expect(page.getByTestId('report-analysis-summary')).toBeVisible()
  await expect(page.getByTestId('report-top-issues')).toContainText('本次最需要关注')
  await expect(page.getByTestId('report-exercises')).toContainText('动作表现')
  await expect(page.getByTestId('report-capabilities')).toContainText('能力表现')
  await expect(page.getByTestId('report-recommendations')).toContainText('下次训练重点')
  await expect(page.locator('body')).not.toContainText(/ELBOW_TOO_BENT|BODY_OUT_OF_FRAME|canonicalId|courseOverallScore/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('Report V2 scenario B: first training explains why no comparison exists', async ({ page }) => {
  await seed(page, [FIRST_SESSION])
  await page.goto(`/report/${FIRST_SESSION.id}`)

  await expect(page.getByTestId('report-summary')).toContainText('这是第一条训练记录，暂无可对比的历史')
  await expect(page.getByTestId('report-progress')).toHaveCount(0)
})

test('Report V2 scenario C: partial comparison uses the correct score scope', async ({ page }) => {
  await seed(page, [...PARTIAL_SESSION.history, PARTIAL_SESSION.current])
  await page.goto(`/report/${PARTIAL_SESSION.current.id}`)

  const hero = page.getByTestId('report-summary')
  await expect(hero).toContainText('已完成动作平均分')
  await expect(hero).toContainText('已与上次共同完成的 3 个动作进行对比')
  await expect(hero).not.toContainText('比上次提高')
  await expect(hero).not.toContainText('比上次降低')
  await expect(page.getByTestId('report-progress')).toContainText('仅比较双方共同完成的 3 个动作')
})

test('Report V2 scenario D: limited elbow evidence never becomes a fake no-issue conclusion', async ({ page }) => {
  await seed(page, [MISSING_TOP_ELBOW])
  await page.goto(`/report/${MISSING_TOP_ELBOW.id}`)

  await expect(page.getByTestId('report-analysis-summary')).toContainText('手肘伸展仅有 3 次可判断，当前证据不足')
  await expect(page.getByTestId('report-top-issues')).not.toContainText('本次没有需要优先纠正的问题')
  await page.getByTestId('report-data-notes').locator('summary').click()
  await expect(page.getByTestId('report-data-notes')).toContainText('有 3 次手肘伸展可以可靠判断')
})

test('Report V2 scenario E: legacy report remains usable without a fabricated history delta', async ({ page }) => {
  const older = makeSession({ id: 'legacy-older', startedAt: at(0) })
  await seed(page, [older, LEGACY_SESSION])
  await page.goto(`/report/${LEGACY_SESSION.id}`)

  await expect(page.getByTestId('report-summary')).toContainText('本次记录来自旧版本，无法确认评分规则，暂不比较')
  await page.getByTestId('report-data-notes').locator('summary').click()
  await expect(page.getByTestId('report-data-notes')).toContainText('此记录来自旧版本，无法与当前训练可靠比较')
  await expect(page.getByTestId('report-progress')).toHaveCount(0)
})

test('Report V2 visual audit: desktop hierarchy holds at all target widths', async ({ page }) => {
  await seed(page, [THEME_MERGE_AND_CAPS])
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport)
    await page.goto(`/report/${THEME_MERGE_AND_CAPS.id}`)
    await expect(page.getByRole('heading', { name: '这次训练，重点已经清楚了' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `screenshots/phase8f2/report-${viewport.width}x${viewport.height}-top.png` })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByTestId('report-top-issues').screenshot({ path: 'screenshots/phase8f2/report-priority.png' })
  await page.getByTestId('report-capabilities').screenshot({ path: 'screenshots/phase8f2/report-capability.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/report/${THEME_MERGE_AND_CAPS.id}`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'screenshots/phase8f2/report-mobile.png' })
})
