// Synthetic replay through the real UI: Game Hub → 说明 → 站位 → 识别+校准 → 倒计时 → 游戏 → tracking lost → 结果.
// The synthetic player produces MediaPipe-format landmarks, so the whole motion pipeline runs; it is
// NOT a substitute for testing with real people in front of a real camera.
import { expect, test, type Page } from '@playwright/test'

const SHOTS = '../docs/stage-ab/screenshots'
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` })

type Hook = { __mgl?: { synthetic?: { actor: { state: { present: boolean; leanDeg: number } }; bot: { paused: boolean } } | null; controller?: { holdProgress: number; round: { completed: number } } | null } }

test('Apple Picking runs from the Game Hub to the result page (synthetic player)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/?source=synthetic&duration=60&seed=5&missEvery=7')
  await expect(page.getByTestId('card-apple')).toBeVisible()
  await expect(page.getByTestId('card-boating').getByRole('button')).toBeDisabled()
  await expect(page.getByTestId('card-archery').getByRole('button')).toBeDisabled()
  await page.waitForTimeout(400)
  await shot(page, '00-game-hub')

  await page.getByTestId('card-apple').getByRole('button', { name: '开始' }).click()
  await expect(page.getByTestId('step-intro')).toBeVisible()
  await shot(page, '01-intro')

  await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByTestId('step-positioning')).toBeVisible()
  await shot(page, '02-positioning')

  await page.getByRole('button', { name: '打开摄像头' }).click()
  await expect(page.getByTestId('step-camera')).toBeVisible()
  await expect(page.getByText('很好，请保持不动')).toBeVisible()
  await shot(page, '03a-camera-check')
  await expect(page.getByTestId('calibration')).toBeVisible()
  await expect(page.getByText('慢慢举起左手')).toBeVisible()
  await page.waitForTimeout(600)
  await shot(page, '03b-calibration')

  await expect(page.getByTestId('countdown')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(900)
  await shot(page, '04-countdown')

  const play = page.getByTestId('apple-play')
  await expect(play).toHaveAttribute('data-status', 'playing', { timeout: 10_000 })
  // capture a moment while a hand is holding an apple (gold ring filling)
  await page.waitForFunction(() => {
    const c = (window as unknown as Hook).__mgl?.controller
    return Boolean(c && c.round.completed >= 2 && c.holdProgress > 0.45)
  }, undefined, { timeout: 30_000 })
  await shot(page, '05-playing')

  // posture hint: the synthetic player leans to one side
  await page.evaluate(() => { (window as unknown as Hook).__mgl!.synthetic!.actor.state.leanDeg = 15 })
  await expect(page.getByText('身体保持正直')).toBeVisible({ timeout: 5000 })
  await shot(page, '06-posture-hint')
  await page.evaluate(() => { (window as unknown as Hook).__mgl!.synthetic!.actor.state.leanDeg = 0 })

  // tracking lost: the player steps out of view → the game pauses itself
  await page.evaluate(() => { (window as unknown as Hook).__mgl!.synthetic!.actor.state.present = false })
  await expect(page.getByTestId('tracking-lost')).toBeVisible({ timeout: 5000 })
  await expect(play).toHaveAttribute('data-pause-reason', 'tracking')
  await shot(page, '07-tracking-lost')
  await page.evaluate(() => { (window as unknown as Hook).__mgl!.synthetic!.actor.state.present = true })
  await expect(play).toHaveAttribute('data-status', 'playing', { timeout: 5000 })

  // one-key pause
  await page.keyboard.press('Space')
  await expect(page.getByTestId('paused')).toBeVisible()
  await shot(page, '08-paused')
  await page.getByTestId('paused').getByRole('button', { name: '▶ 继续' }).click()
  await expect(play).toHaveAttribute('data-status', 'playing')

  await expect(page.getByTestId('result')).toBeVisible({ timeout: 90_000 })
  await page.waitForTimeout(400)
  await shot(page, '09-result')
  const completed = (await page.getByTestId('result-completed').textContent())!.split('/').map((s) => Number(s.trim()))
  expect(completed[0]).toBeGreaterThan(10)
  expect(completed[1]).toBeGreaterThanOrEqual(completed[0])
  expect(Number(await page.getByTestId('result-score').textContent())).toBeGreaterThan(0)

  await page.getByRole('button', { name: '查看简单动作反馈' }).click()
  await expect(page.getByTestId('feedback')).toContainText('身体侧倾提醒')
  await shot(page, '10-result-feedback')

  // no developer wording in the normal UI
  const text = await page.locator('body').innerText()
  for (const banned of ['Phase', '实验', 'landmark', 'JSON', 'detector', 'ROM']) expect(text).not.toContain(banned)
  expect(errors).toEqual([])
})

test('developer information stays hidden unless ?debug=1', async ({ page }) => {
  await page.goto('/?source=synthetic&duration=30')
  await page.getByTestId('card-apple').getByRole('button', { name: '开始' }).click()
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '打开摄像头' }).click()
  await expect(page.getByTestId('step-camera')).toBeVisible()
  await expect(page.getByTestId('debug-panel')).toHaveCount(0)

  await page.goto('/?source=synthetic&duration=30&debug=1')
  await page.getByTestId('card-apple').getByRole('button', { name: '开始' }).click()
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '打开摄像头' }).click()
  await expect(page.getByTestId('debug-panel')).toBeVisible()
  await expect(page.getByTestId('apple-play')).toHaveAttribute('data-status', 'playing', { timeout: 30_000 })
  await page.waitForFunction(() => Boolean((window as unknown as Hook).__mgl?.controller?.round.completed))
  await expect(page.getByTestId('debug-panel')).toContainText('TARGET_')
  await page.screenshot({ path: `${SHOTS}/11-debug-mode.png` })
})
