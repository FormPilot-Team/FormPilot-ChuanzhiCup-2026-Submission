// Lightweight performance instrumentation (render FPS, frame-time percentiles, long tasks, JS heap).
// Exposed to the debug panel and to the automated perf scripts through window.__mgl. Round 1: an average
// FPS hides periodic stalls, so the panel also shows p95 / max frame time over the last 5 s.
// JS-side numbers are not OS CPU %.
const WINDOW_MS = 5000

export class PerfMonitor {
  private frames: number[] = []
  frameCount = 0
  longTaskMs = 0
  longTasks = 0
  private observer?: PerformanceObserver

  constructor() {
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTasks += 1
          this.longTaskMs += entry.duration
        }
      })
      this.observer.observe({ type: 'longtask', buffered: false })
    } catch {
      this.observer = undefined
    }
  }

  frame(now: number): void {
    this.frameCount += 1
    this.frames.push(now)
    while (this.frames.length && now - this.frames[0] > WINDOW_MS) this.frames.shift()
  }

  renderFps(): number {
    const f = this.frames
    return f.length > 1 ? ((f.length - 1) * 1000) / (f[f.length - 1] - f[0]) : 0
  }

  private deltas(): number[] {
    const d: number[] = []
    for (let i = 1; i < this.frames.length; i += 1) d.push(this.frames[i] - this.frames[i - 1])
    return d
  }

  frameTimeP95(): number {
    const d = this.deltas().sort((a, b) => a - b)
    return d.length ? d[Math.floor((d.length - 1) * 0.95)] : 0
  }

  frameTimeMax(): number {
    return Math.max(0, ...this.deltas())
  }

  /** frames slower than `ms` within the window */
  slowFrames(ms: number): number {
    return this.deltas().filter((d) => d > ms).length
  }

  heapMB(): number | null {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    return memory ? memory.usedJSHeapSize / 1048576 : null
  }
}

export const perf = new PerfMonitor()

export function percentile(values: readonly number[], q: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * q)]
}
