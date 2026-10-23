// Round-1 playtest regressions in the real UI: one hand-cursor design for both hands (formal mode),
// Boating's live stroke guidance (从这里开始 label, ghost-hand demo, track fill), the 1/2/3-minute
// round options on every game and in the settings dialog, and the seated stance illustration.
import { expect, test, type Page } from '@playwright/test'
import { collectErrors, shot, startGame, type Hook } from './helpers'

type GameHook = { __mglGame?: { scene: { getScenes(active: boolean): { sys: { settings: { key: string } }; textures: { get(key: string): { getSourceImage(): HTMLCanvasElement } }; children: { getByName(name: string): { alpha: number } | null } }[] } } }

/** Mean colour of the opaque pixels of each painted hand texture. */
async function handColours(page: Page) {
  return page.evaluate(() => {
    const game = (window as unknown as GameHook).__mglGame!
    const scene = game.scene.getScenes(true)[0]
    const out: Record<string, [number, number, number]> = {}
    for (const side of ['left', 'right']) {
      for (const pose of ['open', 'half', 'grab']) {
        const canvas = scene.textures.get(`hand-${side}-${pose}`).getSourceImage()
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        let r = 0, g = 0, b = 0, n = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 220) continue
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1
        }
        out[`${side}-${pose}`] = [r / n, g / n, b / n]
      }
    }
    return out
  })
}

for (const game of ['apple', 'boating', 'archery'] as const) {
  test(`${game}: both hand cursors look the same (no colour coding), warm white`, async ({ page }) => {
    const errors = collectErrors(page)
    await startGame(page, game, '&duration=30&seed=5')
    const colours = await handColours(page)
    for (const pose of ['open', 'half', 'grab']) {
      const [l, r] = [colours[`left-${pose}`], colours[`right-${pose}`]]
      for (let k = 0; k < 3; k += 1) expect(Math.abs(l[k] - r[k]), `${pose} channel ${k}`).toBeLessThan(2)
      // warm white: bright, red ≥ green ≥ blue (not the old teal / orange)
      expect(l[0]).toBeGreaterThan(200)
      expect(l[0]).toBeGreaterThanOrEqual(l[1])
      expect(l[1]).toBeGreaterThanOrEqual(l[2])
    }
    await page.waitForTimeout(1500)
    await shot(page, `cursor-${game}`)
    expect(errors).toEqual([])
  })
}

test('Boating: the stroke track teaches the motion — start label, ghost-hand demo, live fill', async ({ page }) => {
  const errors = collectErrors(page)
  await startGame(page, 'boating', '&duration=60&seed=5')
  const label = (side: string) => page.evaluate((s) => {
    const scene = (window as unknown as GameHook).__mglGame!.scene.getScenes(true)[0]
    return scene.children.getByName(`start-${s}`)?.alpha ?? -1
  }, side)
  await expect.poll(() => label('left'), { timeout: 5000 }).toBeGreaterThan(0.6)
  await expect.poll(() => label('right'), { timeout: 5000 }).toBeGreaterThan(0.6)

  // a stroke under way: the track fills (progress) before the stroke counts
  await page.waitForFunction(() => {
    const c = (window as unknown as Hook).__mgl?.controller
    return Boolean(c && ['left', 'right'].some((s) => c.oar(s).progress > 0.4 && c.oar(s).progress < 1 && !c.oar(s).returning))
  }, undefined, { timeout: 20_000 })
  await shot(page, 'boating-r1-track-filling')

  // once both sides have paddled a couple of times the start labels fade away
  await page.waitForFunction(() => {
    const c = (window as unknown as Hook).__mgl?.controller
    return Boolean(c && c.oar('left').strokes >= 2 && c.oar('right').strokes >= 2)
  }, undefined, { timeout: 20_000 })
  await expect.poll(() => label('left'), { timeout: 5000 }).toBeLessThan(0.15)

  // the player stops: after a while the ghost hand demonstrates the stroke again (a few loops only)
  await page.evaluate(() => {
    const s = (window as unknown as Hook).__mgl!.synthetic as unknown as { bot: { paused: boolean }; actor: { rest(side: string): void } }
    s.bot.paused = true
    s.actor.rest('left')
    s.actor.rest('right')
  })
  const demo = () => page.evaluate(() => {
    const scene = (window as unknown as GameHook).__mglGame!.scene.getScenes(true)[0] as unknown as { demoState(): unknown }
    return scene.demoState() !== null
  })
  await expect.poll(demo, { timeout: 20_000, intervals: [250] }).toBe(true)
  await page.waitForTimeout(500)
  await shot(page, 'boating-r1-ghost-demo')
  await expect.poll(demo, { timeout: 15_000, intervals: [250] }).toBe(false)
  expect(errors).toEqual([])
})

test('round length: 1 / 2 / 3 minutes only, one even row, on every game and in the settings', async ({ page }) => {
  await page.goto('/?source=synthetic')
  const check = async () => {
    const options = page.getByTestId('round-options').getByRole('button')
    await expect(options).toHaveText(['1 分钟', '2 分钟', '3 分钟'])
    const boxes = await Promise.all((await options.all()).map((b) => b.boundingBox()))
    for (const box of boxes) {
      expect(Math.abs(box!.y - boxes[0]!.y)).toBeLessThan(1)
      expect(Math.abs(box!.width - boxes[0]!.width)).toBeLessThan(1.5)
    }
    await expect(page.getByText('4 分钟')).toHaveCount(0)
  }
  for (const game of ['apple', 'boating', 'archery'] as const) {
    await page.getByTestId(`card-${game}`).getByRole('button', { name: '开始' }).click()
    await expect(page.getByTestId('step-intro')).toBeVisible()
    await check()
    await shot(page, `intro-${game}`)
    await page.getByRole('button', { name: '← 返回' }).click()
  }
  await page.getByRole('button', { name: '⚙ 设置' }).click()
  await check()
  await shot(page, 'settings-dialog')
})

test('seated stance illustration: both legs drawn, clear of the chair legs', async ({ page }) => {
  await page.goto('/?source=synthetic')
  await page.getByTestId('card-apple').getByRole('button', { name: '开始' }).click()
  await page.getByRole('button', { name: '坐着玩' }).click()
  await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByTestId('step-positioning')).toBeVisible()
  const legs = page.getByTestId('seated-legs').locator('path')
  await expect(legs).toHaveCount(2)
  const [l, r] = await Promise.all([legs.nth(0).boundingBox(), legs.nth(1).boundingBox()])
  // two separate legs of about the same length, side by side
  expect(r!.x).toBeGreaterThan(l!.x + l!.width * 0.5)
  expect(Math.abs(l!.height - r!.height)).toBeLessThan(2)
  expect(l!.height).toBeGreaterThan(30)
  await shot(page, 'positioning-seated')
  await page.getByRole('button', { name: '← 上一步' }).click()
  await page.getByRole('button', { name: '站着玩' }).click()
  await page.getByRole('button', { name: '下一步' }).click()
  await shot(page, 'positioning-standing')
})
