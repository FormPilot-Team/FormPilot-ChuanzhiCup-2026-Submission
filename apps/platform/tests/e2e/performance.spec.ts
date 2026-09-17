import { expect, test } from '@playwright/test'

test('benchmarks main-thread MediaPipe at 1280×720', async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    const fakeGetUserMedia = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 1280
      canvas.height = 720
      const context = canvas.getContext('2d')
      const image = new Image()
      image.src = '/assets/camera-step-jack-demo.png'
      await image.decode()
      let frame = 0
      window.setInterval(() => {
        if (!context) return
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        context.fillStyle = 'rgba(255,255,255,0.01)'
        context.fillRect(frame % canvas.width, 0, 1, 1)
        frame += 1
      }, 33)
      return canvas.captureStream(30)
    }
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: fakeGetUserMedia })
  })
  await page.goto('/?debug=1&exercise=step_jack')
  await page.getByRole('button', { name: '启用摄像头' }).click()
  await expect(page.getByText(/摄像头已连接/)).toBeVisible({ timeout: 30_000 })
  const panel = page.getByRole('complementary', { name: '开发调试信息' })
  await expect(panel).toContainText('1280×720', { timeout: 15_000 })
  await page.waitForTimeout(5000)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON' }).click()
  const stream = await (await downloadPromise).createReadStream()
  if (!stream) throw new Error('Diagnostics download stream unavailable')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const diagnostics = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  expect(diagnostics.performance.inputResolution).toBe('1280×720')
  expect(diagnostics.performance.sampleCount).toBeGreaterThan(30)
  expect(diagnostics.performance.averageInferenceMs).toBeGreaterThan(0)
  console.log(`BENCHMARK ${JSON.stringify(diagnostics.performance)}`)
})
