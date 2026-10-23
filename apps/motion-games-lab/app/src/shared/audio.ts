// All sound is synthesised with WebAudio at runtime — no audio files, nothing to license.
// Soft timbres (sine/triangle, short envelopes) and a pentatonic scale so feedback stays pleasant.

const PENTATONIC = [0, 2, 4, 7, 9]

function noteFreq(semitonesFromA4: number): number {
  return 440 * 2 ** (semitonesFromA4 / 12)
}

/** Semitone offset from A4 for the n-th note of a C-major pentatonic ladder starting at C5. */
function ladder(step: number): number {
  const octave = Math.floor(step / PENTATONIC.length)
  return 3 + PENTATONIC[((step % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length] + octave * 12
}

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private volume = 0.7
  muted = false

  /** Must be called from a user gesture (browsers block audio before that). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.ctx = new Ctor()
        this.master = this.ctx.createGain()
        this.master.gain.value = this.muted ? 0 : this.volume
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      this.ctx = null
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02)
  }

  private tone(freq: number, start: number, duration: number, type: OscillatorType, peak: number, glideTo?: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master || this.muted) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, start)
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + duration)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    osc.connect(gain).connect(this.master)
    osc.start(start)
    osc.stop(start + duration + 0.05)
  }

  private noise(start: number, duration: number, peak: number, frequency: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master || this.muted) return
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = frequency
    filter.Q.value = 1.2
    const gain = ctx.createGain()
    gain.gain.value = peak
    src.connect(filter).connect(gain).connect(this.master)
    src.start(start)
  }

  private now(): number | null {
    return this.ctx ? this.ctx.currentTime + 0.005 : null
  }

  /** A soft "bloop" when a new target appears. */
  appear(): void {
    const t = this.now()
    if (t === null) return
    this.tone(520, t, 0.18, 'sine', 0.12, 780)
  }

  /** Picking feedback; pitch climbs with the combo (positive feedback only). */
  collect(combo: number): void {
    const t = this.now()
    if (t === null) return
    this.noise(t, 0.06, 0.25, 1800)
    const step = Math.min(combo - 1, 9)
    this.tone(noteFreq(ladder(step)), t + 0.02, 0.32, 'triangle', 0.28)
    this.tone(noteFreq(ladder(step + 2)), t + 0.1, 0.42, 'sine', 0.2)
  }

  /** Apple lands in the basket. */
  land(): void {
    const t = this.now()
    if (t === null) return
    this.tone(180, t, 0.12, 'sine', 0.22, 120)
  }

  milestone(): void {
    const t = this.now()
    if (t === null) return
    ;[0, 2, 4, 5].forEach((step, i) => this.tone(noteFreq(ladder(step + 3)), t + i * 0.09, 0.4, 'triangle', 0.2))
  }

  tick(): void {
    const t = this.now()
    if (t === null) return
    this.tone(660, t, 0.12, 'sine', 0.2)
  }

  go(): void {
    const t = this.now()
    if (t === null) return
    this.tone(noteFreq(ladder(5)), t, 0.4, 'triangle', 0.22)
    this.tone(noteFreq(ladder(7)), t, 0.45, 'sine', 0.16)
  }

  /** Gentle two-tone chime for posture hints and tracking messages — never an alarm. */
  hint(): void {
    const t = this.now()
    if (t === null) return
    this.tone(noteFreq(ladder(4)), t, 0.35, 'sine', 0.12)
    this.tone(noteFreq(ladder(2)), t + 0.18, 0.45, 'sine', 0.1)
  }

  finish(): void {
    const t = this.now()
    if (t === null) return
    ;[0, 2, 4, 7, 9].forEach((step, i) => this.tone(noteFreq(ladder(step)), t + i * 0.12, 0.5, 'triangle', 0.2))
  }

  click(): void {
    const t = this.now()
    if (t === null) return
    this.tone(880, t, 0.06, 'sine', 0.08)
  }

  /** Pause: a soft falling pair. Resume: the same pair rising. */
  pause(): void {
    const t = this.now()
    if (t === null) return
    this.tone(noteFreq(ladder(4)), t, 0.18, 'sine', 0.12)
    this.tone(noteFreq(ladder(1)), t + 0.1, 0.26, 'sine', 0.1)
  }

  resume(): void {
    const t = this.now()
    if (t === null) return
    this.tone(noteFreq(ladder(1)), t, 0.18, 'sine', 0.12)
    this.tone(noteFreq(ladder(4)), t + 0.1, 0.26, 'sine', 0.12)
  }

  /** Boating: a paddle splash plus a soft pitched knock (left / right a fifth apart). */
  stroke(sideIndex: 0 | 1, flow: boolean): void {
    const t = this.now()
    if (t === null) return
    this.noise(t, 0.22, 0.32, 900)
    this.noise(t + 0.05, 0.16, 0.16, 2400)
    this.tone(noteFreq(ladder(sideIndex ? 4 : 2) - 12), t, 0.16, 'triangle', flow ? 0.16 : 0.1)
  }

  /** Boating: entering "flow" (steady rhythm). */
  flow(): void {
    const t = this.now()
    if (t === null) return
    ;[0, 2, 4, 7].forEach((step, i) => this.tone(noteFreq(ladder(step + 5)), t + i * 0.07, 0.35, 'sine', 0.14))
  }

  /** Archery: string tension rises while drawing (call sparingly). */
  creak(amount: number): void {
    const t = this.now()
    if (t === null) return
    this.tone(160 + amount * 140, t, 0.12, 'sawtooth', 0.025)
  }

  /** Archery: the hold completed, ready to release. */
  armed(): void {
    const t = this.now()
    if (t === null) return
    this.tone(noteFreq(ladder(7)), t, 0.22, 'sine', 0.14)
  }

  /** Archery: bow string twang + arrow whoosh. */
  release(): void {
    const t = this.now()
    if (t === null) return
    this.tone(220, t, 0.25, 'triangle', 0.22, 110)
    this.noise(t + 0.02, 0.35, 0.12, 3200)
  }

  /** Archery: arrow lands; brighter for inner rings. ring = 0 (bullseye) … 4, null = missed the target. */
  hit(ring: number | null): void {
    const t = this.now()
    if (t === null) return
    if (ring === null) {
      this.noise(t, 0.2, 0.12, 600) // a soft thud in the grass, never a failure sound
      return
    }
    this.noise(t, 0.08, 0.35, 700)
    this.tone(150, t, 0.12, 'sine', 0.3, 90)
    const steps = [9, 7, 5, 4, 2][ring] ?? 2
    this.tone(noteFreq(ladder(steps)), t + 0.06, 0.4, 'triangle', 0.2)
    if (ring === 0) [0, 2, 4].forEach((s, i) => this.tone(noteFreq(ladder(steps + s + 1)), t + 0.16 + i * 0.08, 0.35, 'sine', 0.14))
  }

  /** Result page: a short warm chord. */
  result(): void {
    const t = this.now()
    if (t === null) return
    ;[0, 4, 7].forEach((step) => this.tone(noteFreq(ladder(step)), t, 0.9, 'sine', 0.1))
  }
}

export const sfx = new Sfx()
