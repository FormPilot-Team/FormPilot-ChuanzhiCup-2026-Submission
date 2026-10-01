import { expect, test, type Locator, type Page } from '@playwright/test'
import { SCORING_CALIBRATION_STATEMENT } from '../../src/features/scoring/scoringBasis'
import { markOnboardingSeen } from './support/onboarding'

/**
 * Round-2 usability fixes from the real-person test: five equal mode cards, 评分依据, the coach's speech bubble, no
 * safe-zone frame on the camera, one media height on the follow-along stage and the 3-2-1 countdown on the camera.
 */

type Box = { x: number; y: number; width: number; height: number }

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
] as const

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function box(locator: Locator): Promise<Box> {
  const value = await locator.boundingBox()
  expect(value).not.toBeNull()
  return value as Box
}

/** Share of sample points under the bubble where the coach picture is opaque (her body, arms or hands). */
async function coachUnderBubble(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const image = document.querySelector<HTMLImageElement>('[data-testid="home-coach-image"]')!
    const bubble = document.querySelector('[data-testid="home-coach-welcome"]')!.getBoundingClientRect()
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const rect = image.getBoundingClientRect()
    let opaque = 0
    let total = 0
    for (let y = bubble.top + 2; y < bubble.bottom - 2; y += 3) {
      for (let x = bubble.left + 2; x < bubble.right - 2; x += 3) {
        if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) continue
        const px = Math.floor(((x - rect.left) / rect.width) * image.naturalWidth)
        const py = Math.floor(((y - rect.top) / rect.height) * image.naturalHeight)
        total += 1
        if (context.getImageData(px, py, 1, 1).data[3] > 60) opaque += 1
      }
    }
    return total ? opaque / total : 0
  })
}

test.beforeEach(async ({ page }) => { await markOnboardingSeen(page) })

test('Round2 A: five mode cards share one 开始训练 button, no odd corner text', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const ids = ['smart-training', 'baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']
  const buttons: string[] = []
  for (const id of ids) {
    const card = page.getByTestId(`mode-card-${id}`)
    await expect(card, id).toHaveAccessibleName(/^开始训练 · /)
    await expect(card.getByText('开始训练', { exact: true }), id).toBeVisible()
    await expect(card, id).not.toContainText(/开始跟练|可使用/)
    buttons.push(await card.getByText('开始训练', { exact: true }).evaluate((element) => {
      const style = getComputedStyle(element.parentElement!)
      return `${style.backgroundColor} ${style.color} ${style.borderRadius}`
    }))
  }
  expect(new Set(buttons).size, buttons.join(' | ')).toBe(1)
  await expect(page.getByTestId('home-training-modes').getByText('推荐').first()).toBeVisible()
  await expect(page.locator('.fp-mode-mark')).toHaveCount(0)
})

