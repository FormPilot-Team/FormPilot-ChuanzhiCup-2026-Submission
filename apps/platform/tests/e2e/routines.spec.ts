import { expect, test, type Page } from '@playwright/test'
import { ROUTINE_SESSION_STORAGE_KEY } from '../../src/features/routines/session/RoutineSessionRepository'
import type { RoutineSessionRecord } from '../../src/features/routines/session/types'
import { routineRecord } from '../helpers/routineFixtures'
import { markOnboardingSeen } from './support/onboarding'

type TestWindow = Window & { __gestureTestPose?: 'start' | 'none'; __forceNoPose?: boolean; __fakeCamera?: HTMLVideoElement }

const routineState = (page: Page) => page.getByTestId('routine-state')
const similarity = (page: Page) => page.getByTestId('routine-similarity')

async function expectCourseState(page: Page, state: string, timeout = 30_000) {
  await expect(routineState(page)).toHaveAttribute('data-course-state', state, { timeout })
}

async function stageTime(page: Page): Promise<number> {
  return page.getByTestId('routine-stage-video').evaluate((video: HTMLVideoElement) => video.currentTime)
}

async function stagePaused(page: Page): Promise<boolean> {
  return page.getByTestId('routine-stage-video').evaluate((video: HTMLVideoElement) => video.paused)
}

async function savedRecords(page: Page): Promise<RoutineSessionRecord[]> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]') as RoutineSessionRecord[], ROUTINE_SESSION_STORAGE_KEY)
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function seedRoutineRecords(page: Page, records: RoutineSessionRecord[]) {
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value)
  }, { key: ROUTINE_SESSION_STORAGE_KEY, value: JSON.stringify(records) })
}

test.beforeEach(async ({ page }) => {
  await markOnboardingSeen(page)
})

test('Routine A: Home and the 功法训练 board lead to every routine, its entry page and its training route', async ({ page }) => {
  // Web V1: Home → 功法训练 quick entry → routine card.
  await page.goto('/')
  await page.getByTestId('home-quick-routines').click()
  await page.getByTestId('routine-open-baduanjin').click()
  await expect(page).toHaveURL(/\/routines\/baduanjin$/)
  await expect(page.getByRole('heading', { level: 1, name: '八段锦' })).toBeVisible()
  await expect(page.getByTestId('routine-forms').locator('li')).toHaveCount(10)
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '功法训练', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('routine-start-full').click()
  await expect(page).toHaveURL(/\/routines\/baduanjin\/train$/)
  await expect(page.getByRole('heading', { level: 1, name: '八段锦 · 整套跟练' })).toBeVisible()
  await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-status', 'ready', { timeout: 20_000 })
  await expect(page.getByTestId('routine-stage-video')).toHaveAttribute('src', '/assets/routines/baduanjin-standard.mp4')
  await expect(page.getByRole('button', { name: '启用摄像头' })).toBeVisible()
  await expect(routineState(page)).toContainText('启用摄像头后开始')

  await page.goto('/routines')
  await expect(page.getByRole('heading', { level: 1, name: '功法选择' })).toBeVisible()
  for (const id of ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']) await expect(page.getByTestId(`routine-open-${id}`)).toHaveAttribute('href', `/routines/${id}`)
  await page.getByTestId('routine-open-taijiquan').click()
  await expect(page.getByTestId('routine-forms').locator('li')).toHaveCount(24)
  await page.getByTestId('routine-form-tjq-10').click()
  await expect(page).toHaveURL(/\/routines\/taijiquan\/train\?form=tjq-10$/)
  await expect(page.getByRole('heading', { level: 1, name: '太极拳 · 第十式 · 云手' })).toBeVisible()
  await expect(page.getByTestId('routine-ribbon').locator('li')).toHaveCount(1)

  await page.goto('/routines/not-a-routine')
  await expect(page.getByTestId('routine-not-found')).toBeVisible()
})

test('Routine B: the start gesture begins the standard video and a faithful follower is in sync', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/routines/baduanjin/train?fixture=synthetic&debug=1')
  await expectCourseState(page, 'ACTIVE')
  await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-playing', 'true')
  await expect(similarity(page)).toHaveAttribute('data-match-status', 'in_sync', { timeout: 15_000 })
  await expect.poll(async () => Number(await similarity(page).getAttribute('data-match-similarity')), { timeout: 15_000 }).toBeGreaterThanOrEqual(90)
  const before = await stageTime(page)
  await page.waitForTimeout(1500)
  expect(await stageTime(page)).toBeGreaterThan(before + 0.8)
  await expect(page.getByTestId('routine-rhythm')).toContainText('节奏同步')
  await expect(page.getByTestId('routine-tracking')).toHaveText('识别正常')
  await expect(page.getByTestId('pose-overlay')).toBeHidden()
  const [record] = await savedRecords(page)
  expect(record).toMatchObject({ programId: 'baduanjin', scope: { kind: 'full' }, source: 'synthetic', mode: 'normal', outcome: 'in_progress' })
  expect(record.matcher).toEqual({ version: 'follow-along-v1', available: true })
  expect(errors).toEqual([])
})

