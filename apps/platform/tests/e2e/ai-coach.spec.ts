import { expect, test, type Page } from '@playwright/test'
import { SESSION_STORAGE_KEY } from '../../src/features/training/LocalStorageTrainingSessionRepository'
import { ROUTINE_SESSION_STORAGE_KEY } from '../../src/features/routines/session/RoutineSessionRepository'
import { createDraftAction } from '../../src/features/workshop/definition'
import { standingPose } from '../../src/features/workshop/fixture'
import { CUSTOM_ACTION_STORAGE_KEY } from '../../src/features/workshop/types'
import { FIRST_SESSION } from '../analysis-fixtures'
import { routineRecord } from '../helpers/routineFixtures'
import { markOnboardingSeen } from './support/onboarding'

const panel = (page: Page) => page.getByTestId('ai-coach-panel')
const trigger = (page: Page) => page.getByTestId('ai-coach-trigger')
const log = (page: Page) => page.getByTestId('ai-coach-log')

async function seed(page: Page, key: string, value: unknown) {
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value) }, { key, value: JSON.stringify(value) })
}

test.beforeEach(async ({ page }) => { await markOnboardingSeen(page) })

test('AI Coach A: opens and closes by mouse and keyboard, keeps focus in order and answers Home questions from history', async ({ page }) => {
  await seed(page, ROUTINE_SESSION_STORAGE_KEY, [routineRecord({ id: 'routine-coach', startedAt: Date.now() - 3_600_000, programId: 'taijiquan' })])
  await page.goto('/')
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
  await trigger(page).click()
  await expect(panel(page)).toBeVisible()
  await expect(panel(page)).toHaveAttribute('role', 'dialog')
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true')
  const firstQuestion = panel(page).getByRole('button', { name: '我最近训练怎么样？' })
  await expect(firstQuestion).toBeFocused()
  await expect(panel(page).getByRole('group', { name: '你可以问：' }).getByRole('button')).toHaveText(['我最近训练怎么样？', '上次练了什么？', '今天可以继续练什么？'])

  await firstQuestion.click()
  await expect(log(page)).toContainText('本周完成了 1 次训练')
  await expect(log(page)).toContainText('太极拳 · 整套跟练')
  await panel(page).getByRole('button', { name: '上次练了什么？' }).click()
  await expect(log(page).getByRole('link', { name: '查看这次报告' })).toHaveAttribute('href', '/report/routine-coach')

  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await expect(trigger(page)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toBeVisible()
  await expect(firstQuestion).toBeFocused()
  await panel(page).getByRole('button', { name: '关闭 AI 教练' }).click()
  await expect(panel(page)).toHaveCount(0)
  await expect(trigger(page)).toBeFocused()
})

test('AI Coach B: free input is matched simply, and anything else is declined without made-up answers', async ({ page }) => {
  await page.goto('/')
  await trigger(page).click()
  const input = panel(page).getByLabel('向教练提问')
  await input.fill('你好')
  await input.press('Enter')
  await expect(log(page)).toContainText('你好！我是 FormPilot 教练')
  await input.fill('明天天气怎么样')
  await panel(page).getByRole('button', { name: '发送问题' }).click()
  await expect(log(page)).toContainText('这个问题我还回答不了')
  await input.fill('膝盖疼还能练吗')
  await input.press('Enter')
  await expect(log(page)).toContainText('不能判断伤病')
  await expect(panel(page).getByRole('button', { name: '发送问题' })).toBeDisabled()
})

test('AI Coach C: on a report the questions and answers switch to that report', async ({ page }) => {
  await seed(page, SESSION_STORAGE_KEY, [FIRST_SESSION])
  await page.goto(`/report/${FIRST_SESSION.id}`)
  await trigger(page).click()
  await expect(panel(page)).toHaveAttribute('data-page', 'report')
  await expect(panel(page).getByRole('group', { name: '你可以问：' }).getByRole('button')).toHaveText(['我这次表现怎么样？', '为什么是这个分数？', '最大的问题是什么？', '和上次相比有进步吗？', '下次应该重点练什么？'])
  await panel(page).getByRole('button', { name: '我这次表现怎么样？' }).click()
  await expect(log(page)).toContainText('综合评分')
  await panel(page).getByRole('button', { name: '和上次相比有进步吗？' }).click()
  await expect(log(page)).toContainText('这是第一条训练记录，暂无可对比的历史')
  await panel(page).getByRole('button', { name: '下次应该重点练什么？' }).click()
  await expect(log(page)).toContainText('下次目标')
  await expect(log(page).getByText(/依据：.*训练报告/).first()).toBeVisible()
})

test('AI Coach D: during a follow-along the coach reads the live match', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/routines/baduanjin/train?fixture=synthetic')
  await expect(page.getByTestId('routine-state')).toHaveAttribute('data-course-state', 'ACTIVE', { timeout: 30_000 })
  await expect.poll(async () => page.getByTestId('routine-similarity').getAttribute('data-match-status'), { timeout: 20_000 }).toMatch(/in_sync|ahead|behind|mismatch/)
  await trigger(page).click()
  await expect(panel(page)).toHaveAttribute('data-page', 'training')
  await panel(page).getByRole('button', { name: '我现在做得怎么样？' }).click()
  await expect(log(page)).toContainText('跟练相似度是')
  await panel(page).getByRole('button', { name: '这个动作怎么做？' }).click()
  await expect(log(page)).toContainText('依据：标准视频这一段的动作要点')
})

test('AI Coach E: on a custom action it explains the user\'s own poses, and typing in it never pauses training', async ({ page }) => {
  test.setTimeout(60_000)
  const capture = (degrees: number) => ({ landmarks: standingPose(degrees).map(({ x, y, z, visibility }) => ({ x, y, z, visibility })), aspect: 16 / 9, frames: 12, capturedAt: '2026-09-27T08:00:00.000Z' })
  const action = { ...createDraftAction(new Date('2026-09-27T08:00:00.000Z'), 'custom-coach'), name: '侧平举练习', goal: { type: 'reps', target: 30 }, startPose: { description: '双臂自然下垂', capture: capture(8) }, finishPose: { description: '双臂抬到肩高', capture: capture(90) }, test: { status: 'passed' } }
  await seed(page, CUSTOM_ACTION_STORAGE_KEY, { schemaVersion: 1, actions: [action] })
  await page.goto('/workshop/custom-coach/train?fixture=synthetic&fast=1')
  await expect(page.getByTestId('custom-state')).toHaveAttribute('data-course-state', 'ACTIVE', { timeout: 20_000 })
  await trigger(page).click()
  await panel(page).getByRole('button', { name: '这个动作怎么做？' }).click()
  await expect(log(page)).toContainText('从「双臂自然下垂」出发，做到「双臂抬到肩高」')
  const input = panel(page).getByLabel('向教练提问')
  await input.click()
  await page.keyboard.type('我 现在 做得 怎么样')
  await expect(page.getByTestId('custom-state')).toHaveAttribute('data-session-status', 'active')
  await input.press('Enter')
  await expect(log(page)).toContainText('已经完成')
})

test('AI Coach F: the coach fits every target viewport and stays out of the way on phones', async ({ page }) => {
  await page.goto('/')
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.reload()
    await trigger(page).click()
    const box = await panel(page).boundingBox()
    expect(box, `${viewport.width}`).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/ai-coach-${viewport.width}x${viewport.height}.png` })
    await page.keyboard.press('Escape')
  }
})
