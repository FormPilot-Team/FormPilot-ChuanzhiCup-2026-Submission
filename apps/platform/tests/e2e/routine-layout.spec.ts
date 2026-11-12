import { expect, test, type Locator, type Page } from '@playwright/test'
import { markOnboardingSeen } from './support/onboarding'

/**
 * Web V1.1 C2 layout contract of the immersive follow-along: the standard demonstration and the user's own camera
 * side by side on landscape screens (one height) and stacked on portrait screens; they never overlap each other, the
 * coaching line sits under the camera picture (never on it), the secondary data is in 详细数据, and nothing scrolls
 * sideways. The pictures are never stretched: the video keeps its content aspect, the camera feed is object-contain.
 */
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
] as const

async function box(locator: Locator) {
  const value = await locator.boundingBox()
  expect(value).not.toBeNull()
  return value!
}

function overlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

async function openTraining(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-status', 'ready', { timeout: 20_000 })
  await expect(page.getByTestId('routine-training-layout')).toHaveAttribute('data-layout', 'immersive')
}

test.beforeEach(async ({ page }) => {
  await markOnboardingSeen(page)
})

test('C2: demonstration and camera never cover each other at the target viewports', async ({ page }) => {
  test.setTimeout(180_000)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await openTraining(page, '/routines/baduanjin/train?fixture=synthetic')
    const landscape = viewport.width > viewport.height && viewport.width >= 896
    await expect(page.getByTestId('routine-training-layout')).toHaveAttribute('data-arrangement', landscape ? 'side-by-side' : 'stacked')
    await expect(page.getByTestId('routine-training-shell')).toHaveAttribute('data-theme', 'immersive')

    const [media, camera, toast, rail] = await Promise.all([
      box(page.getByTestId('routine-stage-media')), box(page.getByTestId('camera-stage')), box(page.getByTestId('camera-guidance')), box(page.getByTestId('routine-footer')),
    ])
    expect(overlap(media, camera), `${viewport.width}: demo × camera`).toBe(0)
    // The coaching line is under the picture, never over the body.
    expect(overlap(toast, camera), `${viewport.width}: toast × camera`).toBe(0)
    expect(toast.y).toBeGreaterThanOrEqual(camera.y + camera.height - 1)
    expect(overlap(rail, camera), `${viewport.width}: rail × camera`).toBe(0)
    expect(overlap(rail, media), `${viewport.width}: rail × demo`).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await page.getByTestId('routine-stage-video').evaluate((video) => getComputedStyle(video).objectFit)).toBe('contain')
    expect(media.width / media.height).toBeCloseTo(16 / 9, 1)
    expect(await page.getByTestId('camera-stage').locator('[data-demo-source]').evaluate((element) => getComputedStyle(element).objectFit)).toBe('contain')

    if (landscape) {
      expect(media.x + media.width).toBeLessThanOrEqual(camera.x)
      expect(Math.abs(camera.y - media.y), `${viewport.width}: top`).toBeLessThanOrEqual(1)
      expect(Math.abs(camera.height - media.height), `${viewport.width}: height`).toBeLessThanOrEqual(1)
      expect(camera.height).toBeGreaterThan(250)
      // Landscape screens fit the whole training view: rail included, no vertical scroll.
      expect(rail.y + rail.height).toBeLessThanOrEqual(viewport.height + 1)
    } else {
      expect(media.y + media.height).toBeLessThanOrEqual(camera.y)
      expect(camera.height).toBeGreaterThanOrEqual(220)
    }

    // Secondary data is folded into 详细数据 and opens on demand.
    await expect(page.getByTestId('routine-feedback')).toBeHidden()
    await page.getByTestId('details-toggle').click()
    await expect(page.getByTestId('routine-feedback')).toBeVisible()
    await expect(page.getByTestId('routine-feedback')).toContainText('跟练相似度')
    await page.screenshot({ path: `test-results/routine-layout-baduanjin-${viewport.width}x${viewport.height}-details.png` })
    await page.getByTestId('details-close').click()
    await expect(page.getByTestId('routine-feedback')).toBeHidden()
    await page.screenshot({ path: `test-results/routine-layout-baduanjin-${viewport.width}x${viewport.height}.png`, fullPage: true })
  }
})

test('C2: Taijiquan keeps its 4:3 content viewport and black-bar crop treatment', async ({ page }) => {
  test.setTimeout(90_000)
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[3]]) {
    await page.setViewportSize(viewport)
    await openTraining(page, '/routines/taijiquan/train?fixture=synthetic')
    const media = await box(page.getByTestId('routine-stage-media'))
    expect(media.width / media.height).toBeCloseTo(4 / 3, 1)
    expect(await page.getByTestId('routine-stage-video').evaluate((video) => getComputedStyle(video).objectFit)).toBe('cover')
    const camera = await box(page.getByTestId('camera-stage'))
    expect(overlap(media, camera)).toBe(0)
    if (viewport.width > viewport.height) {
      expect(Math.abs(camera.y - media.y), `${viewport.width}: top`).toBeLessThanOrEqual(1)
      expect(Math.abs(camera.height - media.height), `${viewport.width}: height`).toBeLessThanOrEqual(1)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/routine-layout-taijiquan-${viewport.width}x${viewport.height}.png`, fullPage: true })
  }
})

test('C2: all four routines and a single-form route use the same immersive contract', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const id of ['baduanjin', 'wuqinxi', 'yijinjing']) {
    await openTraining(page, `/routines/${id}/train?fixture=synthetic`)
    expect(await page.getByTestId('routine-stage-video').evaluate((video) => getComputedStyle(video).objectFit), id).toBe('contain')
    await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-presenter', 'real')
  }
  await openTraining(page, '/routines/baduanjin/train?fixture=synthetic&form=bdj-1')
  await expect(page.getByRole('heading', { level: 1, name: /八段锦 · 第一式/ })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: /我的画面/ })).toBeVisible()
  const [demo, camera] = await Promise.all([box(page.locator('[data-layout-region="demonstration"]')), box(page.locator('[data-layout-region="camera"]'))])
  expect(demo.x + demo.width).toBeLessThanOrEqual(camera.x)
  await page.screenshot({ path: 'test-results/routine-layout-baduanjin-single-form-1440x900.png', fullPage: true })
})

test('C5: a requested presenter without a delivered, aligned asset falls back to the real-person video', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openTraining(page, '/routines/baduanjin/train?fixture=synthetic&presenter=digital-human')
  const stage = page.getByTestId('routine-stage')
  await expect(stage).toHaveAttribute('data-presenter', 'real')
  await expect(stage).toHaveAttribute('data-presenter-requested', 'digital-human')
  await expect(stage).toHaveAttribute('data-presenter-fallback', 'asset_missing')
  await expect(page.getByTestId('routine-stage-video')).toHaveAttribute('src', /baduanjin/)
  await expect(page.getByRole('heading', { level: 2, name: /标准示范 · 真人/ })).toBeVisible()
})
