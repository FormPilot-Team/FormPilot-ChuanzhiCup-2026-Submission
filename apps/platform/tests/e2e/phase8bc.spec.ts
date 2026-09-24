import { expect, test } from '@playwright/test'

test('Hybrid AI Coach renders demo, camera, and coach-feedback columns without replacing CameraPanel', async ({ page }) => {
  await page.goto('/?demo=1&exercise=lateral_raise')

  const layout = page.getByTestId('hybrid-training-layout')
  await expect(layout).toBeVisible()
  await expect(layout.locator(':scope > *')).toHaveCount(3)
  await expect(page.getByTestId('demonstration-panel')).toHaveAttribute('data-demo-exercise', 'lateral_raise')
  await expect(page.getByRole('heading', { name: '实时动作检测' })).toBeVisible()
  await expect(page.getByRole('img', { name: '演示模式中的侧平举人物' })).toBeVisible()
  await expect(page.getByTestId('ai-coach-feedback-dock')).toBeVisible()
  await expect(page.getByTestId('static-ai-coach-slot')).toBeVisible()
  await expect(page.getByTestId('realtime-feedback-slot')).toBeVisible()
})

test('missing real video uses the explicit fallback while preserving the mapped source', async ({ page }) => {
  await page.goto('/?demo=1&exercise=squat')

  const demonstration = page.getByTestId('demonstration-panel')
  await expect(demonstration).toHaveAttribute('data-demo-source', '/assets/demos/squat.mp4')
  await expect(page.getByTestId('demonstration-fallback')).toContainText('真人示范视频暂未可用')
})

test('course state drives ACTIVE play intent, PAUSED pause, and course-end reset intent', async ({ page }) => {
  test.setTimeout(30_000)
  await page.goto('/?demo=1&course=1&fixture=synthetic')
  const demonstration = page.getByTestId('demonstration-panel')

  await expect(demonstration).toHaveAttribute('data-demo-playback', 'playing', { timeout: 10_000 })
  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(demonstration).toHaveAttribute('data-demo-playback', 'paused')
  await page.getByRole('button', { name: '继续训练' }).first().click()
  await expect(demonstration).toHaveAttribute('data-demo-playback', 'playing')

  await page.getByRole('button', { name: '结束训练' }).click()
  await page.getByRole('button', { name: '结束并保存' }).click()
  await expect(demonstration).toHaveAttribute('data-demo-playback', 'stopped')
  await expect(demonstration.locator('video')).toHaveJSProperty('currentTime', 0)
})

test('TRANSITION switches the demonstration source to the next course exercise', async ({ page }) => {
  test.setTimeout(25_000)
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic')
  const demonstration = page.getByTestId('demonstration-panel')

  await expect(demonstration).toHaveAttribute('data-demo-exercise', 'overhead_raise', { timeout: 12_000 })
  await expect(demonstration).toHaveAttribute('data-demo-source', '/assets/demos/overhead-raise.mp4')
})
