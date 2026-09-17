import { expect, test } from '@playwright/test'

test('demo training renders and core controls remain usable', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.goto('/?demo=1')
  await expect(page.getByRole('heading', { name: '今日训练 · 侧平举专项' })).toBeVisible()
  await expect(page.getByRole('img', { name: '演示模式中的侧平举人物' })).toBeVisible()
  await expect(page.getByText('演示模式')).toBeVisible()

  const pause = page.getByRole('button', { name: '暂停训练' })
  await pause.click()
  await expect(page.getByRole('button', { name: '继续训练' })).toBeVisible()
  await page.getByRole('button', { name: '继续训练' }).click()

  await page.getByRole('button', { name: '结束训练' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('确认结束本次训练？')
  await page.getByRole('button', { name: '继续训练' }).click()
  await expect(page.getByRole('alertdialog')).toBeHidden()
  expect(browserErrors).toEqual([])
})

test('debug mode exposes observable rule state', async ({ page }) => {
  await page.goto('/?demo=1&debug=1')
  const panel = page.getByRole('complementary', { name: '开发调试信息' })
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Phase')
  await expect(panel).toContainText('Active errors')
  await expect(panel.locator('dt', { hasText: 'Pose confidence' }).locator('..').locator('dd')).not.toHaveText('0.00', { timeout: 30_000 })
})

test('fast demo walks four exercises, preserves pause on Squat, and saves four results', async ({ page }) => {
  await page.goto('/?demo=1&fast=1&fixture=synthetic')
  await expect(page.getByRole('heading', { name: '今日训练 · 侧平举专项' })).toBeVisible()
  await page.waitForFunction(() => {
    const detector = (window as unknown as { __poseDetector?: { initializeCalls: number } }).__poseDetector
    return (detector?.initializeCalls ?? 0) >= 1
  }, undefined, { timeout: 30_000 })
  const initializeCallsAfterStart = await page.evaluate(() => {
    const detector = (window as unknown as { __poseDetector?: { initializeCalls: number } }).__poseDetector
    if (!detector) throw new Error('Pose detector missing')
    return detector.initializeCalls
  })
  await expect(page.getByRole('heading', { name: '今日训练 · 侧步开合专项' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: '今日训练 · 徒手深蹲专项' })).toBeVisible({ timeout: 20_000 })
  expect(await page.evaluate(() => (window as unknown as { __poseDetector: { initializeCalls: number } }).__poseDetector.initializeCalls)).toBe(initializeCallsAfterStart)
  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(page.getByRole('button', { name: '继续训练' })).toBeVisible()
  await page.getByRole('button', { name: '继续训练' }).click()
  await expect(page.getByRole('heading', { name: '今日训练 · 原地交替提膝专项' })).toBeVisible({ timeout: 20_000 })
  expect(await page.evaluate(() => (window as unknown as { __poseDetector: { initializeCalls: number } }).__poseDetector.initializeCalls)).toBe(initializeCallsAfterStart)
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 25_000 })
  const sessions = await page.evaluate(() => JSON.parse(localStorage.getItem('ai-coach.sessions:v2') ?? '[]'))
  const latest = sessions.at(-1)
  expect(latest.exercises.map((item: { exerciseId: string }) => item.exerciseId)).toEqual(['lateral_raise', 'step_jack', 'squat', 'knee_raise'])
  expect(latest.exercises.every((item: { repetitions: unknown[] }) => item.repetitions.length > 0)).toBe(true)
})

test('Step Jack debug mode exposes calibration fields and downloads diagnostics', async ({ page }) => {
  await page.goto('/?demo=1&exercise=step_jack&debug=1')
  const panel = page.getByRole('complementary', { name: '开发调试信息' })
  await expect(panel).toContainText('Open ratio')
  await expect(panel).toContainText('Mean arm angle')
  await expect(panel).toContainText('Current side')
  await expect(panel).toContainText('Sync gap')
  const jsonDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON' }).click()
  expect((await jsonDownload).suggestedFilename()).toMatch(/ai-coach-diagnostics-\d+\.json/)
  const csvDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 CSV' }).click()
  expect((await csvDownload).suggestedFilename()).toMatch(/ai-coach-diagnostics-\d+\.csv/)
})

test('Squat demo uses the real pose pipeline, debug fields, and a single MediaPipe load', async ({ page }) => {
  const modelRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('pose_landmarker_lite.task')) modelRequests.push(request.url())
  })
  await page.goto('/?demo=1&exercise=squat&debug=1')
  await expect(page.getByRole('heading', { name: '今日训练 · 徒手深蹲专项' })).toBeVisible()
  await expect(page.getByRole('img', { name: '演示模式中的徒手深蹲人物' }))
    .toHaveAttribute('data-demo-source', 'real-image-sequence')
  const panel = page.getByRole('complementary', { name: '开发调试信息' })
  await expect(panel).toContainText('hipDrop')
  await expect(panel).toContainText('kneeSpreadRatio')
  await expect(panel).toContainText('Phase')
  await expect(panel.locator('dt', { hasText: 'Demo source' }).locator('..').locator('dd')).toHaveText('real image sequence')
  await expect(panel.locator('dt', { hasText: 'Baseline' }).locator('..').locator('dd')).toHaveText('ready', { timeout: 30_000 })
  await expect(panel.locator('dt', { hasText: 'Pose confidence' }).locator('..').locator('dd')).not.toHaveText('0.00', { timeout: 30_000 })
  expect(modelRequests.length).toBe(1)
  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(page.getByRole('button', { name: '继续训练' })).toBeVisible()
  await page.getByRole('button', { name: '继续训练' }).click()
  expect(modelRequests.length).toBe(1)
  expect(await page.evaluate(() => (window as unknown as { __poseDetector: { initializationCount: number } }).__poseDetector.initializationCount)).toBe(1)
})
