// Archery through the real UI with the synthetic archer: READY → DRAW → HOLD → RELEASE → HIT → RESET.
import { expect, test } from '@playwright/test'
import { collectErrors, expectFormalUi, pauseRoundTrip, shot, startGame, trackingLossRoundTrip, type Hook } from './helpers'

test('Archery: hub to result — draw, hold, release, hit, guards, pause and tracking loss', async ({ page }) => {
  const errors = collectErrors(page)
  await startGame(page, 'archery', '&duration=45&seed=5&missEvery=3', 'archery')
  await expectFormalUi(page)
  const phase = () => page.evaluate(() => (window as unknown as Hook).__mgl!.controller.phase())

  // DRAW → HOLD: the reticle tightens and the instruction says 稳住 / 松手
  await page.waitForFunction(() => (window as unknown as Hook).__mgl?.controller?.draw().phase === 'hold', undefined, { timeout: 20_000 })
  await page.waitForTimeout(350)
  await shot(page, 'archery-04-hold')
  await page.waitForFunction(() => (window as unknown as Hook).__mgl?.controller?.draw().phase === 'armed', undefined, { timeout: 10_000 })
  await expect(page.getByTestId('instruction')).toContainText('松手')
  await shot(page, 'archery-05-armed')

  // RELEASE → HIT
  await page.waitForFunction(() => (window as unknown as Hook).__mgl?.controller?.phase() === 'HIT', undefined, { timeout: 10_000 })
  await page.waitForTimeout(650)
  await shot(page, 'archery-06-hit')
  expect(['HIT', 'RESET', 'READY']).toContain(await phase())
  await page.waitForFunction(() => (window as unknown as Hook).__mgl?.controller?.round.shots.length >= 3, undefined, { timeout: 30_000 })

  // torso-rotation guard: turning the body while drawing never shoots
  const shotsBefore = await page.evaluate(() => (window as unknown as Hook).__mgl!.controller.round.shots.length)
  await page.evaluate(() => { (window as unknown as Hook).__mgl!.synthetic!.actor.state.twistDeg = 45 })
  await expect(page.getByTestId('hint-pill')).toContainText('身体正对屏幕', { timeout: 10_000 })
  await shot(page, 'archery-07-guard-turned')
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => (window as unknown as Hook).__mgl!.controller.round.shots.length)).toBe(shotsBefore)
  await page.evaluate(() => { (window as unknown as Hook).__mgl!.synthetic!.actor.state.twistDeg = 0 })

  await trackingLossRoundTrip(page, 'archery', 'archery-08-tracking-lost')
  await pauseRoundTrip(page, 'archery', 'archery-09-paused')

  await expect(page.getByTestId('result')).toBeVisible({ timeout: 90_000 })
  await page.waitForTimeout(400)
  await expect(page.getByTestId('result-highlight')).toContainText('正中靶心')
  await expect(page.getByText('命中率')).toBeVisible()
  const completed = (await page.getByTestId('result-completed').textContent())!.split('/').map((s) => Number(s.trim()))
  expect(completed[1]).toBeGreaterThanOrEqual(5)
  await shot(page, 'archery-10-result')
  await page.getByRole('button', { name: '查看简单动作反馈' }).click()
  await expect(page.getByTestId('feedback')).toContainText('平均稳定度')
  await shot(page, 'archery-11-feedback')
  await expectFormalUi(page)
  expect(errors).toEqual([])
})

test('Archery: left-hand string mirrors the range', async ({ page }) => {
  await page.goto('/?source=synthetic&duration=20')
  await page.getByTestId('card-archery').getByRole('button', { name: '开始' }).click()
  await page.getByRole('button', { name: '左手' }).click()
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '打开摄像头' }).click()
  await expect(page.getByTestId('archery-play')).toHaveAttribute('data-status', 'playing', { timeout: 30_000 })
  await page.waitForFunction(() => (window as unknown as Hook).__mgl?.controller?.round.shots.length >= 1, undefined, { timeout: 30_000 })
  expect(await page.evaluate(() => (window as unknown as Hook).__mgl!.controller.drawSide)).toBe('left')
  await shot(page, 'archery-12-left-hand')
})
