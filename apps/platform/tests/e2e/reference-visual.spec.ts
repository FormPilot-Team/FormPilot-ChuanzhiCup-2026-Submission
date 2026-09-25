import { expect, test } from '@playwright/test'

async function waitForDetectedPose(page: import('@playwright/test').Page) {
  const confidence = page.getByRole('complementary', { name: '开发调试信息' })
    .locator('dt', { hasText: 'Pose confidence' }).locator('..').locator('dd')
  await expect(confidence).not.toHaveText('0.00', { timeout: 30_000 })
}

test('captures Lateral Raise Static Coach identity and real demo alignment', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1&debug=1')
  await waitForDetectedPose(page)
  await expect(page.getByTestId('coach-identity').locator('img')).toHaveAttribute('src', '/assets/overhead-raise-demo-start.png')
  await page.getByTestId('ai-coach-dock').screenshot({ path: 'test-results/regression-screenshots/phase2_1/lateral-raise-static-coach.png' })
  await page.locator('section[aria-labelledby="camera-title"]').screenshot({ path: 'test-results/regression-screenshots/phase2_1/lateral-raise-demo-alignment.png' })
})

test('captures Step Jack Static Coach identity and real demo alignment', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1&debug=1&exercise=step_jack')
  await waitForDetectedPose(page)
  await expect(page.getByTestId('coach-identity').locator('img')).toHaveAttribute('src', '/assets/overhead-raise-demo-start.png')
  await page.getByTestId('ai-coach-dock').screenshot({ path: 'test-results/regression-screenshots/phase2_1/step-jack-static-coach.png' })
  await page.locator('section[aria-labelledby="camera-title"]').screenshot({ path: 'test-results/regression-screenshots/phase2_1/step-jack-demo-alignment.png' })
})

test('captures Squat Static Coach identity and real demo alignment', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1&debug=1&exercise=squat')
  await waitForDetectedPose(page)
  await expect(page.getByTestId('coach-identity').locator('img')).toHaveAttribute('src', '/assets/overhead-raise-demo-start.png')
  await page.getByTestId('ai-coach-dock').screenshot({ path: 'test-results/regression-screenshots/phase3/squat-static-coach.png' })
  await page.locator('section[aria-labelledby="camera-title"]').screenshot({ path: 'test-results/regression-screenshots/phase3/squat-demo-alignment.png' })
})
