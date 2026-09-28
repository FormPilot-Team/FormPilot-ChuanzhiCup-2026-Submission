import { expect, test, type Page } from '@playwright/test'
import { markOnboardingSeen } from './support/onboarding'

const exit = (page: Page) => page.getByTestId('training-exit')

test.beforeEach(async ({ page }) => {
  await markOnboardingSeen(page)
})

test('Polish A: warm-up exit leaves at once while preparing and returns to 热身训练', async ({ page }) => {
  await page.goto('/train?exercise=squat')
  await expect(exit(page)).toHaveText('返回热身训练')
  await expect(exit(page)).toHaveAttribute('data-exit-phase', 'preparing')
  await exit(page).click()
  await expect(page).toHaveURL(/\/smart-training$/)
})

test('Polish B: warm-up exit asks first once training has started', async ({ page }) => {
  await page.goto('/train?demo=1&course=1&fixture=synthetic&exercise=squat')
  await expect(exit(page)).toHaveAttribute('data-exit-phase', 'active', { timeout: 30_000 })
  await exit(page).click()
  const dialog = page.getByTestId('training-exit-dialog')
  await expect(dialog.getByRole('heading', { name: '退出训练？' })).toBeVisible()
  await expect(dialog).toContainText('当前训练尚未完成，退出后本次进度不会继续保留。')
  await dialog.getByRole('button', { name: '继续训练' }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/train\?/)
  await exit(page).click()
  await page.getByTestId('training-exit-dialog').getByRole('button', { name: '确认退出' }).click()
  await expect(page).toHaveURL(/\/smart-training$/)
})

test('Polish C: routine exit uses the same control — direct while preparing, confirmed while following', async ({ page }) => {
  await page.goto('/routines/baduanjin/train?fixture=synthetic&gesture=manual')
  await expect(exit(page)).toHaveText('返回八段锦')
  await expect(exit(page)).toHaveAttribute('data-exit-phase', 'preparing')
  await exit(page).click()
  await expect(page).toHaveURL(/\/routines\/baduanjin$/)

  await page.goto('/routines/baduanjin/train?fixture=synthetic')
  await expect(page.getByTestId('routine-state')).toHaveAttribute('data-course-state', 'ACTIVE', { timeout: 30_000 })
  await expect(exit(page)).toHaveAttribute('data-exit-phase', 'active')
  await exit(page).click()
  await page.getByTestId('training-exit-dialog').getByRole('button', { name: '确认退出' }).click()
  await expect(page).toHaveURL(/\/routines\/baduanjin$/)
})

test('Polish D: every routine shows 本段要点, the camera status strip, 动作规范检查 and the next chapter', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const id of ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']) {
    await page.goto(`/routines/${id}/train?fixture=synthetic`)
    await expect(page.getByTestId('routine-state')).toHaveAttribute('data-course-state', 'ACTIVE', { timeout: 30_000 })
    const points = page.getByTestId('routine-chapter-points')
    await expect(points.getByRole('heading', { name: '本段要点' })).toBeVisible()
    await expect(page.getByTestId('routine-camera-requirement')).toContainText('本课程需要全身入镜')
    await expect(page.getByTestId('routine-camera-framing')).toContainText('全身入镜 ✓', { timeout: 15_000 })
    await expect(page.getByTestId('routine-camera-recognition')).toContainText('姿态识别正常')
    await expect(page.getByTestId('routine-checks').getByRole('heading', { name: '动作规范检查' })).toBeVisible()
    await expect(page.locator('[data-check-id="follow-along.rhythm"]')).toHaveAttribute('data-check-status', 'met', { timeout: 15_000 })
    await expect(page.getByTestId('routine-next-chapter')).toContainText('下一段')
    await expect(page.getByTestId('routine-chapters-done')).toContainText(/已完成 0 \/ \d+ 段/)
    // Video contract unchanged: the three regions sit side by side and end on one line.
    const [demo, camera, feedback] = await Promise.all(['demonstration', 'camera', 'feedback'].map((region) => page.locator(`[data-layout-region="${region}"]`).boundingBox()))
    expect(demo!.x + demo!.width).toBeLessThanOrEqual(camera!.x)
    expect(camera!.x + camera!.width).toBeLessThanOrEqual(feedback!.x)
    expect(Math.abs(demo!.y + demo!.height - (camera!.y + camera!.height))).toBeLessThanOrEqual(2)
    expect(Math.abs(feedback!.y + feedback!.height - (camera!.y + camera!.height))).toBeLessThanOrEqual(2)
    expect(await page.getByTestId('routine-stage-video').evaluate((video) => getComputedStyle(video).objectFit)).toBe(id === 'taijiquan' ? 'cover' : 'contain')
  }
})

test('Polish E: a followed form turns its measured requirements into live check results', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/routines/baduanjin/train?fixture=synthetic&fast=1&form=bdj-1')
  const points = page.getByTestId('routine-chapter-point')
  await expect(points).toHaveCount(3)
  await expect(points.first()).toContainText('双臂伸直上托')
  await expect(page.getByTestId('routine-check')).toHaveCount(4)
  await expect(page.locator('[data-check-id="bdj.1.elbow_extension"]')).toHaveAttribute('data-check-status', 'met', { timeout: 60_000 })
})
