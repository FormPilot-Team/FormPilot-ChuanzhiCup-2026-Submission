import type { VoicePriority } from '../../features/voice/VoiceGuidePolicy'

export interface SpeechAdapter {
  speak(message: string, priority: VoicePriority, interrupt: boolean): void
  cancel(): void
  setMuted(muted: boolean): void
  isAvailable(): boolean
  currentPriority(): VoicePriority | undefined
  onAvailabilityChange(listener: (available: boolean) => void): () => void
  dispose(): void
}

export function selectChineseVoice(voices: ReadonlyArray<SpeechSynthesisVoice>): SpeechSynthesisVoice | undefined {
  const chinese = voices.filter((voice) => voice.lang.toLowerCase().startsWith('zh'))
  return [...chinese].sort((left, right) => {
    const score = (voice: SpeechSynthesisVoice) => {
      const lang = voice.lang.toLowerCase()
      return (voice.localService ? 4 : 0) + (lang === 'zh-cn' ? 3 : 0) + (lang.includes('hans') ? 2 : 0) + (voice.default ? 1 : 0)
    }
    return score(right) - score(left)
  })[0]
}

export class BrowserSpeechAdapter implements SpeechAdapter {
  private pending?: number
  private activePriority?: VoicePriority
  private activeUtterance?: SpeechSynthesisUtterance
  private muted = false
  private runtimeUnavailable = false
  private voicesLoaded = false
  private voice?: SpeechSynthesisVoice
  private availabilityListeners = new Set<(available: boolean) => void>()
  private readonly onVoicesChanged = () => this.refreshVoices()

  constructor() {
    if (this.hasSynthesis()) this.refreshVoices()
  }

  speak(message: string, priority: VoicePriority, interrupt: boolean): void {
    if (this.muted || !this.isAvailable()) return
    if (interrupt) this.cancel()
    if (this.pending !== undefined) window.clearTimeout(this.pending)
    this.activePriority = priority
    this.pending = window.setTimeout(() => {
      this.pending = undefined
      try {
        if (this.muted || !this.isAvailable()) { this.activePriority = undefined; return }
        const utterance = new SpeechSynthesisUtterance(message)
        utterance.lang = 'zh-CN'
        utterance.rate = 1.05
        if (this.voice) utterance.voice = this.voice
        utterance.onend = () => this.finishUtterance(utterance)
        utterance.onerror = () => {
          this.runtimeUnavailable = true
          this.finishUtterance(utterance)
          this.notifyAvailability()
        }
        this.activeUtterance = utterance
        window.speechSynthesis.speak(utterance)
      } catch {
        this.runtimeUnavailable = true
        this.activePriority = undefined
        this.activeUtterance = undefined
        this.notifyAvailability()
      }
    }, 0)
  }

  cancel(): void {
    if (this.pending !== undefined) {
      window.clearTimeout(this.pending)
      this.pending = undefined
    }
    this.activePriority = undefined
    this.activeUtterance = undefined
    if (this.hasSynthesis()) {
      try { window.speechSynthesis.cancel() } catch { this.runtimeUnavailable = true }
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted) this.cancel()
  }

  isAvailable(): boolean {
    if (this.runtimeUnavailable || !this.hasSynthesis() || typeof SpeechSynthesisUtterance === 'undefined') return false
    return !this.voicesLoaded || Boolean(this.voice)
  }

  currentPriority(): VoicePriority | undefined {
    return this.activePriority
  }

  onAvailabilityChange(listener: (available: boolean) => void): () => void {
    if (this.availabilityListeners.size === 0 && this.hasSynthesis()) {
      window.speechSynthesis.addEventListener?.('voiceschanged', this.onVoicesChanged)
    }
    this.availabilityListeners.add(listener)
    listener(this.isAvailable())
    return () => {
      this.availabilityListeners.delete(listener)
      if (this.availabilityListeners.size === 0 && this.hasSynthesis()) {
        window.speechSynthesis.removeEventListener?.('voiceschanged', this.onVoicesChanged)
      }
    }
  }

  dispose(): void {
    this.cancel()
    if (this.hasSynthesis()) window.speechSynthesis.removeEventListener?.('voiceschanged', this.onVoicesChanged)
    this.availabilityListeners.clear()
  }

  private hasSynthesis(): boolean {
    return typeof window !== 'undefined' && typeof window.speechSynthesis?.speak === 'function'
  }

  private refreshVoices(): void {
    try {
      const voices = window.speechSynthesis.getVoices()
      this.voicesLoaded = voices.length > 0
      this.voice = selectChineseVoice(voices)
    } catch {
      this.runtimeUnavailable = true
    }
    this.notifyAvailability()
  }

  private finishUtterance(utterance: SpeechSynthesisUtterance): void {
    if (this.activeUtterance !== utterance) return
    this.activeUtterance = undefined
    this.activePriority = undefined
  }

  private notifyAvailability(): void {
    const available = this.isAvailable()
    for (const listener of this.availabilityListeners) listener(available)
  }
}