test('Routine C: pause and resume by button, Space and the resume gesture control the standard video', async ({ page }) => {
  await page.goto('/routines/taijiquan/train?fixture=synthetic')
  await expectCourseState(page, 'ACTIVE')
  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(routineState(page)).toHaveAttribute('data-session-status', 'paused')
  await expect.poll(() => stagePaused(page)).toBe(true)
  await expect(page.getByTestId('routine-stage-paused')).toBeVisible()
  await expect(page.getByTestId('routine-coach-message')).toContainText('已暂停')
  const pausedAt = await stageTime(page)
  await page.waitForTimeout(800)
  expect(await stageTime(page)).toBeCloseTo(pausedAt, 1)

  // Space is handled by the page, not by whichever button last had focus.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Space')
  await expect(routineState(page)).toHaveAttribute('data-session-status', 'active')
  await expect.poll(() => stagePaused(page)).toBe(false)

  await page.keyboard.press('Space')
  await expect(routineState(page)).toHaveAttribute('data-session-status', 'paused')
  await expect(page.getByTestId('gesture-control')).toContainText('继续跟练')
  await page.evaluate(() => { (window as TestWindow).__gestureTestPose = 'start' })
  await expect(routineState(page)).toHaveAttribute('data-session-status', 'active', { timeout: 10_000 })
  await page.evaluate(() => { (window as TestWindow).__gestureTestPose = undefined })
  await expect.poll(() => stagePaused(page)).toBe(false)
})

test('Routine D: losing the pose pauses the video by itself and it continues when the user is back', async ({ page }) => {
  await page.goto('/routines/yijinjing/train?fixture=synthetic')
  await expectCourseState(page, 'ACTIVE')
  await page.evaluate(() => { (window as TestWindow).__forceNoPose = true })
  await expectCourseState(page, 'PAUSED', 10_000)
  await expect(routineState(page)).toHaveAttribute('data-session-status', 'active')
  await expect.poll(() => stagePaused(page)).toBe(true)
  await expect(page.getByTestId('routine-coach-message')).toContainText('请回到画面中')
  await page.evaluate(() => { (window as TestWindow).__forceNoPose = false })
  await expectCourseState(page, 'ACTIVE', 10_000)
  await expect.poll(() => stagePaused(page)).toBe(false)
})

test('Routine E: a late follower is told to catch up and a mirrored follower still matches', async ({ page }) => {
  await page.goto('/routines/baduanjin/train?fixture=synthetic&lag=2')
  await expectCourseState(page, 'ACTIVE')
  // Follow along for a while in a moving form before judging rhythm.
  await page.getByTestId('routine-step-bdj-1').click()
  await expect(similarity(page)).toHaveAttribute('data-match-status', 'behind', { timeout: 20_000 })
  await expect(page.getByTestId('routine-rhythm')).toContainText('稍慢')
  await expect(page.getByTestId('routine-coach-message')).toContainText('稍慢了一点', { timeout: 15_000 })

  await page.goto('/routines/baduanjin/train?fixture=synthetic&mirror=1')
  await expectCourseState(page, 'ACTIVE')
  await page.getByTestId('routine-step-bdj-2').click()
  await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-chapter', 'bdj-2')
  await expect(similarity(page)).toHaveAttribute('data-match-mirrored', 'true', { timeout: 20_000 })
  await expect.poll(async () => Number(await similarity(page).getAttribute('data-match-similarity')), { timeout: 15_000 }).toBeGreaterThanOrEqual(85)
})

