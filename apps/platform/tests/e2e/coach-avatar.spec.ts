import { expect, test, type Locator } from '@playwright/test'
import { COACH_AVATAR_ASSET } from '../../src/components/coach/coachIdentity'
import { markOnboardingSeen } from './support/onboarding'

// Small coach pictures are the Family A bust (COACH_AVATAR_ASSET), never a full-body figure squeezed into a circle.

async function expectBust(avatar: Locator, size: number) {
  const image = avatar.locator('img')
  await expect(image).toHaveAttribute('src', COACH_AVATAR_ASSET.src)
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => (element.complete ? element.naturalWidth : 0))).toBe(COACH_AVATAR_ASSET.width)
  const box = await avatar.boundingBox()
  expect(box?.width).toBeCloseTo(size, 0)
  expect(box?.height).toBeCloseTo(size, 0)
  // A full circle (Tailwind 4 writes rounded-full as an infinite radius).
  expect(await avatar.evaluate((element) => Number.parseFloat(getComputedStyle(element).borderRadius))).toBeGreaterThanOrEqual(size / 2)
}

test.beforeEach(async ({ page }) => {
  await markOnboardingSeen(page)
})

test('Avatar A: the follow-along 实时反馈 card shows the coach bust at 40 px', async ({ page }) => {
  await page.goto('/routines/baduanjin/train?fixture=synthetic')
  // Web V1.1 C2: the 实时反馈 card lives in 详细数据 (the training view keeps one coaching line).
  await page.getByTestId('details-toggle').click()
  const entry = page.getByTestId('routine-coach-entry')
  await expect(entry).toContainText('AI 教练')
  await expectBust(entry.getByTestId('coach-avatar'), 40)
  await expect(page.locator('img[src="/assets/overhead-raise-demo-start.png"]')).toHaveCount(0)
})

test('Avatar B: the 问 AI 教练 button and its panel use the same bust', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  // Web V1: the dock is no longer on Home; History keeps it.
  await page.goto('/history')
  const trigger = page.getByTestId('ai-coach-trigger')
  await expectBust(trigger.getByTestId('coach-avatar'), 40)
  await trigger.click()
  const panel = page.getByTestId('ai-coach-panel')
  await expectBust(panel.getByTestId('coach-avatar').first(), 40)
})
