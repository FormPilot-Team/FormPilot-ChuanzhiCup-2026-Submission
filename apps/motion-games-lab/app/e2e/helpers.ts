// Shared steps for the e2e specs: synthetic player, Game Hub → intro → positioning → camera/calibration.
import { expect, type Page } from '@playwright/test'

export const SHOTS = '../docs/round-1-fixes/screenshots'
export const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` })

export type Hook = {
  __mgl?: {
    game: string
    flags: { debug: boolean }
    synthetic?: { actor: { state: { present: boolean; leanDeg: number; twistDeg: number } }; bot: { paused: boolean } } | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller?: any
  }
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  return errors
}

/** From the Game Hub to "playing" with the synthetic player. Optional screenshots of each step. */
export async function startGame(page: Page, game: 'apple' | 'boating' | 'archery', query: string, prefix?: string): Promise<void> {
  await page.goto(`/?source=synthetic${query}`)
  await expect(page.getByTestId(`card-${game}`)).toBeVisible()
  await page.getByTestId(`card-${game}`).getByRole('button', { name: '开始' }).click()
  await expect(page.getByTestId('step-intro')).toBeVisible()
  if (prefix) await shot(page, `${prefix}-01-intro`)
  await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByTestId('step-positioning')).toBeVisible()
  await page.getByRole('button', { name: '打开摄像头' }).click()
  await expect(page.getByTestId('step-camera')).toBeVisible()
  await expect(page.getByTestId('calibration')).toBeVisible({ timeout: 15_000 })
  if (prefix) {
    await page.waitForTimeout(500)
    await shot(page, `${prefix}-02-calibration`)
  }
  await expect(page.getByTestId('countdown')).toBeVisible({ timeout: 20_000 })
  if (prefix) {
    await page.waitForTimeout(900)
    await shot(page, `${prefix}-03-countdown`)
  }
  await expect(page.getByTestId(`${game}-play`)).toHaveAttribute('data-status', 'playing', { timeout: 10_000 })
}

/** Leave the picture → automatic pause → come back → automatic resume. */
export async function trackingLossRoundTrip(page: Page, game: string, screenshot?: string): Promise<void> {
  const play = page.getByTestId(`${game}-play`)
  await page.evaluate(() => { (window as unknown as Hook).__mgl!.synthetic!.actor.state.present = false })
  await expect(page.getByTestId('tracking-lost')).toBeVisible({ timeout: 5000 })
  await expect(play).toHaveAttribute('data-pause-reason', 'tracking')
  if (screenshot) await shot(page, screenshot)
  await page.evaluate(() => { (window as unknown as Hook).__mgl!.synthetic!.actor.state.present = true })
  await expect(play).toHaveAttribute('data-status', 'playing', { timeout: 6000 })
}

/** Space pauses, the overlay's 继续 resumes. */
export async function pauseRoundTrip(page: Page, game: string, screenshot?: string): Promise<void> {
  const play = page.getByTestId(`${game}-play`)
  await page.keyboard.press('Space')
  await expect(page.getByTestId('paused')).toBeVisible()
  if (screenshot) await shot(page, screenshot)
  await page.getByTestId('paused').getByRole('button', { name: '▶ 继续' }).click()
  await expect(play).toHaveAttribute('data-status', 'playing')
}

/** The formal UI shows hand markers (no skeleton) and no developer wording. */
export async function expectFormalUi(page: Page): Promise<void> {
  await expect(page.locator('[data-mirror-mode="skeleton"]')).toHaveCount(0)
  await expect(page.getByTestId('debug-panel')).toHaveCount(0)
  const text = await page.locator('body').innerText()
  for (const banned of ['Phase', '实验', 'landmark', 'JSON', 'detector', 'ROM', 'skeleton']) expect(text).not.toContain(banned)
}
