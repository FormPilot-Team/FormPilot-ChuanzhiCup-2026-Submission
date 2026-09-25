import { expect, test, type Page } from '@playwright/test'

async function setGesture(page: Page, gesture: 'start' | 'pause' | 'none') {
  await page.evaluate((next) => {
    (window as typeof window & { __gestureTestPose?: 'start' | 'pause' | 'none' }).__gestureTestPose = next
  }, gesture)
}

async function installSpeechStub(page: Page) {
  await page.addInitScript(() => {
    class FakeUtterance {
      lang = ''
      rate = 1
      onstart?: () => void
      onend?: () => void
      constructor(readonly text: string) {}
    }
    const speechEvents: string[] = []
    const synthesis = {
      speak(utterance: FakeUtterance) {
        speechEvents.push(utterance.text)
        utterance.onstart?.()
        window.setTimeout(() => utterance.onend?.(), 20)
      },
      cancel() {},
      getVoices() { return [{ name: 'Local Chinese', lang: 'zh-CN', localService: true, default: true, voiceURI: 'local-zh' }] },
      addEventListener() {},
      removeEventListener() {},
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance })
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis })
    Object.assign(window, { __speechEvents: speechEvents, __gestureTestPose: 'none' })
  })
}

test('hands-free start, pause, and resume use sustained holds, cooldown, and existing course behavior', async ({ page }) => {
  test.setTimeout(30_000)
  await installSpeechStub(page)
  await page.goto('/?demo=1&course=1&fixture=synthetic&gesture=manual&voice=1')

  const state = page.getByTestId('course-state')
  const overlay = page.getByTestId('pose-overlay')
  await expect(page.getByTestId('gesture-control')).toContainText('双手在胸前合拢并保持，开始训练')
  await expect(state).toContainText('请进入准备姿势')
  await page.waitForTimeout(1300)
  await expect(state).toContainText('请进入准备姿势')

  await setGesture(page, 'start')
  await expect(page.getByTestId('gesture-hold-progress')).toContainText('保持中')
  await expect(state).toContainText('准备开始', { timeout: 4_000 })
  await expect(state).toContainText('坚持', { timeout: 5_000 })
  await expect(overlay).toBeHidden()

  await setGesture(page, 'start')
  await page.waitForTimeout(1350)
  await expect(state).toContainText('坚持')

  await setGesture(page, 'pause')
  await page.waitForTimeout(200)
  await setGesture(page, 'none')
  await page.waitForTimeout(200)
  await expect(state).toContainText('坚持')

  await setGesture(page, 'pause')
  await expect(state).toContainText('训练已暂停', { timeout: 3_000 })
  await expect(page.getByTestId('gesture-control')).toContainText('双手在胸前合拢并保持，继续训练')
  await expect(overlay).toBeHidden()
  await expect.poll(async () => page.evaluate(() => (window as typeof window & { __speechEvents: string[] }).__speechEvents)).toContain('训练已暂停。')

  await setGesture(page, 'start')
  await page.waitForTimeout(1500)
  await expect(state).toContainText('训练已暂停')
  await expect(state).toContainText('坚持', { timeout: 3_000 })
  await expect.poll(async () => page.evaluate(() => (window as typeof window & { __speechEvents: string[] }).__speechEvents)).toContain('继续训练。')
  await expect(page.getByRole('button', { name: '暂停训练' })).toBeVisible()
  expect(await page.evaluate(() => (window as typeof window & { __poseDetector: { initializationCount: number } }).__poseDetector.initializationCount)).toBe(1)
})
