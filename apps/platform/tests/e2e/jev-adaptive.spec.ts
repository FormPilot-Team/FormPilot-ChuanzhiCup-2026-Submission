import { expect, test } from '@playwright/test'
import { markOnboardingSeen } from './support/onboarding'

const training = '/train?demo=1&course=1&fixture=synthetic&exercise=squat'
test.beforeEach(async ({ page }) => {
  await markOnboardingSeen(page)
  // A fresh context with all Internet/API traffic blocked still has access to its local app server and bundled assets.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname.startsWith('/api/')) await route.abort('internetdisconnected')
    else await route.continue()
  })
})

test('offline local policy keeps training, corrections and pause operational without any API request', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let calls = 0
  page.on('request', req => { if (req.url().endsWith('/api/jev/decision')) calls += 1 })
  await page.goto(training)
  const panel = page.getByTestId('adaptive-decision')
  await expect(panel).toHaveAttribute('data-source', 'local')
  await expect(panel).toContainText('本地自适应 · 离线')
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 15000 })
  await expect.poll(() => page.getByTestId('detailed-metrics').textContent()).toMatch(/深度|稳定性/)
  await page.getByRole('button', { name: '暂停训练', exact: true }).click()
  await expect(page.getByRole('button', { name: '继续训练', exact: true })).toBeVisible()
  await expect(panel).toHaveAttribute('data-strategy', 'CONTINUE_STANDARD')
  await page.getByRole('button', { name: '继续训练', exact: true }).click()
  expect(calls).toBe(0)
  expect(errors).toEqual([])
  await panel.screenshot({ path: 'test-results/competition/local-decision.png' })
})

test('four strategies use the actual local engine and clearly distinguish constructed comparison from live training', async ({ page }) => {
  test.setTimeout(45000)
  await page.goto(`${training}&adaptiveDemo=1`)
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 15000 })
  const selector = page.getByLabel('策略对比（人工构造情境）')
  const panel = page.getByTestId('adaptive-decision')
  await selector.selectOption('normal')
  await expect(panel).toHaveAttribute('data-strategy', 'CONTINUE_STANDARD')
  await selector.selectOption('switch')
  await expect(panel).toHaveAttribute('data-strategy', 'SWITCH_CUE')
  await expect(panel).toContainText('想象身后有座椅')
  await expect(panel).toContainText('不代表真人实验')
  await selector.selectOption('decomposition')
  await expect(page.getByTestId('decision-steps').locator('li')).toHaveCount(3)
  await expect(panel).toHaveAttribute('data-source', 'local')
  await panel.getByText('查看决策依据与策略分').click()
  await expect(panel).toContainText('不是概率或模型置信度')
  await page.screenshot({ path: 'test-results/competition/local-comparison-desktop.png', fullPage: true })
  await selector.selectOption('pose-missing')
  await expect(panel).toHaveAttribute('data-strategy', 'CONTINUE_STANDARD')
  await selector.selectOption('pause')
  await expect(page.getByTestId('decision-pause')).toBeEnabled({ timeout: 10000 })
  await page.getByTestId('decision-pause').click()
  await expect(page.getByRole('button', { name: '继续训练', exact: true })).toBeVisible()
  await expect(page.getByTestId('decision-pause')).toBeDisabled()
  await page.getByRole('button', { name: '继续训练', exact: true }).click()
  await selector.selectOption('decomposition')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/competition/local-comparison-mobile.png', fullPage: true })
  await selector.selectOption('')
  await expect(panel).not.toContainText('人工构造状态')
})

test('live state explanations use local scores, and pose loss immediately preserves the original feedback', async ({ page }) => {
  await page.goto(training)
  const panel = page.getByTestId('adaptive-decision')
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 15000 })
  await panel.getByText('查看决策依据与策略分').click()
  await expect(page.getByTestId('decision-scores')).toBeVisible()
  await expect(page.getByTestId('decision-trend')).toBeVisible()
  await expect(panel).not.toContainText('Jev')
  await page.evaluate(() => { (window as typeof window & { __forceNoPose?: boolean }).__forceNoPose = true })
  await expect(panel).toHaveAttribute('data-strategy', 'CONTINUE_STANDARD')
  await expect(page.getByTestId('decision-reason')).toContainText(/不可靠|未在有效训练/, { timeout: 3000 })
})

test('existing real image sequence and MediaPipe run with all Internet traffic blocked', async ({ page }) => {
  test.setTimeout(45000)
  const remote: string[] = [], api: string[] = []
  page.on('request', req => {
    const url = new URL(req.url())
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) remote.push(req.url())
    if (url.pathname.startsWith('/api/')) api.push(req.url())
  })
  await page.goto('/train?demo=1&exercise=overhead_raise&debug=1')
  const debug = page.getByRole('complementary', { name: '开发调试信息' })
  await expect(debug.locator('dt', { hasText: 'Pose confidence' }).locator('..').locator('dd')).not.toHaveText('0.00', { timeout: 30000 })
  await expect(page.getByTestId('decision-source')).toContainText('本地自适应')
  expect(remote).toEqual([])
  expect(api).toEqual([])
  await page.screenshot({ path: 'test-results/competition/local-offline-real-image.png', fullPage: true })
})

test('preparing and restored tracking stay usable with no transport', async ({ page }) => {
  await page.goto('/train?exercise=squat')
  await expect(page.getByTestId('adaptive-decision')).toHaveAttribute('data-strategy', 'CONTINUE_STANDARD')
  await expect(page.getByTestId('decision-reason')).toContainText('未在有效训练')
  await page.goto(training)
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 15000 })
  await page.evaluate(() => { (window as typeof window & { __forceNoPose?: boolean }).__forceNoPose = true })
  await expect(page.getByTestId('decision-reason')).toContainText(/不可靠|未在有效训练/)
  await page.evaluate(() => { (window as typeof window & { __forceNoPose?: boolean }).__forceNoPose = false })
  await expect(page.getByTestId('decision-trend')).toBeVisible()
})

test('legacy model demo query cannot enable a model or issue any API request', async ({ page }) => {
  const requests: string[] = []
  page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/')) requests.push(req.url()) })
  await page.goto(`${training}&jevDemo=1`)
  await expect(page.getByLabel('策略对比（人工构造情境）')).toBeVisible()
  await expect(page.getByTestId('adaptive-decision')).not.toContainText('Jev')
  expect(requests).toEqual([])
})
