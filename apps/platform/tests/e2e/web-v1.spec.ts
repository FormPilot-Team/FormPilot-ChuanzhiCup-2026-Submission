import { expect, test, type Page } from '@playwright/test'
import { ROUTINE_SESSION_STORAGE_KEY } from '../../src/features/routines/session/RoutineSessionRepository'
import { SESSION_STORAGE_KEY } from '../../src/features/training/LocalStorageTrainingSessionRepository'
import type { RoutineSessionRecord } from '../../src/features/routines/session/types'
import type { TrainingSessionState } from '../../src/features/training/types'
import { makeSession } from '../analysis-fixtures'
import { routineRecord } from '../helpers/routineFixtures'
import { markOnboardingSeen } from './support/onboarding'

// FormPilot Web V1 (six boards, #52 design). Simulated inputs are named as such: the scripted camera, the DEV-only
// synthetic pose fixture and seeded local records. None of these tests is a real-camera or real-person test.

type CameraWindow = Window & { __cameraCalls?: number; __cameraScript?: string[] }

/** Counts getUserMedia calls; each call takes the next scripted outcome ('ok' or a DOMException name). */
async function scriptedCamera(page: Page, script: string[] = []) {
  await page.addInitScript(({ outcomes }) => {
    const test = window as CameraWindow
    test.__cameraCalls = 0
    test.__cameraScript = [...outcomes]
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        test.__cameraCalls = (test.__cameraCalls ?? 0) + 1
        const outcome = test.__cameraScript?.shift() ?? 'ok'
        if (outcome !== 'ok') throw new DOMException('scripted', outcome)
        const canvas = document.createElement('canvas')
        canvas.width = 1280
        canvas.height = 720
        canvas.getContext('2d')?.fillRect(0, 0, canvas.width, canvas.height)
        return canvas.captureStream(30)
      },
    })
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [{ kind: 'videoinput', label: '', deviceId: '', groupId: '' }] })
  }, { outcomes: script })
}

const cameraCalls = (page: Page) => page.evaluate(() => (window as CameraWindow).__cameraCalls ?? 0)

async function seed(page: Page, training: TrainingSessionState[], routines: RoutineSessionRecord[]) {
  await page.addInitScript(({ trainingKey, routineKey, trainingValue, routineValue }) => {
    if (!localStorage.getItem(trainingKey)) localStorage.setItem(trainingKey, trainingValue)
    if (!localStorage.getItem(routineKey)) localStorage.setItem(routineKey, routineValue)
  }, { trainingKey: SESSION_STORAGE_KEY, routineKey: ROUTINE_SESSION_STORAGE_KEY, trainingValue: JSON.stringify(training), routineValue: JSON.stringify(routines) })
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    // A missing optional media file (e.g. a routine MP4 absent from a CI checkout) is not an app error.
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text())
  })
  return errors
}

const BOARDS: ReadonlyArray<[string, string, string]> = [
  ['home', '/', '首页'], ['training', '/training', '训练中心'], ['routines', '/routines', '功法训练'],
  ['games', '/games', '游戏中心'], ['coach', '/coach', 'AI Coach'], ['me', '/me', '我的'],
]

test.beforeEach(async ({ page }) => {
  await markOnboardingSeen(page)
})

