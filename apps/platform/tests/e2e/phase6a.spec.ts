import { expect, test } from '@playwright/test'

const coach = (page: import('@playwright/test').Page) => page.locator('section[aria-labelledby="coach-title"]')

test('Coach Card follows PREPARING, countdown, ACTIVE, TRANSITION, and next PREPARING in course runtime', async ({ page }) => {
  test.setTimeout(40_000)
  await page.goto('/?demo=1&course=1&fixture=synthetic&debug=1')

  await expect(page.getByTestId('coach-status-label')).toHaveText('准备中')
  await coach(page).screenshot({ path: 'test-results/regression-screenshots/phase6a/coach-preparing.png' })

  await expect(page.getByTestId('coach-countdown')).toBeVisible({ timeout: 8_000 })
  await expect(coach(page)).toHaveAttribute('data-coach-state', 'PREPARING')

  await expect(page.getByTestId('coach-status-label')).toHaveText('训练中', { timeout: 6_000 })
  await expect(page.getByTestId('coach-target')).toContainText('剩余')
  await expect(page.getByTestId('coach-target')).not.toContainText('圈')
  await coach(page).screenshot({ path: 'test-results/regression-screenshots/phase6a/coach-active.png' })

  await expect(page.getByTestId('coach-status-label')).toHaveText('本动作完成', { timeout: 20_000 })
  await expect(page.getByTestId('coach-secondary-message')).toContainText('下一动作：双臂上举')
  await expect(coach(page).locator('[data-coach-motion="playing"]')).toHaveAttribute('data-coach-frame-count', '4')
  await coach(page).screenshot({ path: 'test-results/regression-screenshots/phase6a/coach-transition.png' })

  await expect(page.getByRole('heading', { name: '今日训练 · 双臂上举专项' })).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('coach-status-label')).toHaveText('准备中')
})

test('confirmed primary correction recovers to POSITIVE and returns to ACTIVE', async ({ page }) => {
  test.setTimeout(20_000)
  await page.goto('/?demo=1&exercise=lateral_raise&fixture=synthetic&debug=1')

  await expect(page.getByTestId('coach-status-label')).toHaveText('动作纠正', { timeout: 8_000 })
  await expect(page.getByTestId('coach-primary-message')).toContainText('右臂再抬高一些')
  await expect(page.getByTestId('coach-highlight-overlay')).toBeVisible()
  await expect(coach(page).locator('[data-coach-motion="static"]')).toBeVisible()
  expect(await page.getByTestId('coach-highlight-anchor').count()).toBe(1)
  await coach(page).screenshot({ path: 'test-results/regression-screenshots/phase6a/coach-correcting-arm.png' })

  await expect(page.getByTestId('coach-status-label')).toHaveText('已调整', { timeout: 5_000 })
  await expect(page.getByTestId('coach-positive-check')).toBeVisible()
  await coach(page).screenshot({ path: 'test-results/regression-screenshots/phase6a/coach-positive.png' })

  await expect(page.getByTestId('coach-status-label')).toHaveText('训练中', { timeout: 3_000 })
  await page.screenshot({ path: 'test-results/regression-screenshots/phase6a/coach-debug.png', fullPage: true })
})

test('Squat depth correction uses hip anchor and mobile Coach Card has no overflow', async ({ page }) => {
  test.setTimeout(20_000)
  await page.goto('/?demo=1&exercise=squat&fixture=synthetic&coachFixture=squat-depth&debug=1')
  await expect(page.getByTestId('coach-status-label')).toHaveText('动作纠正', { timeout: 10_000 })
  await expect(page.getByTestId('coach-primary-message')).toContainText('蹲低')
  await expect(page.getByTestId('coach-highlight-overlay')).toBeVisible()
  await coach(page).screenshot({ path: 'test-results/regression-screenshots/phase6a/coach-correcting-squat.png' })

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase6a/coach-mobile.png', fullPage: true })
})

test('pause preserves Coach visual state and resumes without creating a PAUSED Coach state', async ({ page }) => {
  await page.goto('/?demo=1&exercise=overhead_raise&fixture=synthetic')
  await expect(page.getByTestId('coach-status-label')).toHaveText('训练中', { timeout: 8_000 })
  await expect(coach(page).locator('[data-coach-motion="playing"]')).toBeVisible()
  const track = coach(page).locator('.coach-motion-track')
  const transformBefore = await track.evaluate((element) => getComputedStyle(element).transform)
  await page.waitForTimeout(1_000)
  expect(await track.evaluate((element) => getComputedStyle(element).transform)).not.toBe(transformBefore)
  const stateBeforePause = await coach(page).getAttribute('data-coach-state')
  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(page.getByTestId('coach-paused-overlay')).toBeVisible()
  await expect(coach(page).locator('[data-coach-motion="paused"]')).toBeVisible()
  const pausedTransform = await track.evaluate((element) => getComputedStyle(element).transform)
  await page.waitForTimeout(500)
  expect(await track.evaluate((element) => getComputedStyle(element).transform)).toBe(pausedTransform)
  expect(await coach(page).getAttribute('data-coach-state')).toBe(stateBeforePause)
  await page.getByRole('button', { name: '继续训练' }).first().click()
  await expect(page.getByTestId('coach-paused-overlay')).toBeHidden()
  await expect(coach(page).locator('[data-coach-motion="playing"]')).toBeVisible()
})

test('reduced motion keeps an animated exercise on its canonical static frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?demo=1&exercise=overhead_raise&fixture=synthetic')
  await expect(coach(page).locator('[data-coach-motion="static"]')).toHaveAttribute('data-coach-frame-count', '4')
})
