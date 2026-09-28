import { expect, test, type Locator, type Page } from '@playwright/test'
import { markOnboardingSeen } from './support/onboarding'

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
] as const

async function box(locator: Locator) {
  const value = await locator.boundingBox()
  expect(value).not.toBeNull()
  return value!
}

async function openTraining(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-status', 'ready', { timeout: 20_000 })
  await expect(page.getByTestId('routine-training-layout')).toHaveAttribute('data-layout', 'camera-centered')
}

test.beforeEach(async ({ page }) => {
  await markOnboardingSeen(page)
})

test('follow-along layout keeps Camera between Demonstration and Feedback at target viewports', async ({ page }) => {
  test.setTimeout(120_000)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await openTraining(page, '/routines/baduanjin/train?fixture=synthetic')

    const demonstration = page.locator('[data-layout-region="demonstration"]')
    const camera = page.locator('[data-layout-region="camera"]')
    const feedback = page.locator('[data-layout-region="feedback"]')
    const [demoBox, cameraBox, feedbackBox, videoBox, cameraStageBox] = await Promise.all([
      box(demonstration), box(camera), box(feedback), box(page.getByTestId('routine-stage-video')), box(page.getByTestId('camera-stage')),
    ])

    await expect(page.getByRole('heading', { level: 2, name: '我的画面' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '实时反馈' })).toBeVisible()
    await expect(page.getByTestId('routine-feedback')).toContainText('跟练相似度')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await page.getByTestId('routine-stage-video').evaluate((video) => getComputedStyle(video).objectFit)).toBe('contain')
    expect(videoBox.width / videoBox.height).toBeCloseTo(16 / 9, 1)
    expect(cameraStageBox.width / cameraStageBox.height).toBeCloseTo(16 / 9, 1)

    if (viewport.width >= 1320) {
      expect(demoBox.x + demoBox.width).toBeLessThanOrEqual(cameraBox.x)
      expect(cameraBox.x + cameraBox.width).toBeLessThanOrEqual(feedbackBox.x)
      expect(cameraBox.width).toBeGreaterThan(demoBox.width)
      expect(demoBox.width).toBeGreaterThan(450)
      expect(cameraBox.width).toBeGreaterThan(480)
      expect(feedbackBox.width).toBeGreaterThan(280)
      expect(cameraStageBox.height).toBeGreaterThan(260)
    } else {
      expect(demoBox.y + demoBox.height).toBeLessThanOrEqual(cameraBox.y)
      expect(cameraBox.y + cameraBox.height).toBeLessThanOrEqual(feedbackBox.y)
      expect(demoBox.width).toBeLessThanOrEqual(viewport.width)
      expect(cameraBox.width).toBeLessThanOrEqual(viewport.width)
    }

    await page.screenshot({ path: `test-results/routine-layout-baduanjin-${viewport.width}x${viewport.height}.png`, fullPage: true })
  }
})

test('Taijiquan keeps the established 4:3 content viewport and black-bar crop treatment', async ({ page }) => {
  test.setTimeout(90_000)
  for (const viewport of VIEWPORTS.slice(0, 3)) {
    await page.setViewportSize(viewport)
    await openTraining(page, '/routines/taijiquan/train?fixture=synthetic')
    const stageBox = await box(page.getByTestId('routine-stage-video'))
    expect(stageBox.width / stageBox.height).toBeCloseTo(4 / 3, 1)
    expect(await page.getByTestId('routine-stage-video').evaluate((video) => getComputedStyle(video).objectFit)).toBe('cover')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/routine-layout-taijiquan-${viewport.width}x${viewport.height}.png`, fullPage: true })
  }
})

test('all four routine videos and a single-form route use the same non-cropping layout contract', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const id of ['baduanjin', 'wuqinxi', 'yijinjing']) {
    await openTraining(page, `/routines/${id}/train?fixture=synthetic`)
    expect(await page.getByTestId('routine-stage-video').evaluate((video) => getComputedStyle(video).objectFit), id).toBe('contain')
  }
  await openTraining(page, '/routines/baduanjin/train?fixture=synthetic&form=bdj-1')
  await expect(page.getByRole('heading', { level: 1, name: /八段锦 · 第一式/ })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '我的画面' })).toBeVisible()
  const [demoBox, cameraBox, feedbackBox] = await Promise.all([
    box(page.locator('[data-layout-region="demonstration"]')),
    box(page.locator('[data-layout-region="camera"]')),
    box(page.locator('[data-layout-region="feedback"]')),
  ])
  expect(demoBox.x + demoBox.width).toBeLessThanOrEqual(cameraBox.x)
  expect(cameraBox.x + cameraBox.width).toBeLessThanOrEqual(feedbackBox.x)
  await page.screenshot({ path: 'test-results/routine-layout-baduanjin-single-form-1440x900.png', fullPage: true })
})