test('Round2 B: 评分依据 opens a light dialog with the three layers and the calibration statement', async ({ page }) => {
  for (const viewport of [VIEWPORTS[1], VIEWPORTS[3]]) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    const entry = page.getByTestId('home-scoring-basis')
    const guide = page.getByTestId('home-guide')
    await expect(entry).toBeVisible()
    // Next to 使用说明, on the same line and at the same size.
    const [entryBox, guideBox] = [await box(entry), await box(guide)]
    expect(Math.abs(entryBox.y - guideBox.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(entryBox.height - guideBox.height)).toBeLessThanOrEqual(1)
    await entry.click()
    const dialog = page.getByRole('dialog', { name: '评分依据' })
    await expect(dialog).toBeVisible()
    for (const title of ['动作规范来源', '机器分析指标', 'FormPilot 标定']) await expect(dialog.getByRole('heading', { name: title })).toBeVisible()
    await expect(dialog.getByTestId('scoring-basis-statement')).toHaveText(SCORING_CALIBRATION_STATEMENT)
    const dialogBox = await box(dialog)
    expect(dialogBox.x).toBeGreaterThanOrEqual(0)
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(entry).toBeFocused()
    await entry.click()
    await dialog.getByRole('button', { name: '关闭评分依据' }).click()
    await expect(dialog).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('Round2 C: the welcome is a speech bubble beside the coach, clear of her face, arms and hands', async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    const bubble = page.getByTestId('home-coach-welcome')
    await expect(bubble).toBeVisible()
    await expect(bubble.locator('[data-part="bubble-tail"]')).toBeAttached()
    // The tail leaves the bubble towards the coach.
    const [bubbleBox, tailBox, image] = [await box(bubble), await box(bubble.locator('[data-part="bubble-tail"]')), await box(page.getByTestId('home-coach-image'))]
    expect(tailBox.x + tailBox.width).toBeGreaterThan(bubbleBox.x + bubbleBox.width)
    expect(tailBox.x + tailBox.width / 2).toBeLessThan(image.x + image.width / 2)
    // Not a card on top of her: (almost) nothing of the picture under the bubble.
    expect(await coachUnderBubble(page), `${viewport.width}: coach under bubble`).toBeLessThanOrEqual(0.03)
    for (const id of ['home-guide', 'home-scoring-basis']) expect(overlaps(bubbleBox, await box(page.getByTestId(id))), `${viewport.width}: ${id}`).toBe(false)
    await page.screenshot({ path: `test-results/round2-home-${viewport.width}x${viewport.height}.png` })
  }
})

test('Round2 D: follow-along media share one height and the camera has no safe-zone frame', async ({ page }) => {
  test.setTimeout(150_000)
  for (const viewport of VIEWPORTS.slice(0, 3)) {
    await page.setViewportSize(viewport)
    for (const id of ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']) {
      await page.goto(`/routines/${id}/train?fixture=synthetic&gesture=manual`)
      await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-status', 'ready', { timeout: 20_000 })
      await expect(page.getByTestId('framing-status')).toBeVisible({ timeout: 10_000 })
      const [video, camera] = [await box(page.getByTestId('routine-stage-media')), await box(page.getByTestId('camera-stage'))]
      expect(Math.abs(video.y - camera.y), `${id} ${viewport.width}: top`).toBeLessThanOrEqual(1)
      expect(Math.abs(video.height - camera.height), `${id} ${viewport.width}: height`).toBeLessThanOrEqual(1)
      await expect(page.getByTestId('framing-safe-zone')).toHaveCount(0)
      // Pictures are never stretched: the video keeps its own aspect, the camera feed stays object-contain.
      const fit = await page.getByTestId('camera-stage').locator('[data-demo-source]').evaluate((element) => getComputedStyle(element).objectFit)
      expect(fit).toBe('contain')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  }
  await page.setViewportSize(VIEWPORTS[3])
  await page.goto('/routines/baduanjin/train?fixture=synthetic&gesture=manual')
  await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-status', 'ready', { timeout: 20_000 })
  // Stacked on a phone: the camera keeps its own 16:9 box.
  await expect(page.getByTestId('camera-stage')).toHaveAttribute('data-stage-height', 'own')
  const stage = await box(page.getByTestId('camera-stage'))
  expect(stage.width / stage.height).toBeCloseTo(16 / 9, 1)
})

test('Round2 E: warm-up camera shows no safe-zone frame and the feed is never cropped', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/train?demo=1&course=1&fixture=synthetic&gesture=manual&exercise=squat')
  await expect(page.getByTestId('framing-status')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('framing-safe-zone')).toHaveCount(0)
  // The live camera element (shown once the camera starts) letterboxes on a neutral surface instead of cropping.
  await page.goto('/train?course=1')
  const feed = page.getByTestId('camera-stage').locator('video')
  expect(await feed.evaluate((element) => getComputedStyle(element).objectFit)).toBe('contain')
  expect(await page.getByTestId('camera-stage').evaluate((element) => getComputedStyle(element).backgroundColor)).not.toMatch(/^rgb\(0, 0, 0\)$/)
})

async function countdownSteps(page: Page): Promise<string[]> {
  const seen: string[] = []
  const countdown = page.getByTestId('camera-countdown')
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline && !seen.includes('开始')) {
    const value = await countdown.getAttribute('data-countdown', { timeout: 100 }).catch(() => null)
    if (value && seen.at(-1) !== value) {
      seen.push(value)
      // Big, in the middle of the camera picture, and never in the way of a click.
      const [cue, stage] = [await box(countdown.getByRole('status')), await box(page.getByTestId('camera-stage'))]
      expect(cue.height).toBeGreaterThanOrEqual(100)
      expect(Math.abs(cue.x + cue.width / 2 - (stage.x + stage.width / 2))).toBeLessThanOrEqual(4)
      expect(Math.abs(cue.y + cue.height / 2 - (stage.y + stage.height / 2))).toBeLessThanOrEqual(4)
      expect(await countdown.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none')
    }
    await page.waitForTimeout(60)
  }
  return seen
}

test('Round2 F: a 3-2-1 → 开始 countdown appears on the camera before training starts', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/routines/baduanjin/train?fixture=synthetic')
  await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-status', 'ready', { timeout: 20_000 })
  expect(await countdownSteps(page)).toEqual(['3', '2', '1', '开始'])
  await expect(page.getByTestId('routine-state')).toHaveAttribute('data-course-state', 'ACTIVE')
  await expect(page.getByTestId('camera-countdown')).toHaveCount(0, { timeout: 3000 })

  await page.goto('/train?demo=1&course=1&fixture=synthetic')
  expect(await countdownSteps(page)).toEqual(['3', '2', '1', '开始'])
})

test('Round2 G: reduced motion keeps the countdown, as a plain switch', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/train?demo=1&course=1&fixture=synthetic')
  const step = page.getByTestId('camera-countdown').getByRole('status')
  await expect(step).toBeVisible({ timeout: 15_000 })
  const duration = await step.evaluate((element) => parseFloat(getComputedStyle(element).animationDuration))
  expect(duration).toBeLessThan(0.01)
})
