import { expect, test, type Page } from '@playwright/test'
import { markOnboardingSeen } from './support/onboarding'

// Cross-machine compatibility (v3.1), camera half: each way the camera or the pose model can fail on another PC is
// named with what to do, and the diagnostics behind it stay folded away.

type CameraTestWindow = typeof window & {
  __cameraScript?: string[]
  __cameraCalls?: MediaStreamConstraints[]
  __videoInputs?: number
  __formpilotDiagnostics?: Array<{ kind: string; entry: Record<string, unknown> }>
}

/** A scripted camera: each getUserMedia call takes the next outcome ('ok' or an error name); enumerateDevices is faked too. */
async function scriptedCamera(page: Page, script: string[], videoInputs = 1) {
  await page.addInitScript(({ outcomes, inputs }) => {
    const test = window as CameraTestWindow
    test.__cameraScript = [...outcomes]
    test.__videoInputs = inputs
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        test.__cameraCalls = [...(test.__cameraCalls ?? []), constraints]
        const outcome = test.__cameraScript?.shift() ?? 'ok'
        if (outcome !== 'ok') throw new DOMException('internal browser detail', outcome)
        const canvas = document.createElement('canvas')
        canvas.width = 1280
        canvas.height = 720
        canvas.getContext('2d')?.fillRect(0, 0, canvas.width, canvas.height)
        return canvas.captureStream(30)
      },
    })
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      configurable: true,
      value: async () => Array.from({ length: test.__videoInputs ?? 1 }, () => ({ kind: 'videoinput', label: '', deviceId: '', groupId: '' })),
    })
  }, { outcomes: script, inputs: videoInputs })
}

const cameraWindow = (page: Page) => page.evaluate(() => {
  const test = window as CameraTestWindow
  return { calls: test.__cameraCalls ?? [], diagnostics: test.__formpilotDiagnostics ?? [] }
})

test.beforeEach(async ({ page }) => {
  await markOnboardingSeen(page)
})

test('Camera A: a busy camera says so and what to do; 检查设备 and the folded diagnostics tell the rest', async ({ page }) => {
  await scriptedCamera(page, ['NotReadableError', 'NotReadableError'])
  await page.goto('/train')
  await page.getByRole('button', { name: '启用摄像头' }).click()
  const failure = page.getByTestId('camera-failure')
  await expect(failure).toHaveAttribute('data-camera-failure', 'in_use')
  await expect(failure).toContainText('摄像头当前无法读取，可能正在被其他应用占用。')
  await expect(failure).toContainText('关闭视频会议、录屏或浏览器里正在使用摄像头的页面')
  await expect(page.getByTestId('camera-panel')).toContainText('摄像头无法读取')
  await expect(page.getByText('连接异常')).toHaveCount(0)
  await expect(page.getByText('internal browser detail')).toHaveCount(0)
  // The plain request was tried too before giving up.
  const { calls } = await cameraWindow(page)
  expect(calls).toHaveLength(2)
  expect(calls[0]).toMatchObject({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, min: 20 } } })
  expect(calls[1]).toEqual({ video: true, audio: false })

  await failure.getByRole('button', { name: '检查设备' }).click()
  const check = page.getByTestId('camera-device-check')
  await expect(check).toContainText('摄像头已检测')
  await expect(check).toContainText('视频输入1 个')
  await expect(check).toContainText('权限')
  await expect(failure).toHaveAttribute('data-failure-complete', 'true')
  await failure.getByRole('button', { name: '查看诊断信息' }).click()
  const details = page.getByTestId('camera-diagnostics-body')
  await expect(details).toContainText('设备被占用或无法读取 · NotReadableError')
  await expect(details).toContainText('首选参数（1280×720 · 30 fps，至少 20 fps） → NotReadableError')
  await expect(details).toContainText('兼容参数（video: true） → NotReadableError')
  await expect(details).toContainText('浏览器版')
  const logged = (await cameraWindow(page)).diagnostics.filter((item) => item.kind === 'camera-error').map((item) => item.entry)
  expect(logged).toHaveLength(1)
  expect(logged[0]).toMatchObject({ kind: 'in_use', errorName: 'NotReadableError', videoInputs: 1 })
  expect(JSON.stringify(logged)).not.toContain('deviceId')

  // 重新检测 runs the whole start again: now the camera answers.
  await page.evaluate(() => { (window as CameraTestWindow).__cameraScript = ['ok'] })
  await failure.getByRole('button', { name: '重新检测' }).click()
  await expect(page.getByText('AI 识别中', { exact: true })).toBeVisible({ timeout: 30_000 })
})

