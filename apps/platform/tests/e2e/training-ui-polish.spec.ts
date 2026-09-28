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
