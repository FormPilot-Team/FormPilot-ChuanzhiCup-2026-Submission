// Apple Picking through the real UI with the synthetic player: Game Hub → 说明 → 站位 → 识别+校准 →
// 倒计时 → 游戏 (hand cursors, hold, pick) → posture hint → tracking lost → pause → 结果.
// The synthetic player produces MediaPipe-format landmarks, so the whole motion pipeline runs; it is
// NOT a substitute for testing with real people in front of a real camera.
import { expect, test } from '@playwright/test'
import { collectErrors, expectFormalUi, pauseRoundTrip, shot, startGame, trackingLossRoundTrip, type Hook } from './helpers'

test('Apple Picking: hub to result with the hand-cursor interaction (synthetic player)', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/?source=synthetic')
  for (const id of ['apple', 'boating', 'archery']) await expect(page.getByTestId(`card-${id}`).getByRole('button', { name: '开始' })).toBeEnabled()
  await page.waitForTimeout(400)
  await shot(page, '00-game-hub')

  await startGame(page, 'apple', '&duration=60&seed=5&missEvery=7', 'apple')
  const play = page.getByTestId('apple-play')
  await expectFormalUi(page)
  await expect(page.locator('.mirror')).toHaveAttribute('data-mirror-mode', 'hands')

  // half-closed hand while the gold ring fills
  await page.waitForFunction(() => {
    const c = (window as unknown as Hook).__mgl?.controller
    if (!c || c.round.completed < 2 || c.holdProgress < 0.45 || !c.holdingSide) return false
    return c.cursor(c.holdingSide).pose === 'half'
  }, undefined, { timeout: 30_000 })
  await shot(page, 'apple-04-holding')
  // the fist appears only after the hold completes
  await page.waitForFunction(() => {
    const c = (window as unknown as Hook).__mgl?.controller
    return Boolean(c && (c.cursor('left').pose === 'grab' || c.cursor('right').pose === 'grab'))
  }, undefined, { timeout: 15_000 })
  await shot(page, 'apple-05-picked')

  // posture hint: the synthetic player leans to one side → a small hint pill, not a big banner
  await page.evaluate(() => { (window as unknown as Hook).__mgl!.synthetic!.actor.state.leanDeg = 15 })
  await expect(page.getByTestId('hint-pill')).toContainText('身体保持正直', { timeout: 5000 })
  await shot(page, 'apple-06-posture-hint')
  await page.evaluate(() => { (window as unknown as Hook).__mgl!.synthetic!.actor.state.leanDeg = 0 })

  await trackingLossRoundTrip(page, 'apple', 'apple-07-tracking-lost')
  await pauseRoundTrip(page, 'apple', 'apple-08-paused')

  await expect(page.getByTestId('result')).toBeVisible({ timeout: 90_000 })
  await page.waitForTimeout(400)
  await shot(page, 'apple-09-result')
  const completed = (await page.getByTestId('result-completed').textContent())!.split('/').map((s) => Number(s.trim()))
  expect(completed[0]).toBeGreaterThan(10)
  expect(completed[1]).toBeGreaterThanOrEqual(completed[0])
  expect(Number(await page.getByTestId('result-score').textContent())).toBeGreaterThan(0)
  await expect(play).toHaveCount(0)

  await page.getByRole('button', { name: '查看简单动作反馈' }).click()
  await expect(page.getByTestId('feedback')).toContainText('身体侧倾提醒')
  await shot(page, 'apple-10-feedback')
  await expectFormalUi(page)

  // 再玩一次 starts a fresh round on the same camera session
  await page.getByRole('button', { name: '再玩一次' }).click()
  await expect(page.getByTestId('countdown')).toBeVisible()
  await expect(page.getByTestId('apple-play')).toHaveAttribute('data-status', 'playing', { timeout: 10_000 })
  await page.getByRole('button', { name: 'Ⅱ 暂停' }).click()
  await page.getByTestId('paused').getByRole('button', { name: '返回游戏选择' }).click()
  await expect(page.getByTestId('card-apple')).toBeVisible()
  expect(errors).toEqual([])
})
