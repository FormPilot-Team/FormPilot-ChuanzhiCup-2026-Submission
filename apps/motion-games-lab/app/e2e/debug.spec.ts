// Formal mode hides every developer view; ?debug=1 shows the panel, the camera-window skeleton and
// the playfield body outline / landmarks — for all three games.
import { expect, test } from '@playwright/test'
import { shot, startGame, type Hook } from './helpers'

for (const game of ['apple', 'boating', 'archery'] as const) {
  test(`${game}: developer views only with ?debug=1`, async ({ page }) => {
    await startGame(page, game, '&duration=30')
    await expect(page.getByTestId('debug-panel')).toHaveCount(0)
    await expect(page.locator('.mirror')).toHaveAttribute('data-mirror-mode', 'hands')
    expect(await page.evaluate(() => (window as unknown as Hook).__mgl!.flags.debug)).toBe(false)

    await startGame(page, game, '&duration=30&debug=1')
    await expect(page.getByTestId('debug-panel')).toBeVisible()
    await expect(page.locator('.mirror')).toHaveAttribute('data-mirror-mode', 'skeleton')
    await page.waitForTimeout(2500)
    const expected = game === 'apple' ? 'TARGET_' : game === 'boating' ? 'STROKE_' : 'DRAW_'
    await expect(page.getByTestId('debug-panel')).toContainText(expected, { timeout: 15_000 })
    await shot(page, `debug-${game}`)
  })
}
