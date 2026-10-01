import type { AnalyzerSample, MetricResult } from './types'

/** Small, allocation-light numeric helpers shared by the analyzers. All of them ignore non-finite values. */

export function finite(values: ReadonlyArray<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

export function mean(values: ReadonlyArray<number>): number | null {
  if (!values.length) return null
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

/** Linear-interpolated percentile (q in 0..1); null for an empty list. */
export function percentile(values: ReadonlyArray<number>, q: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = (sorted.length - 1) * Math.min(1, Math.max(0, q))
  const low = Math.floor(index)
  const high = Math.ceil(index)
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low)
}

/** 0–100: 0 at `zeroAt`, 100 at `fullAt`, linear between; works for either direction. */
export function rampScore(value: number, zeroAt: number, fullAt: number): number {
  if (!Number.isFinite(value)) return 0
  if (zeroAt === fullAt) return value >= fullAt ? 100 : 0
  const share = (value - zeroAt) / (fullAt - zeroAt)
  return Math.round(100 * Math.min(1, Math.max(0, share)))
}

/**
 * Splits a sample sequence into continuous stretches: a new stretch starts when the wall clock jumps by more than
 * `maxGapMs` (pause, lost pose) or the video goes backwards / jumps (a seek). Speeds are never taken across a break.
 */
export function continuousRuns<F>(samples: ReadonlyArray<AnalyzerSample<F>>, maxGapMs: number, maxVideoJumpSeconds = 3): Array<Array<AnalyzerSample<F>>> {
  const runs: Array<Array<AnalyzerSample<F>>> = []
  let current: Array<AnalyzerSample<F>> = []
  let previous: AnalyzerSample<F> | undefined
  for (const sample of samples) {
    const usable = sample.features !== null && sample.features !== undefined
    const broken = !usable
      || (previous !== undefined && (sample.at - previous.at > maxGapMs || sample.at <= previous.at
        || sample.videoSeconds < previous.videoSeconds || sample.videoSeconds - previous.videoSeconds > maxVideoJumpSeconds))
    if (broken && current.length) {
      runs.push(current)
      current = []
    }
    if (usable) current.push(sample)
    previous = usable ? sample : undefined
  }
  if (current.length) runs.push(current)
  return runs
}

/** Centred moving average over ±halfWidth items (shrinking at the ends). */
export function movingAverage(values: ReadonlyArray<number>, halfWidth: number): number[] {
  const result: number[] = []
  for (let index = 0; index < values.length; index += 1) {
    let sum = 0
    let count = 0
    for (let offset = -halfWidth; offset <= halfWidth; offset += 1) {
      const value = values[index + offset]
      if (value === undefined) continue
      sum += value
      count += 1
    }
    result.push(sum / count)
  }
  return result
}

/** Residuals of a series around its own moving average: the high-frequency part (tremor, tracking jitter). */
export function residuals(values: ReadonlyArray<number>, halfWidth: number): number[] {
  const smooth = movingAverage(values, halfWidth)
  return values.map((value, index) => value - smooth[index])
}

export function rms(values: ReadonlyArray<number>): number | null {
  if (!values.length) return null
  let sum = 0
  for (const value of values) sum += value * value
  return Math.sqrt(sum / values.length)
}

/** Longest stretch of consecutive `true` flags, as a duration between the first and last sample's times (ms). */
export function longestTrueRun(flags: ReadonlyArray<boolean>, times: ReadonlyArray<number>): { durationMs: number; from: number; to: number } {
  let best = { durationMs: 0, from: -1, to: -1 }
  let start = -1
  for (let index = 0; index <= flags.length; index += 1) {
    if (index < flags.length && flags[index]) {
      if (start < 0) start = index
      continue
    }
    if (start >= 0) {
      const end = index - 1
      const durationMs = times[end] - times[start]
      if (durationMs > best.durationMs || best.from < 0) best = { durationMs, from: start, to: end }
      start = -1
    }
  }
  return best
}

/** Crossings between the low and high band of a signal (hysteresis), e.g. left ↔ right weight transfers. */
export function hysteresisCrossings(values: ReadonlyArray<number>, low: number, high: number): number {
  let side: 'low' | 'high' | undefined
  let crossings = 0
  for (const value of values) {
    const next = value <= low ? 'low' : value >= high ? 'high' : side
    if (side && next && next !== side) crossings += 1
    if (next) side = next
  }
  return crossings
}

export interface MetricDraft extends Omit<MetricResult, 'weight'> {
  /** Configured weight before metrics that are not scored are taken out. */
  nominalWeight: number
}

/**
 * Chapter score = weighted mean of the evaluated, measured metrics. Metrics without a score or recorded only give
 * their weight to the others in proportion (so a 0.2 metric that cannot be judged does not cost 20 points).
 */
export function combineMetrics(drafts: ReadonlyArray<MetricDraft>): { score: number | null; metrics: MetricResult[] } {
  const scored = drafts.filter((draft) => draft.evaluated && draft.score !== null && draft.nominalWeight > 0)
  const total = scored.reduce((sum, draft) => sum + draft.nominalWeight, 0)
  const metrics = drafts.map(({ nominalWeight, ...draft }) => ({
    ...draft,
    weight: total > 0 && draft.evaluated && draft.score !== null ? Math.round((nominalWeight / total) * 1000) / 1000 : 0,
  }))
  if (!(total > 0)) return { score: null, metrics }
  const score = scored.reduce((sum, draft) => sum + (draft.score as number) * draft.nominalWeight, 0) / total
  return { score: Math.round(score), metrics }
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
