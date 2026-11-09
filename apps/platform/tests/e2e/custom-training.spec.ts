import { expect, test, type Page } from '@playwright/test'
import { createDraftAction } from '../../src/features/workshop/definition'
import { standingPose } from '../../src/features/workshop/fixture'
import { CUSTOM_SESSION_STORAGE_KEY, type CustomActionSessionRecord } from '../../src/features/workshop/session'
import { CUSTOM_ACTION_STORAGE_KEY, type CapturedPose, type CustomActionDefinition } from '../../src/features/workshop/types'
import { markOnboardingSeen } from './support/onboarding'

type TestWindow = Window & { __gestureTestPose?: 'start' | 'none'; __forceNoPose?: boolean }

function capture(degrees: number): CapturedPose {
  return { landmarks: standingPose(degrees).map(({ x, y, z, visibility }) => ({ x, y, z, visibility })), aspect: 16 / 9, frames: 12, capturedAt: '2026-09-27T08:00:00.000Z' }
}

function lateralRaise(id: string, patch: Partial<CustomActionDefinition> = {}): CustomActionDefinition {
  return {
    ...createDraftAction(new Date('2026-09-27T08:00:00.000Z'), id),
    name: '侧平举练习',
    description: '双臂侧平举到肩高再放下',
    goal: { type: 'reps', target: 3 },
    startPose: { description: '双臂自然下垂', capture: capture(8) },
    finishPose: { description: '双臂抬到肩高', capture: capture(90) },
    test: { status: 'passed', repsDetected: 3, repsPassed: 3 },
    ...patch,
  }
}

async function seedActions(page: Page, actions: CustomActionDefinition[]) {
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value) }, { key: CUSTOM_ACTION_STORAGE_KEY, value: JSON.stringify({ schemaVersion: 1, actions }) })
}

const savedSessions = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]') as CustomActionSessionRecord[], CUSTOM_SESSION_STORAGE_KEY)
const courseState = (page: Page) => page.getByTestId('custom-state')

test.beforeEach(async ({ page }) => { await markOnboardingSeen(page) })

test('Custom A: a saved action trains to completion, and its record reaches Report, History and Home', async ({ page }) => {
  test.setTimeout(120_000)
  await seedActions(page, [lateralRaise('custom-e2e-raise')])
  await page.goto('/workshop/custom-e2e-raise/train?fixture=synthetic&fast=1')
  await expect(page.getByRole('heading', { level: 1, name: '侧平举练习' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '开始训练' })).toHaveAttribute('aria-current', 'page')
  await expect(courseState(page)).toHaveAttribute('data-course-state', 'ACTIVE', { timeout: 20_000 })
  const dialog = page.getByTestId('custom-complete-dialog')
  await expect(dialog).toHaveAttribute('data-outcome', 'completed', { timeout: 60_000 })
  await expect(dialog).toContainText('侧平举练习已完成 3 次')
  await expect(page.getByTestId('custom-count')).toHaveText('3')

  const [record] = await savedSessions(page)
  expect(record).toMatchObject({ kind: 'custom-action', actionId: 'custom-e2e-raise', actionName: '侧平举练习', actionSource: 'workshop', outcome: 'completed', recognitionMode: 'pose-match', source: 'synthetic', mode: 'fast', goal: { type: 'reps', target: 3 } })
  expect(record.reps).toBeGreaterThanOrEqual(3)
  expect(record.passedReps).toBe(record.reps)
  expect(record.requirements.find((item) => item.id === 'arms-straight')).toMatchObject({ checked: record.reps, passed: record.reps })
  expect(record.activeMs).toBeGreaterThan(3000)
  expect(record.endedAt).toBeGreaterThan(record.startedAt)

  await page.getByRole('button', { name: '查看训练报告' }).click()
  await expect(page).toHaveURL(new RegExp(`/report/${record.id}$`))
  const summary = page.getByTestId('report-summary')
  await expect(summary).toHaveAttribute('data-report-kind', 'custom')
  await expect(page.getByRole('heading', { level: 1, name: '侧平举练习训练报告' })).toBeVisible()
  await expect(summary).toContainText('训练完成')
  await expect(page.getByTestId('custom-report-completion')).toContainText('100%')
  await expect(page.getByTestId('custom-requirement-arms-straight')).toContainText('100%')
  await expect(page.locator('body')).not.toContainText(/综合评分|五维|跟练相似度/)
  await page.getByTestId('custom-report-notes').locator('summary').click()
  await expect(page.getByTestId('custom-report-notes')).toContainText('测试模式')

  // The same record as a real camera session would store it.
  await page.evaluate(({ key }) => {
    const records = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{ source: string; mode: string }>
    localStorage.setItem(key, JSON.stringify(records.map((item) => ({ ...item, source: 'live', mode: 'normal' }))))
  }, { key: CUSTOM_SESSION_STORAGE_KEY })
  await page.goto('/history')
  const card = page.getByTestId(`history-card-${record.id}`)
  await expect(card).toHaveAttribute('data-kind', 'custom')
  await expect(card.getByTestId('history-custom-label')).toHaveText('我的动作 · 侧平举练习')
  await expect(card).toContainText('完成 3 / 3 次')
  await page.getByRole('group', { name: '按训练模式筛选' }).getByRole('button', { name: '我的动作' }).click()
  await expect(page.getByTestId('history-list').locator('article')).toHaveCount(1)
  await page.getByRole('group', { name: '按训练模式筛选' }).getByRole('button', { name: '热身训练' }).click()
  await expect(page.getByTestId('history-incomplete-hidden')).toBeVisible()

  // Web V1: Home shows the latest record; the user's own actions are listed in 训练中心.
  await page.goto('/')
  await expect(page.getByTestId('home-recent')).toContainText('我的动作 · 侧平举练习')
  await page.goto('/training')
  const myActions = page.getByTestId('training-my-actions')
  await expect(myActions.getByRole('link', { name: '开始训练 · 侧平举练习' })).toHaveAttribute('href', '/workshop/custom-e2e-raise/train')
  await expect(page.getByTestId('training-manage-actions')).toHaveAttribute('href', '/workshop')
})

