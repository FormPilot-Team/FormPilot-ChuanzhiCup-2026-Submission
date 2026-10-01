/**
 * Items kept for a fixed span of time: pushing an item drops everything older than `durationMs` before it.
 * Backed by a ring buffer so the live analysis window costs no allocation per frame.
 */
export class TimeWindow<T> {
  private readonly times: number[]
  private readonly items: T[]
  private head = 0
  private count = 0

  constructor(private readonly durationMs: number, private readonly capacity = 256) {
    if (!(durationMs > 0) || !(capacity > 0)) throw new Error('TimeWindow needs a positive duration and capacity')
    this.times = new Array<number>(capacity)
    this.items = new Array<T>(capacity)
  }

  get size(): number {
    return this.count
  }

  /** Time of the newest item, or undefined when empty. */
  get latestAt(): number | undefined {
    return this.count ? this.times[(this.head + this.count - 1) % this.capacity] : undefined
  }

  push(at: number, item: T): void {
    const latest = this.latestAt
    // Time going backwards (a new session clock, a seek) starts the window over.
    if (latest !== undefined && at < latest) this.clear()
    if (this.count === this.capacity) {
      this.head = (this.head + 1) % this.capacity
      this.count -= 1
    }
    const slot = (this.head + this.count) % this.capacity
    this.times[slot] = at
    this.items[slot] = item
    this.count += 1
    while (this.count && this.times[this.head] < at - this.durationMs) {
      this.head = (this.head + 1) % this.capacity
      this.count -= 1
    }
  }

  clear(): void {
    this.head = 0
    this.count = 0
  }

  /** Items oldest first. */
  toArray(): T[] {
    const result: T[] = []
    for (let index = 0; index < this.count; index += 1) result.push(this.items[(this.head + index) % this.capacity])
    return result
  }
}
