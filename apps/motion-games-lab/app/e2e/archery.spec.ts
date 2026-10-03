// Archery through the real UI with the synthetic archer:
// READY → DRAW → HOLD → RETURN_ARMED → FIRE → HIT → RESET (round 2: the shot = string hand back to the chest).
import { expect, test } from '@playwright/test'
import { collectErrors, expectFormalUi, pauseRoundTrip, shot, SHOTS, startGame, trackingLossRoundTrip, type Hook } from './helpers'

// page-side code is serialised: no closures over Node-side helpers, only these (type-only) shapes
type Archer = { actor: { goal: Record<'left' | 'right', { x: number; y: number }>; state: { twistDeg: number } }; bot: { paused: boolean } }

test('Archery: hub to result — draw, aim, hold, ghost guide, return to fire, hit, pause and tracking loss', async ({ page }) => {
  const errors = collectErrors(page)
  await startGame(page, 'archery', '&duration=50&seed=5&missEvery=3', 'archery')
  await expectFormalUi(page)
  const phase = () => page.evaluate(() => (window as unknown as Hook).__mgl!.controller.phase())
  const shots = () => page.evaluate(() => (window as unknown as Hook).__mgl!.controller.round.shots.length as number)

  // DRAW → HOLD: the reticle tightens; the instruction says aim with the bow hand — never 松 / 伸直
  await page.waitForFunction(() => (window as unknown as Hook).__mgl?.controller?.draw().phase === 'hold', undefined, { timeout: 20_000 })
  await page.waitForTimeout(250)
  await expect(page.getByTestId('instruction')).toContainText('瞄准')
  await shot(page, 'archery-04-hold')

  // RETURN_ARMED: the player waits → the ghost hand shows the way back to the chest (first arrow only)
  await page.waitForFunction(() => (window as unknown as Hook).__mgl?.controller?.draw().phase === 'armed', undefined, { timeout: 10_000 })
  await page.evaluate(() => { ((window as unknown as Hook).__mgl!.synthetic as unknown as Archer).bot.paused = true })
  await expect(page.getByTestId('instruction')).toContainText('收回胸前')
  await page.waitForFunction(() => (window as unknown as Hook).__mgl!.controller.ghostGuide() === true, undefined, { timeout: 5000 })
  await page.waitForTimeout(700)
  await shot(page, 'archery-05-ghost-guide')

  // the return begins (a quarter of the way): the ghost hides at once, the aim locks, the ring fills — no shot yet
  await page.evaluate(() => { ((window as unknown as Hook).__mgl!.synthetic as unknown as Archer).actor.goal.right = { x: 0.39, y: 0.07 } })
  await page.waitForFunction(() => (window as unknown as Hook).__mgl!.controller.draw()?.returning === true, undefined, { timeout: 5000 })
  await page.waitForTimeout(300)
  const mid = await page.evaluate(() => ({ d: (window as unknown as Hook).__mgl!.controller.draw(), ghost: (window as unknown as Hook).__mgl!.controller.ghostGuide() }))
  expect(mid.ghost).toBe(false)
  expect(mid.d.lockedAim).not.toBeNull()
  expect(mid.d.returnProgress).toBeGreaterThan(0.2)
  expect(await shots()).toBe(0)
  await expect(page.getByTestId('instruction')).toContainText('继续收回')
  await shot(page, 'archery-06-returning')

  // keep coming back → FIRE → the arrow lands on the locked aim
  await page.evaluate(() => { ((window as unknown as Hook).__mgl!.synthetic as unknown as Archer).bot.paused = false })
  await page.waitForFunction(() => (window as unknown as Hook).__mgl?.controller?.phase() === 'HIT', undefined, { timeout: 10_000 })
  await page.waitForTimeout(650)
  await shot(page, 'archery-07-hit')
  expect(['HIT', 'RESET', 'READY']).toContain(await phase())
  const first = await page.evaluate(() => (window as unknown as Hook).__mgl!.controller.round.shots[0])
  expect(first.ring).not.toBeNull()
  await page.waitForFunction(() => (window as unknown as Hook).__mgl?.controller?.round.shots.length >= 3, undefined, { timeout: 30_000 })

  // a turned torso never blocks the game any more: arrows keep flying (at most a soft line)
  const before = await shots()
  await page.evaluate(() => { ((window as unknown as Hook).__mgl!.synthetic as unknown as Archer).actor.state.twistDeg = 45 })
  await page.waitForFunction((n) => (window as unknown as Hook).__mgl!.controller.round.shots.length >= n + 2, before, { timeout: 20_000 })
  await shot(page, 'archery-08-turned-still-shoots')
  await page.evaluate(() => { ((window as unknown as Hook).__mgl!.synthetic as unknown as Archer).actor.state.twistDeg = 0 })

  await trackingLossRoundTrip(page, 'archery', 'archery-09-tracking-lost')
  await pauseRoundTrip(page, 'archery', 'archery-10-paused')

  await expect(page.getByTestId('result')).toBeVisible({ timeout: 90_000 })
  await page.waitForTimeout(400)
  await expect(page.getByTestId('result-highlight')).toContainText('正中靶心')
  await expect(page.getByText('命中率')).toBeVisible()
  const completed = (await page.getByTestId('result-completed').textContent())!.split('/').map((s) => Number(s.trim()))
  expect(completed[1]).toBeGreaterThanOrEqual(5)
  await shot(page, 'archery-11-result')
  await page.getByRole('button', { name: '查看简单动作反馈' }).click()
  await expect(page.getByTestId('feedback')).toContainText('平均稳定度')
  await shot(page, 'archery-12-feedback')
  await expectFormalUi(page)
  expect(errors).toEqual([])
})

test('Archery: the tutorial teaches draw → aim → bring the string hand back (no 松)', async ({ page }) => {
  await page.goto('/?source=synthetic')
  await page.getByTestId('card-archery').getByRole('button', { name: '开始' }).click()
  const intro = page.getByTestId('step-intro')
  await expect(intro).toBeVisible()
  await expect(intro).toContainText('把拉弦的手收回胸前')
  await expect(intro).toContainText('上下移动持弓的手')
  await expect(intro).not.toContainText(/松手|松一|一松/)
  await expect(intro).not.toContainText('伸直')
  await expect(intro.locator('.how-item svg')).toHaveCount(3)
  await intro.locator('.how').screenshot({ path: `${SHOTS}/archery-tutorial-cards.png` })
  await shot(page, 'archery-tutorial')
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
  await shot(page, 'archery-13-left-hand')
})
