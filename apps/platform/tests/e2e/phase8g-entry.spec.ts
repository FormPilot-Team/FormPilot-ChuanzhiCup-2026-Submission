import { expect, test, type Page } from '@playwright/test'
import { ONBOARDING_STORAGE_KEY } from '../../src/features/onboarding/onboarding'
import { SESSION_STORAGE_KEY } from '../../src/features/training/LocalStorageTrainingSessionRepository'
import type { TrainingSessionState } from '../../src/features/training/types'
import { at, makeSession } from '../analysis-fixtures'
import { markOnboardingSeen } from './support/onboarding'

const dialog = (page: Page) => page.getByTestId('onboarding-dialog')
const step = (page: Page) => page.getByTestId('onboarding-step')
const storedOnboarding = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), ONBOARDING_STORAGE_KEY)

test.describe('8G onboarding', () => {
  test('A: first launch shows the guide once; finishing it returns to the Mode Hub and survives reload', async ({ page }) => {
    await page.goto('/')
    await expect(dialog(page)).toBeVisible()
    await expect(step(page)).toHaveAttribute('data-step', 'welcome')
    await expect(page.getByRole('heading', { name: '欢迎使用 FormPilot' })).toBeVisible()
    await expect(page.getByRole('button', { name: '下一步' })).toBeFocused()
    expect(await storedOnboarding(page)).toBeNull()

    await page.getByRole('button', { name: '下一步' }).click()
    await expect(step(page)).toHaveAttribute('data-step', 'start-gesture')
    await page.getByRole('button', { name: '上一步' }).click()
    await expect(step(page)).toHaveAttribute('data-step', 'welcome')
    for (const id of ['start-gesture', 'pause-gesture', 'framing']) {
      await page.getByRole('button', { name: '下一步' }).click()
      await expect(step(page)).toHaveAttribute('data-step', id)
    }
    await expect(page.getByRole('button', { name: '下一步' })).toHaveCount(0)
    await page.getByRole('button', { name: '开始使用' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(page.getByRole('heading', { name: '开始训练', exact: true })).toBeVisible()
    expect(await storedOnboarding(page)).toMatchObject({ version: 1, outcome: 'completed' })

    await page.reload()
    await expect(page.getByTestId('mode-card-smart-training')).toBeVisible()
    await expect(dialog(page)).toBeHidden()
  })

  test('gesture tutorial pages carry the exact user-facing gesture copy', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '下一步' }).click()
    await expect(step(page)).toContainText('开始 / 继续训练')
    await expect(step(page)).toContainText('双手在胸前合拢并保持约 1.2 秒，即可开始或继续训练。')
    await expect(step(page)).toContainText('只在准备阶段和暂停时有效')
    await expect(page.getByRole('img', { name: '示意图：双手在胸前合拢' })).toBeVisible()
    await page.getByRole('button', { name: '下一步' }).click()
    await expect(step(page)).toContainText('暂停训练')
    await expect(step(page)).toContainText('双臂在胸前交叉成 X 并保持约 1.2 秒，即可暂停训练。')
    await expect(page.getByRole('img', { name: '示意图：双臂在胸前交叉成 X' })).toBeVisible()
    const text = await dialog(page).innerText()
    expect(text).not.toMatch(/GestureHoldController|START_GESTURE|PAUSE_GESTURE/)
  })

  test('Escape, the close button and 跳过 all close the guide and count as seen', async ({ page }) => {
    await page.goto('/')
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    expect(await storedOnboarding(page)).toMatchObject({ version: 1, outcome: 'dismissed' })
    await page.reload()
    await expect(page.getByTestId('mode-card-smart-training')).toBeVisible()
    await expect(dialog(page)).toBeHidden()

    await page.evaluate((key) => localStorage.removeItem(key), ONBOARDING_STORAGE_KEY)
    await page.reload()
    await expect(dialog(page)).toBeVisible()
    await page.getByRole('button', { name: '关闭使用说明' }).click()
    await expect(dialog(page)).toBeHidden()
    expect(await storedOnboarding(page)).toMatchObject({ outcome: 'dismissed' })

    await page.evaluate((key) => localStorage.removeItem(key), ONBOARDING_STORAGE_KEY)
    await page.reload()
    await page.getByRole('button', { name: '跳过' }).click()
    await expect(dialog(page)).toBeHidden()
    expect(await storedOnboarding(page)).toMatchObject({ outcome: 'dismissed' })
  })

  test('B: 使用说明 reopens the guide from the start, and closing it keeps the earlier completion', async ({ page }) => {
    await markOnboardingSeen(page)
    await page.goto('/')
    await expect(dialog(page)).toBeHidden()
    await page.getByTestId('home-guide').click()
    await expect(dialog(page)).toBeVisible()
    await expect(step(page)).toHaveAttribute('data-step', 'welcome')
    await page.getByRole('button', { name: '下一步' }).click()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await expect(page.getByTestId('home-guide')).toBeFocused()
    expect(await storedOnboarding(page)).toMatchObject({ outcome: 'completed', at: 1 })

    await page.getByTestId('home-guide').click()
    await expect(step(page)).toHaveAttribute('data-step', 'welcome')
    await page.getByRole('button', { name: '关闭使用说明' }).click()

    await page.goto('/smart-training')
    await page.getByRole('button', { name: '开始 / 暂停手势' }).click()
    await expect(step(page)).toHaveAttribute('data-step', 'start-gesture')
  })
})

