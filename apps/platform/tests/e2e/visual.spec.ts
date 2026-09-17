import { expect, test } from '@playwright/test'

test('captures permanent Phase 2 desktop and mobile evidence', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1')
  await page.waitForTimeout(1600)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase2/training-lateral-raise.png' })

  await page.goto('/?demo=1&exercise=step_jack')
  await expect(page.getByRole('heading', { name: '今日训练 · 侧步开合专项' })).toBeVisible()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase2/training-step-jack.png' })

  await page.goto('/?demo=1&exercise=step_jack&debug=1')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase2/debug-step-jack.png', fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?demo=1&exercise=step_jack')
  await page.waitForTimeout(1000)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase2/mobile-training.png' })
})

test('captures permanent Phase 3 squat evidence', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1&exercise=squat')
  await expect(page.getByRole('heading', { name: '今日训练 · 徒手深蹲专项' })).toBeVisible()
  await page.waitForTimeout(1600)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase3/training-squat.png' })

  await page.goto('/?demo=1&exercise=squat&debug=1')
  await page.waitForTimeout(1600)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase3/squat-debug.png', fullPage: true })

  await page.goto('/?demo=1&fast=1&fixture=synthetic')
  await expect(page.getByRole('heading', { name: '今日训练 · 徒手深蹲专项' })).toBeVisible({ timeout: 25_000 })
  await page.screenshot({ path: 'test-results/regression-screenshots/phase3/three-exercise-session.png' })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?demo=1&exercise=squat')
  await page.waitForTimeout(1000)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase3/mobile-squat.png' })
})
