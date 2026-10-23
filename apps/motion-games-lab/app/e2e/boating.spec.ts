// Boating through the real UI with the synthetic paddler (scheme A, outward sweep).
import { expect, test } from '@playwright/test'
import { collectErrors, expectFormalUi, pauseRoundTrip, shot, startGame, trackingLossRoundTrip, type Hook } from './helpers'

test('Boating: hub to result — strokes move the boat, lanterns, flow, pause and tracking loss', async ({ page }) => {
  const errors = collectErrors(page)
  await startGame(page, 'boating', '&duration=45&seed=5', 'boating')
  await expectFormalUi(page)
  await expect(page.locator('.mirror')).toHaveAttribute('data-mirror-mode', 'hands')

  // a stroke under way: the hand cursor half-closes on its track
  await page.waitForFunction(() => {
    const c = (window as unknown as Hook).__mgl?.controller
    return Boolean(c && c.round.strokeCount() >= 2 && (c.oar('left').pose === 'half' || c.oar('right').pose === 'half'))
  }, undefined, { timeout: 20_000 })
  await shot(page, 'boating-04-stroke')

  // the boat moves only with strokes; steady alternation turns on "flow"
  await page.waitForFunction(() => (window as unknown as Hook).__mgl?.controller?.round.flow === true, undefined, { timeout: 20_000 })
  await expect(page.locator('.flow-chip')).toBeVisible()
  const distance = Number(await page.getByTestId('hud-distance').evaluate((el) => el.firstChild?.textContent ?? '0'))
  expect(distance).toBeGreaterThan(5)
  await page.waitForFunction(() => (window as unknown as Hook).__mgl?.controller?.round.result('quit').completed >= 1, undefined, { timeout: 20_000 })
  await shot(page, 'boating-05-flow-lantern')

  // stopping paddling: the boat glides and slows down (self-paced, nothing is lost)
  await page.evaluate(() => { (window as unknown as Hook).__mgl!.synthetic!.bot.paused = true })
  await page.waitForTimeout(4000)
  const speed = await page.evaluate(() => (window as unknown as Hook).__mgl!.controller.round.speed)
  expect(speed).toBeLessThan(1)
  await page.evaluate(() => { (window as unknown as Hook).__mgl!.synthetic!.bot.paused = false })

  await trackingLossRoundTrip(page, 'boating', 'boating-06-tracking-lost')
  await pauseRoundTrip(page, 'boating', 'boating-07-paused')

  await expect(page.getByTestId('result')).toBeVisible({ timeout: 90_000 })
  await page.waitForTimeout(400)
  await expect(page.getByTestId('result-highlight')).toContainText('划行距离')
  await expect(page.getByText('花灯收集率')).toBeVisible()
  await shot(page, 'boating-08-result')
  await page.getByRole('button', { name: '查看简单动作反馈' }).click()
  await expect(page.getByTestId('feedback')).toContainText('左右交替')
  await shot(page, 'boating-09-feedback')
  await expectFormalUi(page)
  expect(errors).toEqual([])
})
