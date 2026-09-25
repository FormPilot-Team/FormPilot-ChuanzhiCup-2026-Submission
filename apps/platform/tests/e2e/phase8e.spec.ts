import { expect, test, type Page } from '@playwright/test'

type SpeechEvent = { kind: 'speak' | 'cancel' | 'end'; text?: string; at: number }

async function installControllableSpeech(page: Page) {
  await page.addInitScript(() => {
    type TestWindow = typeof window & {
      __speechEvents: Array<{ kind: 'speak' | 'cancel' | 'end'; text?: string; at: number }>
      __finishSpeech: () => void
    }
    const speechEvents: TestWindow['__speechEvents'] = []
    class FakeUtterance {
      lang = ''
      rate = 1
      voice?: SpeechSynthesisVoice
      onstart?: () => void
      onend?: () => void
      onerror?: () => void
      constructor(readonly text: string) {}
    }
    let active: FakeUtterance | undefined
    const finish = () => {
      const utterance = active
      if (!utterance) return
      active = undefined
      speechEvents.push({ kind: 'end', text: utterance.text, at: performance.now() })
      utterance.onend?.()
    }
    const chineseVoice = { name: 'Local Chinese', lang: 'zh-CN', localService: true, default: true, voiceURI: 'local-zh' } as SpeechSynthesisVoice
    const synthesis = {
      speak(utterance: FakeUtterance) {
        active = utterance
        speechEvents.push({ kind: 'speak', text: utterance.text, at: performance.now() })
        utterance.onstart?.()
        if (!utterance.text.includes('保持') && !utterance.text.includes('回到画面') && utterance.text !== '继续训练。') window.setTimeout(finish, 250)
      },
      cancel() {
        active = undefined
        speechEvents.push({ kind: 'cancel', at: performance.now() })
      },
      getVoices() { return [chineseVoice] },
      addEventListener() {},
      removeEventListener() {},
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance })
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis })
    Object.assign(window, { __speechEvents: speechEvents, __finishSpeech: finish })
  })
}

const events = (page: Page) => page.evaluate(() => (window as typeof window & { __speechEvents: SpeechEvent[] }).__speechEvents)

test('real utterance lifecycle drives the Dock without replacing primary feedback', async ({ page }) => {
  await installControllableSpeech(page)
  await page.goto('/?demo=1&course=1&fixture=synthetic&voice=1')

  const spoken = page.getByTestId('coach-spoken-message')
  await expect(spoken).toContainText('接下来进行肩部环绕')
  await expect(page.getByTestId('coach-status-label')).toContainText('语音指导中')
  await expect(page.getByTestId('coach-primary-message')).not.toContainText('接下来进行肩部环绕')
  await page.evaluate(() => (window as typeof window & { __finishSpeech: () => void }).__finishSpeech())
  await expect(spoken).toBeHidden()
  await expect(page.getByTestId('coach-status-label')).not.toContainText('语音指导中')
})

test('pause and resume speak once, while mute cancels and clears the Dock immediately', async ({ page }) => {
  test.setTimeout(30_000)
  await installControllableSpeech(page)
  await page.goto('/?demo=1&course=1&fast=1&fixture=synthetic&voice=1')
  await expect(page.getByTestId('course-state')).toContainText('坚持', { timeout: 8_000 })

  await page.getByRole('button', { name: '暂停训练' }).click()
  await expect(page.getByTestId('coach-spoken-message')).toContainText('训练已暂停。')
  await expect.poll(async () => (await events(page)).filter((item) => item.kind === 'speak' && item.text === '训练已暂停。').length).toBe(1)
  await page.evaluate(() => (window as typeof window & { __finishSpeech: () => void }).__finishSpeech())

  await page.getByRole('button', { name: '继续训练' }).click()
  await expect(page.getByTestId('coach-spoken-message')).toContainText('继续训练。')
  await expect.poll(async () => (await events(page)).filter((item) => item.kind === 'speak' && item.text === '继续训练。').length).toBe(1)
  await page.getByRole('button', { name: '静音' }).click()
  await expect(page.getByTestId('coach-spoken-message')).toBeHidden()
  await expect(page.getByRole('button', { name: '开启语音' })).toBeVisible()
  expect((await events(page)).at(-1)?.kind).toBe('cancel')
})

test('stable-action encouragement occurs once and pose-lost interrupts it with synchronized text', async ({ page }) => {
  test.setTimeout(30_000)
  await installControllableSpeech(page)
  await page.goto('/?demo=1&course=1&fixture=synthetic&voice=1')

  await expect(page.getByTestId('coach-spoken-message')).toContainText(/很好，保持/ , { timeout: 14_000 })
  const encouragementEvents = (await events(page)).filter((item) => item.kind === 'speak' && item.text?.includes('很好，保持'))
  expect(encouragementEvents).toHaveLength(1)

  await page.evaluate(() => { (window as typeof window & { __forceNoPose?: boolean }).__forceNoPose = true })
  await expect.poll(async () => JSON.stringify(await events(page)), { timeout: 5_000 }).toContain('请回到画面中。')
  await expect(page.getByTestId('coach-spoken-message')).toContainText('请回到画面中。')
  const speechEvents = await events(page)
  const poseLostIndex = speechEvents.findIndex((item) => item.text === '请回到画面中。')
  expect(poseLostIndex).toBeGreaterThan(0)
  expect(speechEvents.slice(0, poseLostIndex).at(-1)?.kind).toBe('cancel')
})
