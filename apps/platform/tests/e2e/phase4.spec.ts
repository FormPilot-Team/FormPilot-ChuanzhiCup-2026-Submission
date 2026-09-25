import { expect, test, type Page } from '@playwright/test'

const debugValue = (page: Page, label: string) => page.getByRole('complementary', { name: '开发调试信息' })
  .locator('dt', { hasText: label }).locator('..').locator('dd')

test('Knee Raise real image sequence establishes baseline and completes LEFT + RIGHT', async ({ page }) => {
  test.setTimeout(90_000)
  const modelRequests: string[] = []
  page.on('request', (request) => { if (request.url().includes('pose_landmarker_lite.task')) modelRequests.push(request.url()) })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1&debug=1&exercise=knee_raise')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await expect(page.getByTestId('preparation-state')).toHaveText('请自然站立，准备开始')
  await expect(page.getByRole('img', { name: '演示模式中的原地交替提膝人物' })).toHaveAttribute('data-demo-source', 'real-image-sequence')
  await expect(debugValue(page, 'baselineReady')).toHaveText('ready', { timeout: 30_000 })
  await expect(page.getByTestId('preparation-state')).toBeHidden()
  await page.locator('section[aria-labelledby="camera-title"]').screenshot({ path: 'test-results/regression-screenshots/phase4/training-knee-raise.png' })
  await expect(debugValue(page, 'Phase trace')).toContainText('LEFT_RAISING', { timeout: 20_000 })
  await expect(debugValue(page, 'Phase trace')).toContainText('LEFT_TOP', { timeout: 20_000 })
  await page.locator('section[aria-labelledby="camera-title"]').screenshot({ path: 'test-results/regression-screenshots/phase4/knee-raise-left-top.png' })
  await expect(debugValue(page, 'Phase trace')).toContainText('LEFT_RETURNING', { timeout: 20_000 })
  await expect(debugValue(page, 'Phase trace')).toContainText('RIGHT_RAISING', { timeout: 25_000 })
  await expect(debugValue(page, 'Phase trace')).toContainText('RIGHT_TOP', { timeout: 20_000 })
  await page.locator('section[aria-labelledby="camera-title"]').screenshot({ path: 'test-results/regression-screenshots/phase4/knee-raise-right-top.png' })
  await expect(debugValue(page, 'Phase trace')).toContainText('RIGHT_RETURNING', { timeout: 20_000 })
  await expect(debugValue(page, 'cycle count')).not.toHaveText('0', { timeout: 20_000 })
  await page.getByRole('complementary', { name: '开发调试信息' }).screenshot({ path: 'test-results/regression-screenshots/phase4/knee-raise-debug.png' })
  await page.getByRole('complementary', { name: '开发调试信息' }).screenshot({ path: 'test-results/regression-screenshots/phase4/knee-raise-demo-timeline.png' })
  const proof = Object.fromEntries(await Promise.all([
    'Camera FPS', 'Inference FPS', 'Avg inference', 'p95 inference', 'Dropped / skipped', 'Phase trace', 'Rep count', 'cycle count',
    'Last side', 'Last rep duration', 'Last peak knee height', 'Last hip shift', 'Last torso lean', 'Last rep score', 'Last rep errors',
  ].map(async (label) => [label, await debugValue(page, label).textContent()])))
  console.log(`KNEE_RAISE_DYNAMIC_PROOF ${JSON.stringify(proof)}`)
  expect(await debugValue(page, 'MediaPipe init count').textContent()).toBe('1')
  expect(modelRequests).toHaveLength(1)
})

test('Knee Raise runtime keeps the frozen Static Coach identity visible', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1&debug=1&exercise=knee_raise')
  await expect(debugValue(page, 'Pose confidence')).not.toHaveText('0.00', { timeout: 30_000 })
  await expect(debugValue(page, 'coachState')).not.toHaveText('')
  await expect(page.getByTestId('coach-identity').locator('img')).toHaveAttribute('src', '/assets/overhead-raise-demo-start.png')
  await page.getByTestId('ai-coach-dock').screenshot({ path: 'test-results/regression-screenshots/phase4/knee-raise-static-coach.png' })
})

test('four-exercise fast session reaches Knee Raise without another MediaPipe initialization', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1&fast=1&fixture=synthetic&debug=1')
  await expect(page.getByRole('heading', { name: '今日训练 · 原地交替提膝专项' })).toBeVisible({ timeout: 50_000 })
  await page.screenshot({ path: 'test-results/regression-screenshots/phase4/four-exercise-session.png', fullPage: true })
  expect(await debugValue(page, 'MediaPipe init count').textContent()).toBe('1')
  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(page.getByRole('button', { name: '继续训练' })).toBeVisible()
  await page.getByRole('button', { name: '继续训练' }).click()
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 25_000 })
  const latest = await page.evaluate(() => JSON.parse(localStorage.getItem('ai-coach.sessions:v2') ?? '[]').at(-1))
  expect(latest.exercises.map((item: { exerciseId: string }) => item.exerciseId)).toEqual(['lateral_raise','step_jack','squat','knee_raise'])
})

test('Knee Raise has no critical horizontal overflow at mobile size', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?demo=1&exercise=knee_raise')
  await expect(page.getByRole('heading', { name: '今日训练 · 原地交替提膝专项' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase4/mobile-knee-raise.png', fullPage: true })
})
