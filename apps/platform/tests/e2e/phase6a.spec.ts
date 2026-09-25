import { expect, test } from '@playwright/test'

test('legacy Coach Card runtime states remain observable through the Static Coach dock', async ({ page }) => {
  test.setTimeout(40_000)
  await page.goto('/?demo=1&course=1&fixture=synthetic&debug=1')

  await expect(page.getByTestId('coach-status-label')).toHaveText('准备中')
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', /preparing|ready/)
  await expect(page.getByTestId('coach-status-label')).toHaveText('训练中', { timeout: 8_000 })
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'active')
  await expect(page.getByTestId('coach-status-label')).toHaveText('本动作完成', { timeout: 20_000 })
  await expect(page.getByTestId('coach-primary-message')).toContainText('双臂上举')
  await expect(page.getByRole('heading', { name: '今日训练 · 双臂上举专项' })).toBeVisible({ timeout: 5_000 })
})

test('confirmed primary correction recovers and returns to active guidance', async ({ page }) => {
  test.setTimeout(20_000)
  await page.goto('/?demo=1&exercise=lateral_raise&fixture=synthetic&debug=1')

  await expect(page.getByTestId('coach-status-label')).toHaveText('动作纠正', { timeout: 8_000 })
  await expect(page.getByTestId('coach-primary-message')).toContainText('右臂再抬高一些')
  await expect(page.getByTestId('primary-feedback')).toHaveAttribute('data-feedback-state', 'correcting')
  await expect(page.getByTestId('coach-status-label')).toHaveText('已调整', { timeout: 5_000 })
  await expect(page.getByTestId('primary-feedback')).toHaveAttribute('data-feedback-state', 'recovery')
  await expect(page.getByTestId('coach-status-label')).toHaveText('训练中', { timeout: 3_000 })
})

test('Squat depth correction remains primary and mobile dock has no overflow', async ({ page }) => {
  test.setTimeout(20_000)
  await page.goto('/?demo=1&exercise=squat&fixture=synthetic&coachFixture=squat-depth&debug=1')
  await expect(page.getByTestId('coach-status-label')).toHaveText('动作纠正', { timeout: 10_000 })
  await expect(page.getByTestId('coach-primary-message')).toContainText('蹲低')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('pause maps to the dedicated paused Coach state and resumes', async ({ page }) => {
  await page.goto('/?demo=1&exercise=overhead_raise&fixture=synthetic')
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'active', { timeout: 8_000 })
  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'paused')
  await page.getByRole('button', { name: '继续训练' }).first().click()
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'active')
})

test('Static Coach remains static when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?demo=1&exercise=overhead_raise&fixture=synthetic')
  await expect(page.getByTestId('coach-identity').locator('img')).toHaveAttribute('src', '/assets/overhead-raise-demo-start.png')
  await expect(page.getByTestId('coach-identity').locator('.coach-motion-track')).toHaveCount(0)
})
