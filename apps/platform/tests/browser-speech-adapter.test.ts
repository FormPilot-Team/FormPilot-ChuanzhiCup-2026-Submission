import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserSpeechAdapter, type VoicePlaybackState } from '../src/adapters/speech/BrowserSpeechAdapter'

class FakeUtterance {
  lang = ''
  rate = 1
  voice?: SpeechSynthesisVoice
  onstart?: () => void
  onend?: () => void
  onerror?: () => void

  constructor(readonly text: string) {}
}

describe('BrowserSpeechAdapter playback lifecycle', () => {
  const utterances: FakeUtterance[] = []
  let cancelCount = 0

  beforeEach(() => {
    vi.useFakeTimers()
    utterances.length = 0
    cancelCount = 0
    const voice = { name: '中文', lang: 'zh-CN', localService: true, default: true, voiceURI: 'zh' } as SpeechSynthesisVoice
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      speechSynthesis: {
        speak: (utterance: FakeUtterance) => utterances.push(utterance),
        cancel: () => { cancelCount += 1 },
        getVoices: () => [voice],
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const observe = (adapter: BrowserSpeechAdapter) => {
    const states: VoicePlaybackState[] = []
    adapter.onPlaybackStateChange((state) => states.push(state))
    return states
  }

  it('sets speaking only on the real utterance start and clears it on end', () => {
    const adapter = new BrowserSpeechAdapter()
    const states = observe(adapter)
    adapter.speak('开始。', 2, false, 'start')
    vi.runAllTimers()
    expect(states.at(-1)).toEqual({ isSpeaking: false })
    utterances[0].onstart?.()
    expect(states.at(-1)).toMatchObject({ isSpeaking: true, currentMessage: '开始。', currentEvent: 'start', priority: 2 })
    utterances[0].onend?.()
    expect(states.at(-1)).toEqual({ isSpeaking: false })
  })

  it('clears speaking on cancel, mute, and utterance error', () => {
    const adapter = new BrowserSpeechAdapter()
    const states = observe(adapter)
    adapter.speak('保持稳定。', 5, false, 'encouragement')
    vi.runAllTimers()
    utterances[0].onstart?.()
    adapter.cancel()
    expect(states.at(-1)).toEqual({ isSpeaking: false })
    expect(cancelCount).toBe(1)

    adapter.speak('继续训练。', 2, false, 'resume')
    vi.runAllTimers()
    utterances[1].onstart?.()
    adapter.setMuted(true)
    expect(states.at(-1)).toEqual({ isSpeaking: false })

    adapter.setMuted(false)
    adapter.speak('请回到画面中。', 1, false, 'pose_lost')
    vi.runAllTimers()
    utterances[2].onstart?.()
    utterances[2].onerror?.()
    expect(states.at(-1)).toEqual({ isSpeaking: false })
    expect(adapter.isAvailable()).toBe(false)
  })

  it('replaces an interrupted message only when the new utterance really starts', () => {
    const adapter = new BrowserSpeechAdapter()
    const states = observe(adapter)
    adapter.speak('很好，保持稳定。', 5, false, 'encouragement')
    vi.runAllTimers()
    utterances[0].onstart?.()
    adapter.speak('右臂再抬高一些。', 3, true, 'confirmed_correction')
    expect(states.at(-1)).toEqual({ isSpeaking: false })
    vi.runAllTimers()
    utterances[1].onstart?.()
    utterances[0].onerror?.()
    expect(states.at(-1)).toMatchObject({
      isSpeaking: true,
      currentMessage: '右臂再抬高一些。',
      currentEvent: 'confirmed_correction',
    })
    expect(adapter.isAvailable()).toBe(true)
  })
})