test('Routine F: ending early saves an incomplete record and its report shows the followed part', async ({ page }) => {
  await page.goto('/routines/baduanjin/train?fixture=synthetic')
  await expectCourseState(page, 'ACTIVE')
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: '结束训练' }).click()
  await expect(page.getByRole('alertdialog', { name: '确认结束本次跟练？' })).toBeVisible()
  await page.getByRole('button', { name: '结束并保存' }).click()
  const dialog = page.getByTestId('routine-complete-dialog')
  await expect(dialog).toHaveAttribute('data-outcome', 'incomplete')
  await expect(dialog).toContainText('本次跟练已保存')
  await expect(dialog).toContainText('跟练提前结束，已保存已完成的部分')
  const [record] = await savedRecords(page)
  expect(record.outcome).toBe('incomplete')
  expect(record.endedAt).toBeGreaterThan(record.startedAt)
  expect(record.chapters[0].coveredSeconds).toBeGreaterThanOrEqual(3)
  expect(record.chapters[0].samples).toBeGreaterThan(10)
  await page.getByRole('button', { name: '查看跟练报告' }).click()
  await expect(page).toHaveURL(new RegExp(`/report/${record.id}$`))
  await expect(page.getByTestId('report-summary')).toHaveAttribute('data-report-kind', 'routine')
  await expect(page.getByRole('heading', { level: 1, name: '八段锦跟练报告' })).toBeVisible()
  await expect(page.getByTestId('report-summary')).toContainText('本次跟练未完整完成')
  await expect(page.getByTestId('routine-report-chapter-bdj-open')).toContainText('跟练')
  await page.getByTestId('routine-report-notes').locator('summary').click()
  await expect(page.getByTestId('routine-report-notes')).toContainText('测试模式')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: '八段锦跟练报告' })).toBeVisible()
})

test('Routine G: one numbered form completes on its own and its report covers only that form', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/routines/wuqinxi/train?fixture=synthetic&fast=1&form=wqx-5')
  await expect(page.getByRole('heading', { level: 1, name: '五禽戏 · 熊戏 · 熊运' })).toBeVisible()
  await expect(page.getByTestId('routine-ribbon').locator('li')).toHaveCount(1)
  const dialog = page.getByTestId('routine-complete-dialog')
  await expect(dialog).toHaveAttribute('data-outcome', 'completed', { timeout: 60_000 })
  await expect(dialog).toContainText('五禽戏 · 熊戏 · 熊运已完成')
  const [record] = await savedRecords(page)
  expect(record).toMatchObject({ programId: 'wuqinxi', scope: { kind: 'form', chapterId: 'wqx-5' }, outcome: 'completed', mode: 'fast' })
  expect(record.chapters.map((item) => item.chapterId)).toEqual(['wqx-5'])
  expect(record.chapters[0].coveredSeconds).toBeGreaterThanOrEqual(record.chapters[0].totalSeconds - 2)
  await page.getByRole('button', { name: '查看跟练报告' }).click()
  await expect(page.getByTestId('report-summary')).toContainText('跟练完成')
  await expect(page.getByTestId('routine-report-chapters').locator('li')).toHaveCount(1)
})

test('Routine H: the chapter ribbon jumps the video, and a reloaded single-form route keeps its scope', async ({ page }) => {
  await page.goto('/routines/baduanjin/train?fixture=synthetic')
  await expectCourseState(page, 'ACTIVE')
  await expect(page.getByTestId('routine-step-bdj-open')).toHaveAttribute('aria-current', 'step')
  await page.getByTestId('routine-step-bdj-3').click()
  await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-chapter', 'bdj-3')
  expect(await stageTime(page)).toBeGreaterThanOrEqual(221.5)
  await expect(page.getByTestId('routine-current-chapter')).toHaveText('第三式 · 调理脾胃须单举')
  await expect(page.getByTestId('routine-step-bdj-3')).toHaveAttribute('aria-current', 'step')

  await page.goto('/routines/taijiquan/train?form=tjq-10')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: '太极拳 · 第十式 · 云手' })).toBeVisible()
  await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-status', 'ready', { timeout: 20_000 })
  await expect.poll(() => stageTime(page)).toBeGreaterThanOrEqual(177.5)
  await expect(page.getByTestId('routine-step-tjq-10')).toBeDisabled()
})

