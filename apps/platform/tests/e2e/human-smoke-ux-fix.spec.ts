import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function installSpeechStub(page: Page) {
  await page.addInitScript(() => {
    const speechEvents: Array<{ kind: 'speak' | 'cancel'; text?: string; at: number }> = []
    class FakeUtterance {
      text: string
      lang = ''
      rate = 1
      voice?: SpeechSynthesisVoice
      onstart?: () => void
      onend?: () => void
      onerror?: () => void
      constructor(text: string) { this.text = text }
    }
    const chineseVoice = { name: 'Local Chinese', lang: 'zh-CN', localService: true, default: true, voiceURI: 'local-zh' } as SpeechSynthesisVoice
    const synthesis = {
      speak(utterance: FakeUtterance) {
        speechEvents.push({ kind: 'speak', text: utterance.text, at: performance.now() })
        utterance.onstart?.()
        window.setTimeout(() => utterance.onend?.(), 20)
      },
      cancel() { speechEvents.push({ kind: 'cancel', at: performance.now() }) },
      getVoices() { return [chineseVoice] },
      addEventListener() {},
      removeEventListener() {},
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance })
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis })
    Object.assign(window, { __speechEvents: speechEvents })
  })
}

async function spoken(page: Page) {
  return page.evaluate(() => (window as typeof window & { __speechEvents: Array<{ kind: string; text?: string }> }).__speechEvents.filter((item) => item.kind === 'speak').map((item) => item.text))
}

test('upper-body crop starts the first three exercises but full-body Step Jack waits with a retreat prompt', async ({ page }) => {
  test.setTimeout(45_000)
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic&coachFixture=upper-body-crop')

  await expect(page.getByRole('heading', { name: '今日训练 · 双臂上举专项' })).toBeVisible({ timeout: 12_000 })
  await expect(page.getByRole('heading', { name: '今日训练 · 侧平举专项' })).toBeVisible({ timeout: 12_000 })
  await expect(page.getByRole('heading', { name: '今日训练 · 侧步开合专项' })).toBeVisible({ timeout: 12_000 })
  await expect(page.getByTestId('preparation-state')).toContainText(/请后退一点，让膝盖和脚部进入画面|请后退一些，确保全身完整入镜/)
  await page.waitForTimeout(800)
  await expect(page.getByTestId('course-state')).toContainText('请进入准备姿势')
})

test('live camera preview uses contain and the smart-training entry explains action-specific positioning', async ({ page }) => {
  await page.goto('/train')
  const cameraVideo = page.getByRole('region', { name: '实时动作检测' }).locator('video')
  await expect(cameraVideo).toHaveClass(/object-contain/)
  await expect(cameraVideo).not.toHaveClass(/object-cover/)

  await page.goto('/smart-training')
  await expect(page.getByText('训练过程中请根据动作提示调整站位，确保所需身体区域完整入镜')).toBeVisible()
  await expect(page.getByText('进入下肢动作时，请确保全身完整可见')).toBeVisible()
})

test('mocked speech follows course events, emits Pose Lost once, and mute cancels further speech', async ({ page }) => {
  test.setTimeout(45_000)
  await installSpeechStub(page)
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic&voice=1')
  await expect.poll(() => spoken(page)).toContain('接下来进行肩部环绕，请确保上半身和髋部完整入镜。')
  await expect.poll(() => spoken(page)).toContain('开始。')

  await page.evaluate(() => {
    const target = window as typeof window & { __forceNoPose?: boolean; __speechEvents: unknown[] }
    target.__speechEvents.length = 0
    target.__forceNoPose = true
  })
  await expect.poll(() => spoken(page), { timeout: 2_000 }).toContain('请回到画面中。')
  await page.waitForTimeout(900)
  expect((await spoken(page)).filter((text) => text === '请回到画面中。')).toHaveLength(1)

  await page.getByRole('button', { name: '静音' }).click()
  expect(await page.evaluate(() => (window as typeof window & { __speechEvents: Array<{ kind: string }> }).__speechEvents.some((item) => item.kind === 'cancel'))).toBe(true)
  await page.evaluate(() => {
    const target = window as typeof window & { __forceNoPose?: boolean; __speechEvents: unknown[] }
    target.__speechEvents.length = 0
    target.__forceNoPose = false
  })
  await page.waitForTimeout(1200)
  expect(await spoken(page)).toEqual([])
  await expect(page.getByRole('button', { name: '开启语音' })).toBeVisible()
  await page.getByRole('button', { name: '开启语音' }).click()
  await expect.poll(() => spoken(page), { timeout: 5_000 }).not.toEqual([])
})

test('speech API unavailable leaves the visual training path operational', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: undefined })
  })
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic&voice=1')
  await expect(page.getByRole('button', { name: '语音不可用' })).toBeDisabled()
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 8_000 })
})

test('mocked speech receives preparation, transition, start, and course-complete events from a full course', async ({ page }) => {
  test.setTimeout(45_000)
  await installSpeechStub(page)
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic&voice=1')
  await expect(page.getByRole('heading', { name: '本次训练已保存' })).toBeVisible({ timeout: 35_000 })
  const texts = await spoken(page)
  expect(texts).toContain('接下来进行肩部环绕，请确保上半身和髋部完整入镜。')
  expect(texts).toContain('开始。')
  expect(texts).toContain('侧平举完成，下一项侧步开合。')
  expect(texts).toContain('下一项侧步开合，请后退一些，确保全身完整入镜。')
  expect(texts.filter((text) => text === '本次训练完成，可以查看训练报告。')).toHaveLength(1)
})
