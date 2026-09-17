export interface PerformanceSnapshot {
  cameraFps: number
  inferenceFps: number
  averageInferenceMs: number
  p95InferenceMs: number
  uiFps: number
  droppedFrames: number
  skippedFrames: number
  sampleCount: number
  inputResolution: string
}

export class PerformanceTracker {
  private cameraTimes: number[] = []
  private inferenceTimes: number[] = []
  private uiTimes: number[] = []
  private inferenceDurations: number[] = []
  private droppedFrames = 0
  private skippedFrames = 0
  private inputResolution = 'unknown'

  reset(): void {
    this.cameraTimes = []
    this.inferenceTimes = []
    this.uiTimes = []
    this.inferenceDurations = []
    this.droppedFrames = 0
    this.skippedFrames = 0
    this.inputResolution = 'unknown'
  }

  markCameraFrame(timestamp: number, width?: number, height?: number): void {
    this.pushRecent(this.cameraTimes, timestamp)
    if (width && height) this.inputResolution = `${width}×${height}`
  }

  recordInference(timestamp: number, durationMs: number, producedPose: boolean): void {
    this.pushRecent(this.inferenceTimes, timestamp)
    this.inferenceDurations.push(durationMs)
    if (this.inferenceDurations.length > 900) this.inferenceDurations.shift()
    if (!producedPose) this.droppedFrames += 1
  }

  markUiFrame(timestamp: number): void {
    this.pushRecent(this.uiTimes, timestamp)
  }

  markSkippedFrame(): void {
    this.skippedFrames += 1
  }

  snapshot(now = performance.now()): PerformanceSnapshot {
    const measuredDurations = this.inferenceDurations.length > 20 ? this.inferenceDurations.slice(10) : this.inferenceDurations
    const sorted = [...measuredDurations].sort((a, b) => a - b)
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
    return {
      cameraFps: this.rate(this.cameraTimes, now),
      inferenceFps: this.rate(this.inferenceTimes, now),
      averageInferenceMs: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : 0,
      p95InferenceMs: sorted[p95Index] ?? 0,
      uiFps: this.rate(this.uiTimes, now),
      droppedFrames: this.droppedFrames,
      skippedFrames: this.skippedFrames,
      sampleCount: sorted.length,
      inputResolution: this.inputResolution,
    }
  }

  private pushRecent(target: number[], timestamp: number): void {
    target.push(timestamp)
    while (target.length && timestamp - target[0] > 1000) target.shift()
  }

  private rate(times: number[], now: number): number {
    while (times.length && now - times[0] > 1000) times.shift()
    return times.length
  }
}
