import { expect, test } from '@playwright/test'

const SCORED_EXERCISE_IDS = ['overhead_raise', 'lateral_raise', 'step_jack', 'squat', 'knee_raise']

test('completed fast course opens an honestly scoped reloadable training report', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic')
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 75_000 })
  await page.getByRole('button', { name: '查看训练报告' }).click()

  await expect(page).toHaveURL(/\/report\/session-/)
  await expect(page.getByTestId('report-summary')).toContainText('本次训练未完整完成')
  await expect(page.getByTestId('report-summary')).toContainText('1 / 6')
  await expect(page.getByTestId('overall-score-scope')).toContainText('暂不给出综合评分')
  const shoulderSummary = page.getByTestId('exercise-report-shoulder_rotation').locator('summary')
  await expect(shoulderSummary).toContainText('已完成')
  await expect(shoulderSummary).not.toContainText(/\d+\s*分/)
  for (const exerciseId of SCORED_EXERCISE_IDS) await expect(page.getByTestId(`exercise-report-${exerciseId}`)).toBeVisible()
  await expect(page.getByTestId('report-top-issues')).toBeVisible()
  await expect(page.getByTestId('report-recommendations')).toContainText('下次训练重点')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.getByTestId('report-summary').screenshot({ path: 'test-results/regression-screenshots/phase6b/report-overview.png' })
  await page.getByTestId('report-capabilities').screenshot({ path: 'test-results/regression-screenshots/phase6b/report-capabilities.png' })
  await page.getByTestId('exercise-report-overhead_raise').locator('summary').click()
  await page.getByTestId('report-exercises').screenshot({ path: 'test-results/regression-screenshots/phase6b/report-exercises.png' })
  await page.getByTestId('report-top-issues').screenshot({ path: 'test-results/regression-screenshots/phase6b/report-top-issues.png' })
  await page.getByTestId('report-recommendations').screenshot({ path: 'test-results/regression-screenshots/phase6b/report-recommendations.png' })

  await page.reload()
  await expect(page.getByTestId('report-summary')).toContainText('本次训练未完整完成')
  await expect(page.getByTestId('report-summary')).toContainText('1 / 6')

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase6b/report-mobile.png', fullPage: true })
})

test('incomplete course opens an honestly scoped report with no-issues state', async ({ page }) => {
  test.setTimeout(25_000)
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic')
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 8_000 })
  await page.getByRole('button', { name: '结束训练' }).click()
  await page.getByRole('button', { name: '结束并保存' }).click()
  await expect(page.getByText('课程提前结束，已保存未完成结果')).toBeVisible()
  await page.getByRole('button', { name: '查看训练报告' }).click()

  await expect(page.getByTestId('report-summary')).toContainText('本次训练未完整完成')
  await expect(page.getByTestId('overall-score-scope')).toContainText('暂不给出综合评分')
  await expect(page.getByTestId('report-top-issues')).toContainText('分析范围有限')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase6b/report-incomplete.png', fullPage: true })
  await page.getByTestId('report-top-issues').screenshot({ path: 'test-results/regression-screenshots/phase6b/report-no-issues.png' })
})

test('invalid report session id renders a graceful recovery state', async ({ page }) => {
  await page.goto('/report/not-a-real-session')
  await expect(page.getByTestId('report-not-found')).toContainText('没有找到这次训练记录')
  await expect(page.getByRole('button', { name: '返回首页' })).toBeVisible()
})
