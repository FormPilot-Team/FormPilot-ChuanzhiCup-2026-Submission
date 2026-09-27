import { readFileSync } from 'node:fs'
import { expect, test, type Page, type Route } from '@playwright/test'
import { getRoutineProgram } from '../../src/features/routines/programs'
import { markOnboardingSeen } from './support/onboarding'

// Cross-machine compatibility (v3.1): what a reviewer sees when the standard video or the camera fails on their PC,
// and the diagnostics behind it.

const VIDEO = '**/assets/routines/baduanjin-standard.mp4'
const stage = (page: Page) => page.getByTestId('routine-stage')

/** Serves `body` with real byte-range semantics, like the reviewer's static server. */
function serveBytes(body: Buffer, type = 'video/mp4') {
  return async (route: Route) => {
    const range = route.request().headers().range
    const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (!match) {
      await route.fulfill({ status: 200, body, headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(body.length) } })
      return
    }
    const start = match[1] === '' ? Math.max(0, body.length - Number(match[2])) : Number(match[1])
    const end = match[1] !== '' && match[2] !== '' ? Math.min(Number(match[2]), body.length - 1) : body.length - 1
    await route.fulfill({
      status: 206,
      body: body.subarray(start, end + 1),
      headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': String(end - start + 1) },
    })
  }
}

test.beforeEach(async ({ page }) => {
  await markOnboardingSeen(page)
})

test('Compat A: a missing standard video says so, keeps engineering detail folded away, and recovers on 重新加载', async ({ page }) => {
  await page.route(VIDEO, (route) => route.fulfill({ status: 404, body: 'Not Found', headers: { 'Content-Type': 'text/plain' } }))
  await page.goto('/routines/baduanjin/train')
  const error = page.getByTestId('routine-stage-error')
  await expect(error).toBeVisible({ timeout: 20_000 })
  await expect(error).toContainText('标准示范视频暂时无法播放')
  await expect(error).toHaveAttribute('data-video-failure', 'resource', { timeout: 10_000 })
  await expect(error).toContainText('视频文件没有完整读取到')
  // The friendly screen holds no raw error names until the reviewer asks for them.
  await expect(page.getByText(/MEDIA_ERR/)).toHaveCount(0)
  await error.getByRole('button', { name: '查看诊断信息' }).click()
  const details = page.getByTestId('routine-stage-diagnostics-body')
  await expect(details).toContainText('MEDIA_ERR_SRC_NOT_SUPPORTED（代码 4）')
  await expect(details).toContainText('HEAD → 404')
  await expect(details).toContainText(getRoutineProgram('baduanjin').video.codecs)
  await expect(details).toContainText('/assets/routines/baduanjin-standard.mp4')
  await expect(details).toContainText('浏览器版')
  await expect(details.getByRole('button', { name: '复制诊断信息' })).toBeVisible()
  expect(await page.evaluate(() => (window as typeof window & { __formpilotDiagnostics?: Array<{ kind: string; entry: Record<string, unknown> }> }).__formpilotDiagnostics
    ?.filter((item) => item.kind === 'video-error').map((item) => [item.entry.errorCode, item.entry.httpStatus, item.entry.category]))).toEqual([[4, 404, 'resource']])

  await page.unroute(VIDEO)
  await error.getByRole('button', { name: '重新加载' }).click()
  await expect(stage(page)).toHaveAttribute('data-stage-status', 'ready', { timeout: 20_000 })
  await expect(page.getByTestId('routine-stage-error')).toHaveCount(0)
})

test('Compat B: a file the player rejects while the server answers correctly is a format problem, not a resource one', async ({ page }) => {
  const garbage = Buffer.concat([readFileSync('public/assets/routines/baduanjin-standard.mp4').subarray(0, 32), Buffer.alloc(200_000, 0x5a)])
  await page.route(VIDEO, serveBytes(garbage))
  await page.goto('/routines/baduanjin/train')
  const error = page.getByTestId('routine-stage-error')
  await expect(error).toHaveAttribute('data-video-failure', 'format', { timeout: 20_000 })
  await expect(error).toContainText('当前播放环境不支持这段视频的格式')
  await error.getByRole('button', { name: '查看诊断信息' }).click()
  const details = page.getByTestId('routine-stage-diagnostics-body')
  await expect(details).toContainText('MEDIA_ERR_SRC_NOT_SUPPORTED')
  await expect(details).toContainText('资源检查')
  await expect(details).toContainText('正常（200 / 206）')
  await expect(details).toContainText('GET Range: bytes=0- → 206 · bytes 0-200031/200032')
})

test('Compat C: a video that never finishes loading is reported after a while instead of spinning forever', async ({ page }) => {
  test.setTimeout(60_000)
  await page.route(VIDEO, () => undefined) // never answered
  await page.goto('/routines/baduanjin/train')
  const loading = page.getByTestId('routine-stage-loading')
  await expect(loading).toBeVisible()
  await expect(loading).toHaveAttribute('data-stage-slow', 'true', { timeout: 30_000 })
  await expect(loading).toContainText('标准示范视频加载时间较长')
  await loading.getByRole('button', { name: '查看诊断信息' }).click()
  // The server itself does not answer: a resource problem, with the failed requests listed.
  const details = page.getByTestId('routine-stage-diagnostics-body')
  await expect(details).toContainText('网络 / 资源读取问题', { timeout: 20_000 })
  await expect(details).toContainText('HEAD → 失败')
  await expect(details).toContainText('readyState 0 HAVE_NOTHING')
})