test('Web V1 A: the six boards are reachable from the top navigation, without touching the camera', async ({ page }) => {
  const errors = collectErrors(page)
  await scriptedCamera(page)
  await page.goto('/')
  await expect(page.getByTestId('web-home')).toBeVisible()
  await expect(page.getByTestId('home-trust')).toContainText('完成第一次训练后')
  const nav = page.getByRole('navigation', { name: '主导航' })
  for (const [id, path, label] of BOARDS) {
    await nav.getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : `${path}$`}`))
    // AI Coach opens on the design's full-screen intro (no navigation), like the #52 prototype.
    if (id === 'coach') await page.getByTestId('coach-enter').click()
    await expect(page.getByTestId(`web-nav-${id}`)).toHaveAttribute('aria-current', 'page')
  }
  expect(await cameraCalls(page)).toBe(0)
  expect(errors).toEqual([])
})

test('Web V1 B: phone width uses the bottom tabs and has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const [, path] of BOARDS) {
    await page.goto(path)
    if (path === '/coach') await page.getByTestId('coach-enter').click()
    await expect(page.getByTestId('web-bottom-tabs')).toBeVisible()
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeHidden()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, path).toBeLessThanOrEqual(1)
  }
  await page.goto('/')
  await page.getByTestId('web-bottom-tabs').getByRole('link', { name: /功法训练/ }).click()
  await expect(page).toHaveURL(/\/routines$/)
  await expect(page.getByTestId('routines-index')).toBeVisible()
})

test('Web V1 C: 训练中心 leads to the real training pages; the camera is asked for only on the preparation page', async ({ page }) => {
  await scriptedCamera(page, ['NotAllowedError'])
  await page.goto('/training')
  await expect(page.getByTestId('training-free-options').locator('article')).toHaveCount(6)
  await page.getByTestId('training-start-smart').click()
  await expect(page).toHaveURL(/\/smart-training$/)
  expect(await cameraCalls(page)).toBe(0)
  await page.goto('/training')
  await page.getByTestId('training-free-lateral_raise').click()
  await expect(page).toHaveURL(/\/train\?exercise=lateral_raise$/)
  expect(await cameraCalls(page)).toBe(0)
  await page.getByRole('button', { name: '启用摄像头' }).click()
  await expect(page.getByTestId('camera-failure')).toHaveAttribute('data-camera-failure', 'permission_denied')
  expect(await cameraCalls(page)).toBe(1)
})

test('Web V1 D: a (synthetic, DEV-only) warm-up run is saved, then 我的 and the report read the real record', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/?demo=1&fast=1&fixture=synthetic')
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 90_000 })
  const id = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]').at(-1)?.id as string | undefined, SESSION_STORAGE_KEY)
  expect(id).toBeTruthy()
  // Synthetic sessions are kept out of the formal history (same rule as History); Home/我的 must not count them.
  await page.goto('/me')
  await expect(page.getByTestId('me-stats')).toContainText('0累计训练')
  await page.goto(`/report/${id}`)
  await expect(page.getByText('正在读取训练报告')).toBeHidden({ timeout: 15_000 })
  await expect(page.getByTestId('web-topbar')).toBeVisible()
})

test('Web V1 E: seeded local records appear on Home, 我的 and History, and open their report and come back', async ({ page }) => {
  const errors = collectErrors(page)
  const now = Date.now()
  await seed(page,
    [makeSession({ id: 'web-course-1', startedAt: now - 3 * 86_400_000 }), makeSession({ id: 'web-course-2', startedAt: now - 2 * 86_400_000 })],
    [routineRecord({ id: 'web-routine-1', startedAt: now - 86_400_000, chapters: { 'bdj-2': { similarity: 0.55 } } })])
  await page.goto('/')
  await expect(page.getByTestId('home-trust')).toContainText('本机已完成 3 次训练')
  await expect(page.getByTestId('home-continue')).toContainText('八段锦 · 整套跟练')
  await page.goto('/me')
  await expect(page.getByTestId('me-stats')).toContainText('3累计训练')
  await expect(page.getByTestId('me-trend')).toBeVisible()
  await page.getByTestId('me-filter-routine').click()
  await expect(page.getByTestId('me-history').locator('.history-item')).toHaveCount(1)
  await page.getByTestId('me-filter-game').click()
  await expect(page.getByTestId('me-games-empty')).toContainText('游戏成绩不进入训练记录')
  await page.getByTestId('me-filter-all').click()
  await page.getByRole('link', { name: '查看报告：八段锦 · 整套跟练' }).click()
  await expect(page).toHaveURL(/\/report\/web-routine-1$/)
  await expect(page.getByTestId('routine-report-focus')).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/me$/)
  await page.getByTestId('me-history-all').click()
  await expect(page).toHaveURL(/\/history$/)
  await page.reload()
  await expect(page.getByTestId('history-list')).toBeVisible()
  expect(errors).toEqual([])
})

test('Web V1 F: 功法训练 → detail → 标准示范 → chapter → training route, with platform routine ids', async ({ page }) => {
  await page.goto('/routines')
  await expect(page.getByTestId('routines-index').locator('article')).toHaveCount(4)
  await page.getByRole('button', { name: '力量' }).click()
  await expect(page.getByTestId('routines-index').locator('article')).toHaveCount(1)
  await page.getByRole('button', { name: '全部' }).click()
  await page.getByTestId('routine-open-baduanjin').click()
  await expect(page).toHaveURL(/\/routines\/baduanjin$/)
  await page.getByTestId('routine-demo-bdj-3').click()
  const video = page.getByTestId('routine-demo-video')
  // With the MP4 present the video seeks to the chapter; without it the page says so instead of pretending.
  await expect.poll(async () => (await page.getByTestId('routine-demo-error').count()) > 0 || await video.evaluate((element: HTMLVideoElement) => element.currentTime >= 200), { timeout: 20_000 }).toBe(true)
  await page.getByTestId('routine-form-bdj-3').click()
  await expect(page).toHaveURL(/\/routines\/baduanjin\/train\?form=bdj-3$/)
  await page.goBack()
  await page.getByTestId('routine-back').click()
  await expect(page).toHaveURL(/\/routines$/)
})

async function fillProfileP(page: Page, risk = 'none') {
  const profile = page.getByTestId('coach-profile')
  for (const label of ['上肢动作练习', '肩部僵硬', '肩部', '上肢']) await profile.locator('label.check-chip', { hasText: new RegExp(`^${label}$`) }).locator('input').check()
  await page.locator('#coach-risk').selectOption(risk)
  await page.getByTestId('coach-ack').check()
  await page.getByTestId('coach-submit').click()
}

test('Web V1 G: AI Coach OFF shows the rule recommendation, the fixed five questions and a real training link', async ({ page }) => {
  const requests: string[] = []
  await page.goto('/coach')
  await page.getByTestId('coach-enter').click()
  page.on('request', (request) => requests.push(request.url()))
  await page.getByTestId('coach-submit').click()
  await expect(page.getByTestId('coach-profile-required')).toBeVisible()
  await page.getByTestId('coach-link-profile').click()
  await fillProfileP(page)
  const result = page.getByTestId('coach-result')
  await expect(page.getByTestId('coach-origin')).toHaveText('规则推荐')
  await expect(result.locator('.fpw-rec h3')).toHaveText(['八段锦 · 两手托天理三焦', '八段锦 · 左右开弓似射雕', '八段锦 · 调理脾胃须单举', '八段锦', '摘苹果', '林间射箭'])
  await expect(page.getByTestId('coach-shadow-panel')).toHaveCount(0)
  expect(requests.filter((url) => !/\.(js|css|png|jpg|svg|woff2?)(\?|$)/.test(url) && !url.includes('/@') && !url.includes('/node_modules/') && !url.includes('/src/'))).toEqual([])
  await page.getByTestId('coach-link-questions').click()
  await page.getByTestId('coach-ask-why').click()
  await expect(page.getByTestId('coach-answer-why')).toBeVisible()
  await page.getByTestId('coach-link-plan').click()
  await expect(page.getByTestId('coach-plan').locator('.plan-item')).toHaveCount(5)
  await page.getByTestId('coach-link-result').click()
  await page.getByTestId('coach-start-first').click()
  await expect(page).toHaveURL(/\/routines\/baduanjin\/train\?form=bdj-1$/)
})

test('Web V1 H: AI Coach pauses on a risk profile and shows nothing to train', async ({ page }) => {
  await page.goto('/coach?view=profile')
  await fillProfileP(page, 'dizziness')
  await expect(page.getByTestId('coach-safety-hold')).toContainText('暂停推荐')
  await expect(page.getByTestId('coach-result').locator('.fpw-rec')).toHaveCount(0)
})

test('Web V1 I: SHADOW (DEV switch) keeps the rule display, adds the labelled panel and logs only ids', async ({ page }) => {
  await page.goto('/coach?view=profile&coachMode=shadow')
  await fillProfileP(page)
  await expect(page.getByTestId('coach-origin')).toHaveText('规则推荐')
  await expect(page.getByTestId('coach-shadow-panel')).toContainText('实验性模型：AI 标注训练，项目负责人已审阅标签，尚未进行独立人工或专家标注')
  await expect(page.getByTestId('coach-shadow-meta')).toContainText('fallback SHADOW_MODE')
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('formpilot.coach-decision-shadow-log:v1') ?? '[]'))
  expect(log).toHaveLength(1)
  expect(log[0].displayed).toEqual(log[0].rules)
  expect(JSON.stringify(log[0])).not.toMatch(/stiffness|upper_limb|acknowledged/)
  // Abstention (out-of-distribution profile, §9 item 6) still shows the rules.
  await page.getByTestId('coach-link-profile').click()
  for (const label of ['上肢动作练习', '肩部僵硬', '上肢']) await page.getByTestId('coach-profile').locator('label.check-chip', { hasText: new RegExp(`^${label}$`) }).locator('input').uncheck()
  for (const label of ['肩颈活动练习', '暂无不适', '颈部', '上肢', '下肢']) await page.getByTestId('coach-profile').locator('label.check-chip', { hasText: new RegExp(`^${label}$`) }).locator('input').check()
  await page.locator('#coach-preference').selectOption('routine')
  await page.getByTestId('coach-submit').click()
  await expect(page.getByTestId('coach-shadow-meta')).toContainText('abstain OUT_OF_DISTRIBUTION')
  await expect(page.getByTestId('coach-origin')).toHaveText('规则推荐')
})

test('Web V1 J: 动作工坊 opens from 训练中心 and 我的 under its correct name', async ({ page }) => {
  await page.goto('/training')
  await page.getByTestId('training-open-workshop').click()
  await expect(page).toHaveURL(/\/workshop$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('动作工坊')
  await expect(page.locator('body')).not.toContainText('动作工作坊')
  await page.goto('/me')
  await page.getByTestId('me-open-workshop').click()
  await expect(page).toHaveURL(/\/workshop$/)
  await expect(page.getByTestId('web-nav-me')).toHaveAttribute('aria-current', 'page')
})

test('Web V1 K: with no game service the game center says it is not connected and offers only the way back', async ({ page, context }) => {
  await context.route('http://127.0.0.1:5181/**', (route) => route.abort())
  await page.goto('/games')
  await expect(page.getByTestId('games-service')).toContainText('体感游戏服务未启动')
  await page.getByTestId('game-start-apple').click()
  await expect(page.getByTestId('game-unavailable')).toContainText('尚未接入')
  await expect(page.getByTestId('game-launch')).toHaveCount(0)
  await page.getByTestId('game-return').click()
  await expect(page.getByTestId('game-dialog')).not.toHaveAttribute('open', '')
})

test('Web V1 L: with Motion Games Lab running, a game opens in its own window and closing it returns to the game center', async ({ page, context, request }) => {
  const reachable = await request.get('http://127.0.0.1:5181/').then((response) => response.ok()).catch(() => false)
  test.skip(!reachable, 'Motion Games Lab preview (pnpm --dir apps/motion-games-lab/app preview) is not running')
  await page.goto('/games')
  await expect(page.getByTestId('games-service')).toContainText('已连接')
  await page.getByTestId('game-start-archery').click()
  const popupPromise = context.waitForEvent('page')
  await page.getByTestId('game-launch').click()
  const popup = await popupPromise
  await expect(popup).toHaveURL(/127\.0\.0\.1:5181\/\?game=archery$/)
  await popup.waitForLoadState('domcontentloaded')
  await expect(popup.locator('body')).toContainText('射箭', { timeout: 20_000 })
  await expect(page.getByTestId('game-running')).toBeVisible()
  await popup.close()
  await expect(page.getByTestId('game-running')).toHaveCount(0, { timeout: 5_000 })
  await expect(page.getByTestId('game-card-archery')).toBeVisible()
})

test('Web V1 M: AI Coach links a recommended game to its card in the game center', async ({ page, context }) => {
  await context.route('http://127.0.0.1:5181/**', (route) => route.abort())
  await page.goto('/games?game=boating')
  await expect(page.getByTestId('game-dialog')).toHaveAttribute('open', '')
  await expect(page.locator('#game-dialog-title')).toHaveText('林间划船')
})