test('Camera B: no camera, and a refused permission, each get their own message', async ({ page }) => {
  await scriptedCamera(page, ['NotFoundError'], 0)
  await page.goto('/train')
  await page.getByRole('button', { name: '启用摄像头' }).click()
  const failure = page.getByTestId('camera-failure')
  await expect(failure).toHaveAttribute('data-camera-failure', 'not_found')
  await expect(failure).toContainText('未检测到可用摄像头，请确认设备已连接。')
  await failure.getByRole('button', { name: '检查设备' }).click()
  await expect(page.getByTestId('camera-device-check')).toContainText('摄像头未检测')
  await expect(page.getByTestId('camera-device-check')).toContainText('视频输入0 个')

  await page.evaluate(() => { (window as CameraTestWindow).__cameraScript = ['NotAllowedError'] })
  await failure.getByRole('button', { name: '重新检测' }).click()
  await expect(failure).toHaveAttribute('data-camera-failure', 'permission_denied')
  await expect(failure).toContainText('摄像头权限未开启。请在浏览器的网站权限中允许摄像头，然后重新尝试。')
  // The Windows settings shortcut exists only in the desktop app.
  await expect(failure.getByRole('button', { name: '打开 Windows 相机设置' })).toHaveCount(0)
  // A refusal is final: no second, plainer request.
  expect((await cameraWindow(page)).calls).toHaveLength(2)
})

test('Camera C: a camera that cannot give the preferred mode starts on the plain request', async ({ page }) => {
  await scriptedCamera(page, ['OverconstrainedError', 'ok'])
  await page.goto('/train')
  await page.getByRole('button', { name: '启用摄像头' }).click()
  await expect(page.getByText('AI 识别中', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('camera-failure')).toHaveCount(0)
  const fallback = (await cameraWindow(page)).diagnostics.find((item) => item.kind === 'camera-fallback')?.entry
  expect(fallback?.attempts).toEqual([
    { request: 'preferred', ok: false, errorName: 'OverconstrainedError', errorMessage: 'internal browser detail' },
    { request: 'basic', ok: true },
  ])
})

test('Camera D: a pose model that cannot load is reported as the model, with its HTTP status, not as the camera', async ({ page }) => {
  test.setTimeout(60_000)
  await scriptedCamera(page, ['ok'])
  await page.route('**/models/pose_landmarker_lite.task', (route) => route.fulfill({ status: 404, body: 'Not Found' }))
  await page.goto('/train')
  await page.getByRole('button', { name: '启用摄像头' }).click()
  const failure = page.getByTestId('camera-failure')
  await expect(failure).toHaveAttribute('data-camera-failure', 'model_error', { timeout: 30_000 })
  await expect(failure).toContainText('姿态识别模型加载失败，请重试。')
  await expect(page.getByTestId('camera-panel')).toContainText('识别模型加载失败')
  await expect(failure.getByRole('button', { name: '检查设备' })).toHaveCount(0)
  await expect(failure).toHaveAttribute('data-failure-complete', 'true')
  await failure.getByRole('button', { name: '查看诊断信息' }).click()
  const details = page.getByTestId('camera-diagnostics-body')
  await expect(details).toContainText('/models/pose_landmarker_lite.task → 404')
  await expect(details).toContainText('WebGL2')
  await expect(details).toContainText('/wasm/vision_wasm_internal.wasm → 200')
})

test('Camera E: the follow-along page keeps the failure readable inside its compact camera panel', async ({ page }) => {
  await scriptedCamera(page, [])
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/routines/baduanjin/train')
    await page.evaluate(() => { (window as CameraTestWindow).__cameraScript = ['NotReadableError', 'NotReadableError'] })
    await page.getByRole('button', { name: '启用摄像头' }).click()
    const failure = page.getByTestId('camera-failure')
    await expect(failure).toHaveAttribute('data-camera-failure', 'in_use')
    const retry = failure.getByRole('button', { name: '重新检测' })
    await retry.scrollIntoViewIfNeeded()
    await expect(retry).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${viewport.width}`).toBe(true)
  }
})
