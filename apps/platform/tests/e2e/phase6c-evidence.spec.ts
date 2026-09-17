import { expect, test } from '@playwright/test'

const shot = (page: import('@playwright/test').Page, name: string, fullPage = false) => page.screenshot({ path: `screenshots/phase6c/${name}.png`, fullPage })

test('captures the Phase 6C final demo evidence set', async ({ page }) => {
  test.setTimeout(150_000)
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const failure = (window as typeof window & { __cameraFailure?: string }).__cameraFailure
      if (failure) throw new DOMException('internal browser detail', failure)
      const canvas = document.createElement('canvas')
      canvas.width = 1280
      canvas.height = 720
      const context = canvas.getContext('2d')
      context?.fillRect(0, 0, canvas.width, canvas.height)
      return canvas.captureStream(30)
    } })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'AI 电子教练', level: 1 })).toBeVisible()
  await shot(page, 'home', true)
  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, 'mobile-home', true)

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/train?demo=1&course=1&fixture=synthetic')
  await expect(page.getByRole('heading', { name: '今日训练 · 肩部活动引导' })).toBeVisible()
  await shot(page, 'training-preparing')
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 8_000 })
  await shot(page, 'training-active')
  await page.setViewportSize({ width: 1366, height: 768 })
  await expect(page.getByRole('button', { name: '暂停训练' })).toBeInViewport()
  await expect(page.getByRole('button', { name: '结束训练' })).toBeInViewport()
  await shot(page, 'desktop-1366-training')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.evaluate(() => { (window as typeof window & { __forceNoPose?: boolean }).__forceNoPose = true })
  await expect(page.getByTestId('course-state')).toHaveText('请回到画面中，确保上半身和髋部完整入镜', { timeout: 2_000 })
  await shot(page, 'training-no-pose')
  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, 'mobile-training', true)

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/train?demo=1&exercise=lateral_raise&fixture=synthetic')
  await expect(page.getByTestId('coach-status-label')).toHaveText('动作纠正', { timeout: 8_000 })
  await shot(page, 'coach-correcting')

  await page.goto('/train')
  await page.evaluate(() => { (window as typeof window & { __cameraFailure?: string }).__cameraFailure = 'NotAllowedError' })
  await page.getByRole('button', { name: '启用摄像头' }).click()
  await expect(page.getByText('未获得摄像头权限，请允许访问摄像头后重试。')).toBeVisible()
  await shot(page, 'camera-error')

  await page.goto('/train?demo=1&course=1&fast=1&fixture=synthetic')
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 75_000 })
  await shot(page, 'course-complete')
  await page.getByRole('button', { name: '查看训练报告' }).click()
  await expect(page.getByTestId('report-summary')).toContainText('训练完成')
  await shot(page, 'report-final', true)
  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, 'mobile-report', true)

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/train?demo=1&course=1&fast=1&fixture=synthetic')
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 8_000 })
  await page.getByRole('button', { name: '结束训练' }).click()
  await page.getByRole('button', { name: '结束并保存' }).click()
  await page.getByRole('button', { name: '查看训练报告' }).click()
  await expect(page.getByTestId('report-summary')).toContainText('训练未完成')
  await shot(page, 'report-incomplete', true)
})