test('Routine I: History, Home and the report route show saved routine records', async ({ page }) => {
  const day = (offset: number) => Date.UTC(2026, 8, 20 + offset, 2)
  await seedRoutineRecords(page, [
    routineRecord({ id: 'routine-e2e-full', startedAt: day(1), chapters: { 'bdj-2': { similarity: 0.55 } } }),
    routineRecord({ id: 'routine-e2e-form', startedAt: day(2), programId: 'taijiquan', scope: { kind: 'form', chapterId: 'tjq-10' }, outcome: 'incomplete' }),
  ])
  await page.goto('/history')
  const list = page.getByTestId('history-list')
  await expect(list.locator('article')).toHaveCount(1)
  await expect(page.getByTestId('history-card-routine-e2e-full')).toContainText('八段锦 · 整套跟练')
  await expect(page.getByTestId('history-card-routine-e2e-full')).toContainText('重点：第二式 左右开弓似射雕')
  await page.getByText('显示未完成训练').click()
  await expect(list.locator('article')).toHaveCount(2)
  await expect(page.getByTestId('history-card-routine-e2e-form')).toContainText('太极拳 · 第十式 · 云手')
  await page.getByRole('group', { name: '按训练模式筛选' }).getByRole('button', { name: '热身训练' }).click()
  await expect(page.getByTestId('history-incomplete-hidden')).toContainText('换一个筛选条件看看')
  await page.getByRole('group', { name: '按训练模式筛选' }).getByRole('button', { name: '跟练课程' }).click()
  await expect(list.locator('article')).toHaveCount(2)
  await page.getByTestId('history-card-routine-e2e-full').click()
  await expect(page).toHaveURL(/\/report\/routine-e2e-full$/)
  await expect(page.getByTestId('routine-report-focus')).toContainText('重点复习「第二式 · 左右开弓似射雕」')
  // Web V1: Home's 最近训练记录 lists the record and links to its report.
  await page.goto('/')
  await expect(page.getByTestId('home-recent')).toContainText('八段锦 · 整套跟练')
  await expect(page.getByTestId('home-recent').getByRole('link', { name: '查看报告：八段锦 · 整套跟练' })).toHaveAttribute('href', '/report/routine-e2e-full')
})

test('Routine J: the real camera pipeline follows the standard video', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = collectPageErrors(page)
  await page.addInitScript((source) => {
    const fake = async () => {
      const video = document.createElement('video')
      video.src = source
      video.muted = true
      video.playsInline = true
      video.loop = true
      await video.play().catch(() => undefined)
      ;(window as TestWindow).__fakeCamera = video
      return (video as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream()
    }
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: fake })
  }, '/assets/routines/baduanjin-standard.mp4')
  await page.goto('/routines/baduanjin/train')
  await expect(page.getByTestId('routine-stage')).toHaveAttribute('data-stage-status', 'ready', { timeout: 20_000 })
  await page.getByRole('button', { name: '启用摄像头' }).click()
  await expect(page.getByText(/摄像头已连接/)).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => { (window as TestWindow).__gestureTestPose = 'start' })
  await expectCourseState(page, 'ACTIVE')
  await page.evaluate(() => {
    const test = window as TestWindow
    test.__gestureTestPose = undefined
    const stage = document.querySelector<HTMLVideoElement>('[data-testid="routine-stage-video"]')
    if (test.__fakeCamera && stage) test.__fakeCamera.currentTime = stage.currentTime
  })
  await expect.poll(async () => similarity(page).getAttribute('data-match-status'), { timeout: 30_000 }).toMatch(/in_sync|ahead|behind/)
  await expect.poll(async () => Number(await similarity(page).getAttribute('data-match-similarity')), { timeout: 20_000 }).toBeGreaterThanOrEqual(70)
  expect(errors).toEqual([])
})

test('Routine K: routine pages stay inside the target viewports', async ({ page }) => {
  test.setTimeout(180_000)
  await seedRoutineRecords(page, [routineRecord({ id: 'routine-e2e-layout', startedAt: Date.UTC(2026, 8, 21) })])
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const path of ['/routines', '/routines/yijinjing', '/routines/taijiquan/train?fixture=synthetic', '/report/routine-e2e-layout', '/history']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} ${viewport.width}`).toBe(true)
    }
    await page.goto('/routines/baduanjin/train?fixture=synthetic')
    await expectCourseState(page, 'ACTIVE')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `training ${viewport.width}`).toBe(true)
    await page.screenshot({ path: `test-results/routines-training-${viewport.width}x${viewport.height}.png`, fullPage: true })
  }
})

test('Routine L: controls are real, labelled buttons and the end dialog keeps keyboard focus', async ({ page }) => {
  await page.goto('/routines/baduanjin/train?fixture=synthetic')
  await expectCourseState(page, 'ACTIVE')
  await expect(page.getByRole('button', { name: '关闭视频原声' }).or(page.getByRole('button', { name: '开启视频原声' }))).toBeVisible()
  await expect(page.getByRole('button', { name: '跳到第一式 · 两手托天理三焦' })).toBeEnabled()
  await page.getByRole('button', { name: '结束训练' }).focus()
  await page.keyboard.press('Enter')
  const confirm = page.getByRole('alertdialog', { name: '确认结束本次跟练？' })
  await expect(confirm).toBeVisible()
  await expect(confirm.getByRole('button', { name: '继续训练' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(confirm).toBeHidden()
  await expectCourseState(page, 'ACTIVE')
})
