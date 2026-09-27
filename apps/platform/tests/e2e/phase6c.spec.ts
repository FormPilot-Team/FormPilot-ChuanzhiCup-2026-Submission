import { expect, test } from '@playwright/test'
import { markOnboardingSeen } from './support/onboarding'

const setForceNoPose = (page: import('@playwright/test').Page, value: boolean) => page.evaluate((next) => {
  (window as typeof window & { __forceNoPose?: boolean }).__forceNoPose = next
}, value)

const activeMotionSeconds = async (page: import('@playwright/test').Page) => Number.parseFloat((await page
  .getByRole('complementary', { name: '开发调试信息' })
  .locator('dt', { hasText: 'Active motion' })
  .locator('..').locator('dd').textContent()) ?? '0')

test('formal Home opens Training and Report navigation closes the user loop', async ({ page }) => {
  test.setTimeout(90_000)
  await markOnboardingSeen(page)
  await page.goto('/')
  await expect(page).toHaveTitle('FormPilot')
  await expect(page.getByRole('heading', { name: 'FormPilot', level: 1 })).toBeVisible()
  await page.getByRole('link', { name: '开始训练 · 热身训练' }).click()
  await expect(page).toHaveURL(/\/smart-training$/)
  const courseOrder = page.getByRole('list', { name: '完整训练动作顺序' })
  for (const name of ['肩部环绕', '双臂上举', '侧平举', '侧步开合', '徒手深蹲', '交替提膝']) {
    await expect(courseOrder.getByText(name, { exact: true })).toBeVisible()
  }
  await page.getByRole('link', { name: /开始完整训练/ }).click()
  await expect(page).toHaveURL(/\/train$/)
  await expect(page).toHaveTitle('FormPilot · 训练')
  await expect(page.getByRole('complementary', { name: '开发调试信息' })).toHaveCount(0)
  await expect(page.getByText(/synthetic fixture|thresholdVersion|reference skeleton/i)).toHaveCount(0)

  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic')
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 75_000 })
  await page.getByRole('button', { name: '查看训练报告' }).click()
  const reportUrl = page.url()
  await expect(page).toHaveTitle('FormPilot · 训练报告')
  await page.getByRole('button', { name: '返回首页' }).first().click()
  await expect(page).toHaveURL(/\/$/)

  await page.goto(reportUrl)
  const previousId = reportUrl.split('/').at(-1)
  await page.getByRole('button', { name: '再次训练' }).click()
  await expect(page).toHaveURL(/\/train$/)
  await expect(page.getByRole('heading', { name: '今日训练 · 肩部活动引导' })).toBeVisible()
  await expect.poll(() => page.evaluate((oldId) => JSON.parse(localStorage.getItem('ai-coach.sessions:v2') ?? '[]')
    .some((item: { id: string; status: string }) => item.id !== oldId && item.status === 'active'), previousId)).toBe(true)
})

test('sustained no-pose resets countdown, freezes ACTIVE, clears skeleton, but not TRANSITION or completion', async ({ page }) => {
  test.setTimeout(100_000)
  await page.goto('/train?demo=1&course=1&fixture=synthetic&debug=1')
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'ready', { timeout: 8_000 })
  await setForceNoPose(page, true)
  await expect(page.getByTestId('course-state')).toHaveText('请回到画面中，确保上半身和髋部完整入镜', { timeout: 2_000 })
  await page.waitForTimeout(3_200)
  await expect(page.getByTestId('course-state')).toHaveText('请回到画面中，确保上半身和髋部完整入镜')
  await setForceNoPose(page, false)
  await expect(page.getByTestId('ai-coach-dock')).toHaveAttribute('data-coach-state', 'ready', { timeout: 2_000 })
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 5_000 })

  await expect(page.getByTestId('pose-overlay')).toBeHidden()
  await setForceNoPose(page, true)
  await expect(page.getByTestId('course-state')).toHaveText('请回到画面中，确保上半身和髋部完整入镜', { timeout: 2_000 })
  const atUnavailable = await activeMotionSeconds(page)
  await page.waitForTimeout(900)
  expect(await activeMotionSeconds(page)).toBe(atUnavailable)
  await expect(page.getByTestId('pose-overlay')).toBeHidden()

  await page.goto('/train?demo=1&course=1&fast=1&fixture=synthetic')
  await expect(page.getByTestId('course-state')).toContainText('完成', { timeout: 8_000 })
  await setForceNoPose(page, true)
  await expect(page.getByRole('heading', { name: '今日训练 · 双臂上举专项' })).toBeVisible({ timeout: 2_000 })
  await expect(page.getByTestId('course-state')).toHaveText('请回到画面中，确保上半身和髋部完整入镜')
  await setForceNoPose(page, false)
  await expect(page.getByRole('heading', { name: '今日训练 · 原地交替提膝专项' })).toBeVisible({ timeout: 45_000 })
  await expect(page.getByTestId('course-state')).toContainText('完成', { timeout: 12_000 })
  await setForceNoPose(page, true)
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 3_000 })
})