test.describe('8G Mode Hub and smart-training entry', () => {
  test.beforeEach(async ({ page }) => { await markOnboardingSeen(page) })

  test('C: Home → 热身训练 → 完整训练 opens the standard six-step course on /train', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle('FormPilot')
    await page.getByRole('link', { name: '开始训练 · 热身训练' }).click()
    await expect(page).toHaveURL(/\/smart-training$/)
    await expect(page).toHaveTitle('FormPilot · 热身训练')
    await expect(page.getByRole('heading', { level: 1, name: '热身训练' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '开始训练' })).toHaveAttribute('aria-current', 'page')
    const order = page.getByRole('list', { name: '完整训练动作顺序' }).getByRole('listitem')
    await expect(order).toHaveText(['1肩部环绕', '2双臂上举', '3侧平举', '4侧步开合', '5徒手深蹲', '6交替提膝'])
    await page.getByRole('link', { name: /开始完整训练/ }).click()
    await expect(page).toHaveURL(/\/train$/)
    await expect(page.getByRole('heading', { name: '今日训练 · 肩部活动引导' })).toBeVisible()
    await expect(page.getByText('第 1 / 6 项 · 实时姿态识别与动作纠正')).toBeVisible()
  })

  test('D: Home → 热身训练 → 徒手深蹲 opens free training on /train?exercise=squat without fast', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('mode-card-smart-training').click()
    await page.getByRole('link', { name: '开始徒手深蹲' }).click()
    await expect(page).toHaveURL(/\/train\?exercise=squat$/)
    expect(new URL(page.url()).searchParams.has('fast')).toBe(false)
    await expect(page.getByRole('heading', { name: '自由训练 · 徒手深蹲专项' })).toBeVisible()
    await expect(page.getByText('单个动作 · 实时姿态识别与动作纠正')).toBeVisible()
    await expect(page.getByText('自由训练 · 单个动作，达到目标后自动保存')).toBeVisible()
    await expect(page.getByRole('button', { name: '启用摄像头' })).toBeVisible()

    await page.goto('/smart-training')
    for (const [name, id] of [['肩部环绕', 'shoulder_rotation'], ['双臂上举', 'overhead_raise'], ['侧平举', 'lateral_raise'], ['侧步开合', 'step_jack'], ['徒手深蹲', 'squat'], ['交替提膝', 'knee_raise']]) {
      await expect(page.getByRole('link', { name: `开始${name}` })).toHaveAttribute('href', `/train?exercise=${id}`)
    }
  })

  test('E: the four routines lead to their entry pages while 动作工坊 stays coming soon and leads nowhere', async ({ page }) => {
    await page.goto('/')
    for (const [id, title] of [['baduanjin', '八段锦'], ['taijiquan', '太极拳'], ['wuqinxi', '五禽戏'], ['yijinjing', '易筋经']]) {
      const card = page.getByTestId(`mode-card-${id}`)
      await expect(card, id).toHaveAttribute('href', `/routines/${id}`)
      await expect(card, id).toHaveAccessibleName(`开始跟练 · ${title}`)
      await expect(card, id).not.toContainText('即将开放')
      await card.click()
      await expect(page).toHaveURL(new RegExp(`/routines/${id}$`))
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await page.goto('/')
    }
    const workshop = page.getByTestId('home-workshop')
    await expect(workshop).toContainText('即将开放')
    await expect(workshop.getByRole('link')).toHaveCount(0)
    await expect(workshop.getByRole('button')).toHaveCount(0)
    await workshop.click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('link', { name: /动作工坊/ })).toHaveCount(0)
  })

  test('F: Home → 我的训练 opens History, and every page can get back Home', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('home-history-link').click()
    await expect(page).toHaveURL(/\/history$/)
    await expect(page.getByRole('heading', { level: 1, name: '我的训练', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '返回首页' }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/train?exercise=knee_raise')
    const nav = page.getByRole('navigation', { name: '主导航' })
    await expect(nav.getByRole('link', { name: '首页' })).toHaveAttribute('href', '/')
    await expect(nav.getByRole('link', { name: '我的训练' })).toHaveAttribute('href', '/history')
    await expect(nav.getByRole('link', { name: '开始训练' })).toHaveAttribute('aria-current', 'page')
    await expect(nav).not.toContainText(/智能训练|功法跟练/)
    // 开始训练 returns to Home's training section instead of a separate page.
    await nav.getByRole('link', { name: '开始训练' }).click()
    await expect(page).toHaveURL(/\/#start-training$/)
    await expect(page.getByRole('heading', { name: '开始训练', exact: true })).toBeFocused()
    await expect(page.getByTestId('mode-card-yijinjing')).toBeInViewport()
    await expect(page.getByTestId('home-training-history')).toContainText('还没有训练记录')
  })

  test('responsive audit: Home and smart-training never overflow the target viewports', async ({ page }) => {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      for (const path of ['/', '/smart-training']) {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} ${viewport.width}`).toBe(true)
      }
      await page.goto('/')
      await expect(page.getByTestId('mode-card-smart-training')).toBeInViewport()
      await page.screenshot({ path: `test-results/phase8g-home-${viewport.width}x${viewport.height}.png`, fullPage: true })
      await page.goto('/smart-training')
      await page.screenshot({ path: `test-results/phase8g-smart-training-${viewport.width}x${viewport.height}.png`, fullPage: true })
    }
  })
})

test.describe('8G free-training session semantics', () => {
  test('a finished free squat saves a single-exercise session that Report and History present as free training', async ({ page }) => {
    test.setTimeout(150_000)
    await markOnboardingSeen(page)
    await page.goto('/train?demo=1&course=1&fixture=synthetic&exercise=squat')
    await expect(page.getByRole('heading', { name: '自由训练 · 徒手深蹲专项' })).toBeVisible()
    await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 110_000 })
    await expect(page.getByRole('alertdialog')).toContainText('徒手深蹲自由训练已完成')

    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]') as TrainingSessionState[], SESSION_STORAGE_KEY)
    expect(saved).toHaveLength(1)
    const session = saved[0]
    expect(session).toMatchObject({ exerciseOrder: ['squat'], activeExerciseId: 'squat', status: 'completed', courseStatus: 'completed', mode: 'normal', source: 'synthetic' })
    expect(session.exercises.map((item) => item.exerciseId)).toEqual(['squat'])
    expect(session.exercises[0].repetitions.length).toBeGreaterThanOrEqual(6)

    await page.getByRole('button', { name: '查看训练报告' }).click()
    await expect(page).toHaveURL(`/report/${session.id}`)
    const hero = page.getByTestId('report-summary')
    await expect(hero).toContainText('自由训练 · 徒手深蹲 · 已完成')
    await expect(hero).toContainText('已完成动作平均分')
    await expect(hero).not.toContainText('综合评分')
    await expect(hero).toContainText('自由训练只评估本次动作，不参与完整课程的历史对比和长期趋势。')
    await expect(page.getByTestId('report-capabilities')).toHaveCount(0)
    await expect(page.getByTestId('report-progress')).toHaveCount(0)
    await expect(page.getByTestId('report-exercises').locator('details')).toHaveCount(1)
    await expect(page.getByTestId('report-analysis-summary')).toContainText(`本次自由训练完成徒手深蹲 ${session.exercises[0].repetitions.length} / 6 次`)

    // The same saved record, as a real camera session would store it, next to three full courses.
    const courses = [1, 2, 3].map((day) => makeSession({ id: `course-${day}`, startedAt: at(day) }))
    const live = { ...session, source: 'live' as const }
    await page.evaluate(({ key, records }) => localStorage.setItem(key, JSON.stringify(records)), { key: SESSION_STORAGE_KEY, records: [...courses, live] })
    await page.goto('/history')
    const card = page.getByTestId(`history-card-${session.id}`)
    await expect(card).toBeVisible()
    await expect(card.getByTestId('history-free-training-label')).toHaveText('自由训练 · 徒手深蹲')
    await expect(card).toContainText('训练完成')
    await expect(card).toContainText('已完成动作平均分')
    await expect(page.getByTestId('history-list').locator('article')).toHaveCount(4)
    await expect(page.getByRole('list', { name: '评分趋势数据' }).getByRole('listitem')).toHaveCount(3)

    await page.goto(`/report/${session.id}`)
    await page.getByRole('button', { name: '再次训练' }).click()
    await expect(page).toHaveURL(/\/train\?exercise=squat$/)
    await expect(page.getByRole('heading', { name: '自由训练 · 徒手深蹲专项' })).toBeVisible()
  })

  test('ending a free training early saves it as unfinished free training', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/train?demo=1&course=1&fixture=synthetic&exercise=lateral_raise')
    await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 20_000 })
    await page.getByRole('button', { name: '结束训练' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('结束后会保存当前结果，本次自由训练记为未完成。')
    await page.getByRole('button', { name: '结束并保存' }).click()
    await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible()
    await expect(page.getByRole('alertdialog')).toContainText('自由训练提前结束，已保存当前结果')
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]') as TrainingSessionState[], SESSION_STORAGE_KEY)
    expect(saved.at(-1)).toMatchObject({ exerciseOrder: ['lateral_raise'], courseStatus: 'incomplete', status: 'completed' })
    await page.getByRole('button', { name: '查看训练报告' }).click()
    await expect(page.getByTestId('report-summary')).toContainText('自由训练 · 侧平举 · 未完成')
  })
})
