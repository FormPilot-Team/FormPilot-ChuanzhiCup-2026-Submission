import { expect, test } from '@playwright/test'

test('six-step fast course completes in frozen order and saves scored-only summary', async ({ page }) => {
  test.setTimeout(80_000)
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic&debug=1')
  await expect(page.getByRole('heading', { name: '今日训练 · 肩部活动引导' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase5/01-course-preparing.png' })
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 8_000 })
  await page.screenshot({ path: 'test-results/regression-screenshots/phase5/02-shoulder-rotation-active.png' })

  await expect(page.getByRole('heading', { name: '今日训练 · 双臂上举专项' })).toBeVisible({ timeout: 12_000 })
  await page.screenshot({ path: 'test-results/regression-screenshots/phase5/03-overhead-raise-active.png' })
  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(page.getByTestId('course-state')).toContainText('课程已暂停')
  await page.screenshot({ path: 'test-results/regression-screenshots/phase5/08-course-paused.png' })
  await page.getByRole('button', { name: '继续训练' }).click()

  await expect(page.getByRole('heading', { name: '今日训练 · 侧平举专项' })).toBeVisible({ timeout: 12_000 })
  await page.screenshot({ path: 'test-results/regression-screenshots/phase5/04-lateral-raise-active.png' })
  await expect(page.getByRole('heading', { name: '今日训练 · 侧步开合专项' })).toBeVisible({ timeout: 12_000 })
  await page.screenshot({ path: 'test-results/regression-screenshots/phase5/05-step-jack-active.png' })
  await expect(page.getByRole('heading', { name: '今日训练 · 徒手深蹲专项' })).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: 'test-results/regression-screenshots/phase5/06-squat-active.png' })
  await expect(page.getByRole('heading', { name: '今日训练 · 原地交替提膝专项' })).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: 'test-results/regression-screenshots/phase5/07-knee-raise-active.png' })
  await expect(page.getByTestId('course-state')).toContainText('完成', { timeout: 12_000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/regression-screenshots/phase5/09-course-transition.png' })
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 12_000 })
  await page.screenshot({ path: 'test-results/regression-screenshots/phase5/10-course-complete-summary.png' })

  const latest = await page.evaluate(() => JSON.parse(localStorage.getItem('ai-coach.sessions:v2') ?? '[]').at(-1))
  expect(latest).toMatchObject({
    schemaVersion: 2,
    mode: 'fast',
    rulesVersion: { spec: 'exercise-rules-v1.0', threshold: 'engineering-v1' },
    courseStatus: 'completed',
  })
  expect(latest).not.toHaveProperty('analysis')
  expect(latest.exercises.map((item: { exerciseId: string }) => item.exerciseId)).toEqual([
    'shoulder_rotation','overhead_raise','lateral_raise','step_jack','squat','knee_raise',
  ])
  expect(latest.exercises[0].evaluationMode).toBe('guidance')
  expect(latest.exercises.slice(1).every((item: { evaluationMode: string; overallScore: number }) => item.evaluationMode === 'scored' && item.overallScore > 0)).toBe(true)
  expect(latest.courseOverallScore).toBeGreaterThan(0)
})

test('manual course end from ACTIVE persists incomplete status', async ({ page }) => {
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic')
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 8_000 })
  await page.getByRole('button', { name:'结束训练' }).click()
  await page.getByRole('button', { name:'结束并保存' }).click()
  const latest = await page.evaluate(() => JSON.parse(localStorage.getItem('ai-coach.sessions:v2') ?? '[]').at(-1))
  expect(latest.courseStatus).toBe('incomplete')
})

test('manual course end can be cancelled while paused and then persists incomplete status', async ({ page }) => {
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic')
  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(page.getByTestId('course-state')).toContainText('课程已暂停')
  await page.getByRole('button', { name: '结束训练' }).click()
  await page.getByRole('button', { name: '继续训练' }).last().click()
  await expect(page.getByTestId('course-state')).toContainText('课程已暂停')
  await page.getByRole('button', { name: '结束训练' }).click()
  await page.getByRole('button', { name: '结束并保存' }).click()
  await expect(page.getByText('课程提前结束，已保存未完成结果')).toBeVisible()
  const latest = await page.evaluate(() => JSON.parse(localStorage.getItem('ai-coach.sessions:v2') ?? '[]').at(-1))
  expect(latest.courseStatus).toBe('incomplete')
})

test('Shoulder Rotation pause excludes paused wall time from active motion', async ({ page }) => {
  test.setTimeout(20_000)
  await page.goto('/?demo=1&course=1&fixture=synthetic&debug=1')
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 8_000 })
  const panel = page.locator('aside[aria-label="开发调试信息"]')
  const activeMotion = async () => Number.parseFloat((await panel.locator('dt', { hasText:'Active motion' }).locator('..').locator('dd').textContent()) ?? '0')
  await expect.poll(activeMotion).toBeGreaterThan(.2)
  await page.getByRole('button', { name:'暂停训练' }).click()
  const pausedAt = await activeMotion()
  await page.waitForTimeout(1200)
  expect(await activeMotion()).toBe(pausedAt)
  await page.getByRole('button', { name:'继续训练' }).first().click()
  await expect.poll(activeMotion).toBeGreaterThan(pausedAt)
})

test('six-step progress has no critical mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic')
  await expect(page.getByText('肩部环绕', { exact: true }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
})

test('Overhead Raise real image sequence completes through MediaPipe', async ({ page }) => {
  test.setTimeout(40_000)
  await page.goto('/?demo=1&exercise=overhead_raise&fast=1&debug=1')
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 30_000 })
  const panel = page.locator('aside[aria-label="开发调试信息"]')
  const value = async (label: string) => panel.locator('dt', { hasText: label }).locator('..').locator('dd').textContent()
  const proof = { cameraFps: await value('Camera FPS'), inferenceFps: await value('Inference FPS'), averageInference: await value('Avg inference'), p95Inference: await value('p95 inference'), phaseTrace: await value('Phase trace'), initializationCount: await value('MediaPipe init count') }
  console.log(`OVERHEAD_DYNAMIC_PROOF ${JSON.stringify(proof)}`)
  expect(proof.phaseTrace).toContain('COMPLETE')
  expect(proof.initializationCount).toBe('1')
})
