import { expect, test, type Page } from '@playwright/test'

async function expectNoOverlap(page: Page) {
  const selectors = ['demonstration-panel', 'camera-panel', 'ai-coach-feedback-dock']
  const boxes = await Promise.all(selectors.map(async (id) => {
    const box = await page.getByTestId(id).boundingBox()
    if (!box) throw new Error(`${id} has no bounding box`)
    return box
  }))
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left]
      const b = boxes[right]
      const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
      expect(overlaps).toBe(false)
    }
  }
}

test('training surface uses the Family A static Coach with primary feedback and metrics', async ({ page }) => {
  await page.goto('/?demo=1&exercise=lateral_raise&fixture=synthetic')

  await expect(page.getByTestId('demonstration-panel')).toBeVisible()
  await expect(page.getByTestId('camera-panel')).toBeVisible()
  await expect(page.getByTestId('ai-coach-dock')).toBeVisible()
  await expect(page.getByTestId('primary-feedback')).toBeVisible()
  await expect(page.getByRole('heading', { name: '详细指标' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'FormPilot AI 教练示范站姿' })).toHaveAttribute('src', '/assets/overhead-raise-demo-start.png')
  await expect(page.getByTestId('ai-coach-dock').locator('img[src="/assets/coach-lateral-raise.png"], img[src="/assets/coach-step-jack.png"]')).toHaveCount(0)

  await expect(page.getByTestId('primary-feedback')).toHaveAttribute('data-feedback-state', 'correcting', { timeout: 8_000 })
  await expect(page.getByTestId('primary-feedback-message')).toContainText('右臂再抬高一些')
  await expect(page.getByTestId('primary-feedback')).toHaveAttribute('data-feedback-state', 'recovery', { timeout: 6_000 })
})

test('pause, transition, and complete course states reach the Static Coach', async ({ page }) => {
  test.setTimeout(80_000)
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic')
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', /preparing|ready|active/)

  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'paused')
  await page.getByRole('button', { name: '继续训练' }).first().click()

  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'transition', { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 65_000 })
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'complete')
})

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
]) {
  test(`${viewport.width}x${viewport.height} keeps all three columns separate and primary feedback visible`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/?demo=1&exercise=squat&fixture=synthetic&coachFixture=squat-depth')
    await expect(page.getByTestId('primary-feedback')).toHaveAttribute('data-feedback-state', 'correcting', { timeout: 10_000 })
    await expectNoOverlap(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(page.getByTestId('primary-feedback')).toBeInViewport()
    await expect(page.getByRole('button', { name: '暂停训练' })).toBeInViewport()
    await expect(page.getByRole('button', { name: '结束训练' })).toBeInViewport()
  })
}