test('camera permission and device failures use actionable Chinese states without dead controls', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const name = (window as typeof window & { __cameraFailure?: string }).__cameraFailure
      if (name === 'Pending') return new Promise<MediaStream>(() => undefined)
      throw new DOMException('internal browser detail', name || 'UnknownError')
    } })
  })
  await page.goto('/train')
  await page.evaluate(() => { (window as typeof window & { __cameraFailure?: string }).__cameraFailure = 'Pending' })
  await page.getByRole('button', { name: '启用摄像头' }).click()
  await expect(page.getByText('正在等待摄像头授权…')).toBeVisible()
  await expect(page.getByText('正在加载姿态识别模型…')).toHaveCount(0)

  for (const [name, message] of [
    ['NotAllowedError', '摄像头权限未开启。请在浏览器的网站权限中允许摄像头，然后重新尝试。'],
    ['NotFoundError', '未检测到可用摄像头，请确认设备已连接。'],
    ['NotReadableError', '摄像头当前无法读取，可能正在被其他应用占用。'],
    ['OverconstrainedError', '当前摄像头不支持所需的视频参数，FormPilot 已尝试兼容设置，仍无法打开。'],
  ]) {
    await page.goto('/train')
    await page.evaluate((failure) => { (window as typeof window & { __cameraFailure?: string }).__cameraFailure = failure }, name)
    await page.getByRole('button', { name: '启用摄像头' }).click()
    await expect(page.getByText(message)).toBeVisible()
    await expect(page.getByRole('button', { name: '重新检测' })).toBeVisible()
    await expect(page.getByText('internal browser detail')).toHaveCount(0)
  }
  await expect(page.getByText('Step Jack', { exact: true })).toHaveCount(0)
  await expect(page.getByText('王小明')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /尚未启用/ })).toHaveCount(0)
})

test('model initialization failure clears the rejected cache and Retry initializes again', async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 1280
      canvas.height = 720
      const context = canvas.getContext('2d')
      context?.fillRect(0, 0, canvas.width, canvas.height)
      return canvas.captureStream(30)
    } })
  })
  // The failure arrives after a moment, as a slow network would, so the loading state is observable first.
  await page.route('**/models/pose_landmarker_lite.task', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800))
    await route.abort('failed')
  })
  await page.goto('/train?debug=1')
  await page.getByRole('button', { name: '启用摄像头' }).click()
  await expect(page.getByText('正在加载姿态识别模型…')).toBeVisible()
  await expect(page.getByText('姿态识别模型加载失败，请重试。')).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => (window as typeof window & { __poseDetector: { initializationCount: number } }).__poseDetector.initializationCount)).toBe(1)

  await page.unroute('**/models/pose_landmarker_lite.task')
  await page.getByRole('button', { name: '重新尝试' }).click()
  await expect(page.getByText(/摄像头已连接/)).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => (window as typeof window & { __poseDetector: { initializationCount: number } }).__poseDetector.initializationCount)).toBe(2)
})
