import { expect, test } from '@playwright/test'
import { ROUTINE_SESSION_STORAGE_KEY } from '../../src/features/routines/session/RoutineSessionRepository'
import type { RoutineSessionRecord } from '../../src/features/routines/session/types'
import { markOnboardingSeen } from './support/onboarding'

test.beforeEach(async ({ page }) => {
  await markOnboardingSeen(page)
})

test('Routine analyzers: 专项分析 shows live while following and the report adds its own section', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/routines/taijiquan/train?fixture=synthetic&form=tjq-3')
  const live = page.getByTestId('routine-analyzer-live')
  await expect(live).toContainText('专项分析 · 太极拳连续性')
  await expect(live).toContainText('开始跟练后显示')
  await expect(page.getByTestId('routine-state')).toHaveAttribute('data-course-state', 'ACTIVE', { timeout: 30_000 })
  await expect.poll(async () => Number(await live.getAttribute('data-analyzer-score') || -1), { timeout: 15_000 }).toBeGreaterThanOrEqual(80)

  const dialog = page.getByTestId('routine-complete-dialog')
  await expect(dialog).toHaveAttribute('data-outcome', 'completed', { timeout: 60_000 })
  const [record] = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]') as RoutineSessionRecord[], ROUTINE_SESSION_STORAGE_KEY)
  expect(record.analysis).toMatchObject({ analyzerId: 'taijiquan', version: 'taijiquan-continuity-v1' })
  expect(record.analysis?.chapters.map((item) => item.chapterId)).toEqual(['tjq-3'])

  await page.getByRole('button', { name: '查看跟练报告' }).click()
  const section = page.getByTestId('routine-report-analyzer')
  await expect(section).toContainText('专项分析 · 太极拳连续性')
  await expect(section.getByTestId('routine-analyzer-score')).not.toHaveText('—')
  await expect(section.getByTestId('routine-analyzer-chapter-tjq-3')).toBeVisible()
  await section.getByTestId('routine-analyzer-chapter-tjq-3').locator('summary').click()
  await expect(section.locator('[data-metric-id="weightShift"]')).toContainText('二维髋中心近似')
  // The established report parts are still there and separate.
  await expect(page.getByTestId('routine-report-overview')).toBeVisible()
  await expect(page.getByTestId('report-summary')).toContainText('跟练相似度')
  expect(errors).toEqual([])
})
