import { expect, test, type Page } from '@playwright/test'
import { SESSION_STORAGE_KEY } from '../../src/features/training/LocalStorageTrainingSessionRepository'
import { markOnboardingSeen } from './support/onboarding'

const latestRecord = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]').at(-1), SESSION_STORAGE_KEY)

async function endAndSave(page: Page) {
  await page.getByRole('button', { name: '结束训练', exact: true }).click()
  await page.getByRole('button', { name: '结束并保存', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible()
}

test.beforeEach(async ({ page }) => { await markOnboardingSeen(page) })

for (const [name, path] of [['full course', '/train'], ['free training', '/train?exercise=overhead_raise']]) {
  test(`ending zero-action ${name} saves an incomplete result without an achieved-target badge`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByTestId('warmup-count-value')).toHaveText('0')
    await expect(page.getByTestId('warmup-complete')).toHaveCount(0)

    await endAndSave(page)

    await expect(page.getByTestId('course-state')).toContainText('未完成')
    await expect(page.getByTestId('warmup-count-value')).toHaveText('0')
    await expect(page.getByTestId('warmup-complete')).toHaveCount(0)
    expect(await latestRecord(page)).toMatchObject({ status: 'completed', courseStatus: 'incomplete' })
    await page.getByRole('button', { name: '查看训练报告', exact: true }).click()
    await expect(page.getByTestId('report-summary')).toContainText('未完成')
  })
}

test('ending after partial progress keeps the current action unfinished', async ({ page }) => {
  await page.goto('/train?exercise=squat&demo=1&course=1&fixture=synthetic')
  await expect(page.getByTestId('warmup-count-value')).toHaveText('1', { timeout: 30_000 })
  await page.getByRole('button', { name: '暂停训练', exact: true }).click()
  await endAndSave(page)

  await expect(page.getByTestId('warmup-count-value')).toHaveText('1')
  await expect(page.getByTestId('warmup-complete')).toHaveCount(0)
  expect(await latestRecord(page)).toMatchObject({ status: 'completed', courseStatus: 'incomplete' })
})

test('reaching the action target still shows completion and saves a completed result', async ({ page }) => {
  await page.goto('/train?exercise=squat&demo=1&course=1&fixture=synthetic&fast=1')
  await expect(page.getByTestId('warmup-complete')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible()
  await expect(page.getByTestId('warmup-complete')).toContainText('本项完成')
  expect(await latestRecord(page)).toMatchObject({ status: 'completed', courseStatus: 'completed' })
})

test('pausing and ending a reached target retains that action completion', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/train?exercise=lateral_raise&demo=1&course=1&fixture=synthetic')
  await expect(page.getByTestId('warmup-complete')).toBeVisible({ timeout: 40_000 })
  // During the transition, the runtime resets its temporary repetition count.
  await expect(page.getByTestId('warmup-count-value')).toHaveText('0')
  await page.getByRole('button', { name: '暂停训练', exact: true }).click()
  await expect(page.getByTestId('course-state')).toContainText('暂停')
  await expect(page.getByTestId('warmup-complete')).toBeVisible()

  await endAndSave(page)

  await expect(page.getByTestId('course-state')).toContainText('未完成')
  await expect(page.getByTestId('warmup-complete')).toContainText('本项完成')
  const saved = await latestRecord(page)
  expect(saved).toMatchObject({ status: 'completed', courseStatus: 'incomplete' })
  expect(saved.exercises[0].repetitions).toHaveLength(6)
})

test('the next unfinished action does not inherit the previous action completion', async ({ page }) => {
  await page.goto('/train?demo=1&course=1&fixture=synthetic&fast=1')
  await expect(page.getByTestId('warmup-complete')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: '今日训练 · 双臂上举专项' })).toBeVisible()
  await page.getByRole('button', { name: '暂停训练', exact: true }).click()
  await expect(page.getByTestId('warmup-count-value')).toHaveText('0')
  await expect(page.getByTestId('warmup-complete')).toHaveCount(0)

  await endAndSave(page)

  await expect(page.getByTestId('warmup-complete')).toHaveCount(0)
  const saved = await latestRecord(page)
  expect(saved.courseStatus).toBe('incomplete')
  expect(saved.exercises[1].repetitions).toHaveLength(0)
})
