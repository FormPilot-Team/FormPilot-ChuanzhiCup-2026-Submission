// Desktop-release additions that also run in a browser: the product name, the 全屏 button (HTML
// Fullscreen API in a browser; the Tauri window API in the EXE — that path is verified by
// scripts/desktop-smoke.mjs against the installed app), and the hidden Ctrl+Shift+D debug toggle.
import { expect, test } from '@playwright/test'
import { collectErrors, expectFormalUi, shot } from './helpers'

test('Hub: product name, full screen on / off, hidden debug toggle', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/?source=synthetic')
  await expect(page).toHaveTitle('体感游戏工坊')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('体感游戏工坊')
  const button = page.getByTestId('fullscreen-button')
  await expect(button).toHaveText('⛶ 全屏')
  await expectFormalUi(page)
  await shot(page, 'hub')

  await button.click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
  await expect(button).toHaveText('退出全屏')
  await button.click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await expect(button).toHaveText('⛶ 全屏')

  // the developer panel stays hidden until Ctrl+Shift+D (the desktop app has no address bar)
  await page.keyboard.press('Control+Shift+D')
  await page.waitForURL(/debug=1/)
  await page.getByTestId('card-apple').getByRole('button', { name: '开始' }).click()
  await expect(page.getByTestId('debug-panel')).toBeVisible()
  await page.keyboard.press('Control+Shift+D')
  await page.waitForURL((u) => !u.searchParams.has('debug'))
  await expect(page.getByTestId('debug-panel')).toHaveCount(0)
  expect(errors).toEqual([])
})
