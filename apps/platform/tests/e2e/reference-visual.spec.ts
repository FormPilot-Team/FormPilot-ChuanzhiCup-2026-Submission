import { expect, test } from '@playwright/test'

async function waitForDetectedPose(page: import('@playwright/test').Page) {
  const confidence = page.getByRole('complementary', { name: '开发调试信息' })
    .locator('dt', { hasText: 'Pose confidence' }).locator('..').locator('dd')
  await expect(confidence).not.toHaveText('0.00', { timeout: 30_000 })
}

test('captures Lateral Raise coach reference and real demo alignment', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1&debug=1')
  await waitForDetectedPose(page)
  await page.getByLabel('Show Coach Reference Skeleton').check()
  await expect(page.getByTestId('coach-reference-skeleton')).toBeVisible()
  await page.locator('section[aria-labelledby="coach-title"]').screenshot({ path: 'test-results/regression-screenshots/phase2_1/lateral-raise-coach-reference.png' })
  await page.locator('section[aria-labelledby="camera-title"]').screenshot({ path: 'test-results/regression-screenshots/phase2_1/lateral-raise-demo-alignment.png' })
})

test('captures Step Jack coach reference and real demo alignment', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1&debug=1&exercise=step_jack')
  await waitForDetectedPose(page)
  await page.getByLabel('Show Coach Reference Skeleton').check()
  await expect(page.getByTestId('coach-reference-skeleton')).toBeVisible()
  await page.locator('section[aria-labelledby="coach-title"]').screenshot({ path: 'test-results/regression-screenshots/phase2_1/step-jack-coach-reference.png' })
  await page.locator('section[aria-labelledby="camera-title"]').screenshot({ path: 'test-results/regression-screenshots/phase2_1/step-jack-demo-alignment.png' })
})

test('captures Squat coach reference and real demo alignment', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1&debug=1&exercise=squat')
  await waitForDetectedPose(page)
  await page.getByLabel('Show Coach Reference Skeleton').check()
  await expect(page.getByTestId('detected-coach-skeleton')).toBeVisible()
  await expect(page.getByTestId('canonical-reference-skeleton')).toBeVisible()
  await expect(page.getByTestId('coach-validation-debug')).toContainText('Detectable PASS · Similarity PASS')
  await page.locator('section[aria-labelledby="coach-title"]').screenshot({ path: 'test-results/regression-screenshots/phase3/squat-coach-reference.png' })
  await page.locator('section[aria-labelledby="camera-title"]').screenshot({ path: 'test-results/regression-screenshots/phase3/squat-demo-alignment.png' })
})
