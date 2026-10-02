// Lightweight performance instrumentation (render FPS, long tasks, JS heap). Exposed to the debug
// panel and to the automated perf script through window.__mgl. JS-side numbers are not OS CPU %.
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
    while (this.frames.length && now - this.frames[0] > 2000) this.frames.shift()
  }

  renderFps(): number {
    const f = this.frames
    return f.length > 1 ? ((f.length - 1) * 1000) / (f[f.length - 1] - f[0]) : 0
  }

  frameTimeP95(): number {
    const d: number[] = []
    for (let i = 1; i < this.frames.length; i += 1) d.push(this.frames[i] - this.frames[i - 1])
    d.sort((a, b) => a - b)
    return d.length ? d[Math.floor((d.length - 1) * 0.95)] : 0
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
