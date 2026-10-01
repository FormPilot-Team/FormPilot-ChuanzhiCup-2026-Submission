import { expect, test } from '@playwright/test'
import { markOnboardingSeen } from './support/onboarding'

test.beforeEach(async ({ page }) => {
  await markOnboardingSeen(page)
})

test('warm-up framing follows each action profile instead of always requiring feet', async ({ page }) => {
  await page.goto('/train?demo=1&course=1&fixture=synthetic&gesture=manual&exercise=shoulder_rotation&coachFixture=upper-body-crop')
  const status = page.getByTestId('framing-status')
  await expect(status).toHaveAttribute('data-framing-profile', 'UPPER_BODY_WITH_HIPS')
  await expect(status).toContainText('入镜 ✓', { timeout: 5000 })
  // No drawn safe zone: recognition uses the whole picture, so a box would only mislead.
  await expect(page.getByTestId('framing-safe-zone')).toHaveCount(0)

  await page.goto('/train?demo=1&course=1&fixture=synthetic&gesture=manual&exercise=squat&coachFixture=upper-body-crop')
  await expect(status).toHaveAttribute('data-framing-profile', 'FULL_BODY')
  await expect(status).toContainText(/膝盖和脚部|全身/, { timeout: 5000 })

  await page.goto('/train?demo=1&course=1&fixture=synthetic&gesture=manual&exercise=knee_raise')
  await expect(status).toHaveAttribute('data-framing-profile', 'FULL_BODY')
  await expect(status).toContainText('全身入镜 ✓', { timeout: 5000 })
})

test('overhead raise pre-warns before the wrists leave the frame', async ({ page }) => {
  await page.goto('/train?demo=1&course=1&fixture=synthetic&gesture=manual&exercise=overhead_raise')
  const status = page.getByTestId('framing-status')
  await expect(status).toHaveAttribute('data-framing-profile', 'UPPER_BODY_WITH_HIPS')
  await expect(status).toContainText(/头顶和双手|双手保持/, { timeout: 8000 })
})

test('follow-along camera uses full-body framing UI without transforming the feed', async ({ page }) => {
  await page.goto('/routines/baduanjin/train?fixture=synthetic&gesture=manual')
  await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-status', 'ready', { timeout: 20_000 })
  await expect(page.getByTestId('framing-status')).toHaveAttribute('data-framing-profile', 'FULL_BODY')
  await expect(page.getByTestId('framing-safe-zone')).toHaveCount(0)
  const preview = page.getByTestId('camera-stage').locator('[data-demo-source]')
  await expect(preview).toBeVisible()
  expect(await preview.evaluate((element) => getComputedStyle(element).transform)).toBe('none')
  expect(await preview.getAttribute('class')).not.toMatch(/scale-|translate-|object-cover/)
})

test('framing hint remains within the camera at desktop and mobile sizes', async ({ page }) => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/train?demo=1&course=1&fixture=synthetic&gesture=manual&exercise=squat&coachFixture=upper-body-crop')
    const stageBox = await page.getByTestId('camera-stage').boundingBox()
    const hintBox = await page.getByTestId('framing-status').boundingBox()
    expect(stageBox).not.toBeNull()
    expect(hintBox).not.toBeNull()
    expect(hintBox!.x).toBeGreaterThanOrEqual(stageBox!.x)
    expect(hintBox!.x + hintBox!.width).toBeLessThanOrEqual(stageBox!.x + stageBox!.width + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})
