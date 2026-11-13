import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { markOnboardingSeen } from '../e2e/support/onboarding'

// Runs against an UNZIPPED competition package started by its own launcher (no dev server, no Node on the page side).
const OUT = process.env.FP_EVIDENCE_DIR ?? 'test-results-package-smoke/evidence'
const ROUTINES = ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing'] as const
const results: Record<string, unknown> = {}

test.beforeEach(async ({ page }) => { await markOnboardingSeen(page) })
test.afterAll(() => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'package-smoke.json'), `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`)
})

for (const id of ROUTINES) {
  test(`routine ${id}: the packaged standard demonstration video loads and is playable`, async ({ page }) => {
    await page.goto(`/routines/${id}/train`)
    await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-status', 'ready', { timeout: 45_000 })
    const video = await page.getByTestId('routine-demo-video').evaluate((node) => {
      const element = node as HTMLVideoElement
      return { src: element.currentSrc.replace(location.origin, ''), readyState: element.readyState, duration: Math.round(element.duration), width: element.videoWidth, height: element.videoHeight, error: element.error?.code ?? null }
    })
    results[`routine-${id}`] = video
    expect(video.error).toBeNull()
    expect(video.readyState).toBeGreaterThanOrEqual(2)
    expect(video.duration).toBeGreaterThan(60)
    expect(video.width).toBeGreaterThan(0)
    await page.screenshot({ path: join(OUT, `routine-${id}.png`) })
  })
}

test('games: the packaged Motion Games Lab service answers and the games board sees it', async ({ page, request }) => {
  const games = await request.get('http://localhost:5181/')
  expect(games.status()).toBe(200)
  expect(await games.text()).toContain('<div id="root"')
  await page.goto('/games')
  await expect(page.getByTestId('games-service')).toContainText('体感游戏服务已连接', { timeout: 20_000 })
  const cards = await page.locator('[data-testid^="game-card-"]').count()
  results.games = { status: games.status(), cards }
  expect(cards).toBe(3)
  await page.screenshot({ path: join(OUT, 'games.png') })
})

test('six boards, training center, workshop and history open from the package', async ({ page }) => {
  const opened: Record<string, string> = {}
  for (const [path, testId] of [['/', 'web-topbar'], ['/training', 'web-topbar'], ['/routines', 'web-topbar'], ['/games', 'web-topbar'], ['/coach', 'web-topbar'], ['/me', 'web-topbar'], ['/workshop', null], ['/history', null]] as const) {
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    if (testId) await expect(page.getByTestId(testId)).toBeVisible()
    await expect(page.locator('body')).not.toContainText('Bad Request')
    opened[path] = await page.title()
  }
  results.pages = opened
})

test('AI Coach without a local model: free-text says so and is disabled; fixed questions and the decision model still work', async ({ page }) => {
  await page.goto('/coach?view=questions')
  const status = page.getByTestId('coach-agent-status')
  await expect(status).toHaveAttribute('data-status', 'bridge_unavailable', { timeout: 20_000 })
  await expect(status).toContainText('本地 AI 模型未连接')
  await expect(page.getByTestId('coach-agent-input')).toBeDisabled()
  results.coachWithoutModel = { status: await status.getAttribute('data-status'), text: await status.textContent() }
  await page.screenshot({ path: join(OUT, 'coach-no-model.png') })
})
