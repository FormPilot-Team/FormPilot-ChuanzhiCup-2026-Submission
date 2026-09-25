import { expect, test, type Page } from '@playwright/test'

const setForceNoPose = (page: Page, value: boolean) => page.evaluate((next) => {
  (window as typeof window & { __forceNoPose?: boolean }).__forceNoPose = next
}, value)

test('preparing and countdown show the overlay while active, pause, and incomplete end hide it', async ({ page }) => {
  test.setTimeout(30_000)
  await page.addInitScript(() => { (window as typeof window & { __forceNoPose?: boolean }).__forceNoPose = true })
  await page.goto('/train?demo=1&course=1&fixture=synthetic&debug=1')
  const overlay = page.getByTestId('pose-overlay')

  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'preparing')
  await expect(overlay).toBeVisible()

  await setForceNoPose(page, false)
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'ready', { timeout: 4_000 })
  await expect(overlay).toBeVisible()
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'active', { timeout: 4_000 })
  await expect(overlay).toBeHidden()

  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'paused')
  await expect(overlay).toBeHidden()
  await page.getByRole('button', { name: '继续训练' }).first().click()
  await expect(overlay).toBeHidden()

  await page.getByRole('button', { name: '结束训练' }).click()
  await page.getByRole('button', { name: '结束并保存' }).click()
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'complete')
  await expect(overlay).toBeHidden()
})

test('transition stays hidden and the next exercise preparing state restores the overlay', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/train?demo=1&course=1&fast=1&fixture=synthetic&debug=1')
  const overlay = page.getByTestId('pose-overlay')

  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'transition', { timeout: 15_000 })
  await expect(overlay).toBeHidden()
  await setForceNoPose(page, true)
  await expect(page.getByRole('heading', { name: '今日训练 · 双臂上举专项' })).toBeVisible({ timeout: 3_000 })
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'preparing')
  await expect(overlay).toBeVisible()

  await setForceNoPose(page, false)
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 70_000 })
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'complete')
  await expect(overlay).toBeHidden()
})

test('ACTIVE hides the overlay while pose and scoring data continue updating', async ({ page }) => {
  await page.goto('/train?demo=1&exercise=squat&fixture=synthetic&debug=1')
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'active', { timeout: 8_000 })
  await expect(page.getByTestId('pose-overlay')).toBeHidden()

  const debug = page.getByRole('complementary', { name: '开发调试信息' })
  const value = (label: string) => debug.locator('dt', { hasText: label }).locator('..').locator('dd')
  await expect(value('Pose confidence')).not.toHaveText('0.00', { timeout: 15_000 })
  await expect(value('Phase trace')).toContainText('DESCENDING', { timeout: 15_000 })
  await expect(value('Rep count')).not.toHaveText('0', { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: '详细指标' })).toBeVisible()
})

test('Header exposes the frozen FormPilot brand on training', async ({ page }) => {
  await page.goto('/train?demo=1')
  await expect(page.locator('header')).toContainText('FormPilot')
  await expect(page.locator('header')).not.toContainText('AI 电子教练')
  await expect(page).toHaveTitle('FormPilot · 训练')
})
