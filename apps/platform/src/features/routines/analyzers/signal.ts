import type { AnalyzerSample, MetricResult } from './types'

// 分析器共用的数值工具，都会忽略非有限值

export function finite(values: ReadonlyArray<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

export function mean(values: ReadonlyArray<number>): number | null {
  if (!values.length) return null
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

/** 线性插值分位数，q ∈ 0..1；空数组为 null */
export function percentile(values: ReadonlyArray<number>, q: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = (sorted.length - 1) * Math.min(1, Math.max(0, q))
  const low = Math.floor(index)
  const high = Math.ceil(index)
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low)
}

/** zeroAt 为 0 分、fullAt 为 100 分，之间线性；两个方向都可以 */
export function rampScore(value: number, zeroAt: number, fullAt: number): number {
  if (!Number.isFinite(value)) return 0
  if (zeroAt === fullAt) return value >= fullAt ? 100 : 0
  const share = (value - zeroAt) / (fullAt - zeroAt)
  return Math.round(100 * Math.min(1, Math.max(0, share)))
}

/** 切成连续段：墙钟间隔超过 maxGapMs（暂停、丢失姿态）或视频倒退 / 跳转时断开，速度不跨段计算 */
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

/** 居中滑动平均（两端窗口缩短） */
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

/** 相对自身滑动平均的残差，即高频部分（颤动、跟踪抖动） */
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

/** 最长的连续 true 段，用首尾样本时间差表示（ms） */
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

/** 低带与高带之间的穿越次数（滞回），如左右重心转换 */
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
  /** 剔除不计分项之前的配置权重 */
  nominalWeight: number
}

/** 章节分 = 计分项加权平均；无法测量或只记录的项按比例把权重让给其他项 */
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