test('Custom B: ending early saves an incomplete record; pausing works by button, Space and losing the pose', async ({ page }) => {
  test.setTimeout(90_000)
  await seedActions(page, [lateralRaise('custom-e2e-pause', { goal: { type: 'reps', target: 20 } })])
  await page.goto('/workshop/custom-e2e-pause/train?fixture=synthetic&fast=1')
  await expect(courseState(page)).toHaveAttribute('data-course-state', 'ACTIVE', { timeout: 20_000 })
  await expect.poll(async () => Number(await page.getByTestId('custom-count').textContent()), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(courseState(page)).toHaveAttribute('data-session-status', 'paused')
  await expect(courseState(page)).toHaveAttribute('data-course-state', 'PAUSED')
  await page.locator('body').click({ position: { x: 5, y: 300 } })
  await page.keyboard.press('Space')
  await expect(courseState(page)).toHaveAttribute('data-session-status', 'active')
  await expect(courseState(page)).toHaveAttribute('data-course-state', 'ACTIVE')

  await page.evaluate(() => { (window as TestWindow).__forceNoPose = true })
  await expect(courseState(page)).toHaveAttribute('data-course-state', 'PAUSED', { timeout: 5_000 })
  await expect(page.getByTestId('preparation-state')).toContainText('已自动暂停')
  await page.evaluate(() => { (window as TestWindow).__forceNoPose = false })
  await expect(courseState(page)).toHaveAttribute('data-course-state', 'ACTIVE', { timeout: 5_000 })

  await page.getByRole('button', { name: '结束训练' }).click()
  await expect(page.getByRole('alertdialog', { name: '确认结束本次训练？' })).toBeVisible()
  await page.getByRole('button', { name: '结束并保存' }).click()
  const dialog = page.getByTestId('custom-complete-dialog')
  await expect(dialog).toHaveAttribute('data-outcome', 'incomplete')
  await expect(dialog).toContainText('训练提前结束，已保存已完成的部分')
  const [record] = await savedSessions(page)
  expect(record.outcome).toBe('incomplete')
  expect(record.reps).toBeGreaterThanOrEqual(1)
  expect(record.feedbackCounts.POSE_LOST).toBeGreaterThanOrEqual(1)
  await page.getByRole('button', { name: '查看训练报告' }).click()
  await expect(page.getByTestId('report-summary')).toContainText('本次训练未完整完成')
  await expect(page.getByTestId('custom-report-focus')).toContainText('完成全部目标')
})

test('Custom C: an action that cannot be recognised yet says why and never starts', async ({ page }) => {
  await seedActions(page, [lateralRaise('custom-e2e-draft', { startPose: { description: '' }, finishPose: { description: '' }, test: { status: 'not-tested' } })])
  await page.goto('/workshop/custom-e2e-draft/train?fixture=synthetic&fast=1')
  await expect(page.getByTestId('custom-not-ready')).toContainText('请先记录开始姿势和完成姿势')
  await expect(page.getByTestId('custom-not-ready').getByRole('link', { name: '去编辑' })).toHaveAttribute('href', '/workshop/custom-e2e-draft')
  await page.waitForTimeout(3000)
  await expect(courseState(page)).toHaveAttribute('data-course-state', 'PREPARING')
  expect(await savedSessions(page)).toEqual([])

  await page.goto('/workshop/custom-gone/train')
  await expect(page.getByTestId('custom-training-not-found')).toContainText('没有找到这个动作')
})

test('Custom D: a hold goal counts held seconds', async ({ page }) => {
  test.setTimeout(90_000)
  await seedActions(page, [lateralRaise('custom-e2e-hold', { name: '侧平举静态保持', goal: { type: 'duration', seconds: 5 } })])
  await page.goto('/workshop/custom-e2e-hold/train?fixture=synthetic&fast=1')
  await expect(courseState(page)).toHaveAttribute('data-course-state', 'ACTIVE', { timeout: 20_000 })
  await expect(page.getByTestId('custom-complete-dialog')).toHaveAttribute('data-outcome', 'completed', { timeout: 60_000 })
  const [record] = await savedSessions(page)
  expect(record.goal).toEqual({ type: 'duration', seconds: 5 })
  expect(record.holdMs).toBeGreaterThanOrEqual(5000)
  await page.getByRole('button', { name: '查看训练报告' }).click()
  await expect(page.getByTestId('report-summary')).toContainText('保持时间')
})

test('Custom E: the training page stays inside the target viewports', async ({ page }) => {
  await seedActions(page, [lateralRaise('custom-e2e-layout')])
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/workshop/custom-e2e-layout/train?fixture=synthetic&gesture=manual')
    await expect(page.getByTestId('camera-panel')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${viewport.width}`).toBe(true)
    await page.screenshot({ path: `test-results/custom-training-${viewport.width}x${viewport.height}.png`, fullPage: true })
  }
})
