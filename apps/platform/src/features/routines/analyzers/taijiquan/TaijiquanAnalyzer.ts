import type { ReferenceTrack } from '../../followAlong/referenceTrack'
import type { RoutineChapter, RoutineProgram } from '../../types'
import { orderFeedback, percentText } from '../format'
import { referenceSamples } from '../reference'
import { combineMetrics, continuousRuns, finite, hysteresisCrossings, mean, movingAverage, percentile, rampScore, residuals, rms, round, type MetricDraft } from '../signal'
import type { AnalyzerContext, AnalyzerEvaluation, AnalyzerFeedbackItem, AnalyzerPose, AnalyzerReportMetrics, AnalyzerSample, MetricResult, RoutineAnalyzer } from '../types'
import { TAIJIQUAN_ANALYZER_CONFIG as CONFIG } from './config'
import { taijiquanFeatures, type TaijiquanFeatures } from './features'
import { TAIJIQUAN_STEPS, WEIGHT_SHIFT_LABEL, type TaijiquanStep, type WeightShift } from './steps'

interface SpeedPoint {
  at: number
  videoSeconds: number
  /** 双腕与髋中心的平均速度，躯干长 / s */
  speed: number
}

export interface TaijiquanChapterReference {
  speeds: SpeedPoint[]
  /** 定势窗口起点（视频秒） */
  settleStart: number
  /** 方向类：定势窗口已知帧中与标注一致的比例 */
  settleAgreement: number | null
  supportRange: number | null
  knownShare: number
  crossings: number
}

export interface TaijiquanEvaluation extends AnalyzerEvaluation {
  weightShift: WeightShift
  scoreShift: boolean
  similarity: number | null
  jitter: number | null
  /** 示范者仍在动时用户停顿的时间占比 */
  pauseShare: number | null
  extentRatio: number | null
  /** 方向类为一致比例，transfer 类为范围之比 */
  weightShiftValue: number | null
}

function robustScale(samples: ReadonlyArray<AnalyzerSample<TaijiquanFeatures>>): number | null {
  const scale = percentile(samples.flatMap((sample) => (sample.features ? [sample.features.torso] : [])), CONFIG.scalePercentile)
  return scale !== null && scale > 0 ? scale : null
}

/** 各连续段内相邻样本的速度；先平均位置，抖动不算速度 */
export function speedSeries(samples: ReadonlyArray<AnalyzerSample<TaijiquanFeatures>>, scale: number): SpeedPoint[][] {
  return continuousRuns(samples, CONFIG.maxGapMs).map((run) => {
    const coordinates = (run[0].features as TaijiquanFeatures).points.length
    const smooth: number[][] = []
    for (let index = 0; index < coordinates; index += 1) {
      smooth.push(movingAverage(run.map((sample) => (sample.features as TaijiquanFeatures).points[index] / scale), CONFIG.positionHalfWidth))
    }
    const speeds: SpeedPoint[] = []
    for (let item = 1; item < run.length; item += 1) {
      const seconds = (run[item].at - run[item - 1].at) / 1000
      const perPoint: number[] = []
      for (let index = 0; index < coordinates; index += 2) {
        const value = Math.hypot(smooth[index][item] - smooth[index][item - 1], smooth[index + 1][item] - smooth[index + 1][item - 1]) / seconds
        if (Number.isFinite(value)) perPoint.push(value)
      }
      if (perPoint.length) speeds.push({ at: run[item].at, videoSeconds: run[item].videoSeconds, speed: mean(perPoint) as number })
    }
    return speeds
  })
}

/** 某视频时刻示范者的速度（最近点）；超出参考范围为 null */
function speedAt(reference: ReadonlyArray<SpeedPoint>, videoSeconds: number): number | null {
  let low = 0
  let high = reference.length - 1
  if (high < 0) return null
  while (low < high) {
    const middle = (low + high) >> 1
    if (reference[middle].videoSeconds < videoSeconds) low = middle + 1
    else high = middle
  }
  const nearest = low > 0 && Math.abs(reference[low - 1].videoSeconds - videoSeconds) < Math.abs(reference[low].videoSeconds - videoSeconds) ? reference[low - 1] : reference[low]
  return Math.abs(nearest.videoSeconds - videoSeconds) <= 0.3 ? nearest.speed : null
}

function agrees(ratio: number, expected: WeightShift): boolean {
  if (expected === 'left') return ratio < CONFIG.weightShift.leftBelow
  if (expected === 'right') return ratio > CONFIG.weightShift.rightAbove
  if (expected === 'balanced') return ratio >= CONFIG.weightShift.balancedMin && ratio <= CONFIG.weightShift.balancedMax
  return true
}

/** 镜像跟练时，本人的左腿对应示范者的右腿 */
function mirroredShift(shift: WeightShift): WeightShift {
  return shift === 'left' ? 'right' : shift === 'right' ? 'left' : shift
}

/** 定势窗口：本式后 settleSearchShare 部分中示范者最慢的 settleSeconds */
function settleWindowStart(speeds: ReadonlyArray<SpeedPoint>, chapter: RoutineChapter): number {
  const length = chapter.endSeconds - chapter.startSeconds
  const earliest = chapter.endSeconds - CONFIG.weightShift.settleSearchShare * length
  const span = CONFIG.weightShift.settleSeconds
  let best = { start: chapter.endSeconds - span, speed: Infinity }
  for (const point of speeds) {
    if (point.videoSeconds < earliest || point.videoSeconds + span > chapter.endSeconds) continue
    const inside = speeds.filter((item) => item.videoSeconds >= point.videoSeconds && item.videoSeconds < point.videoSeconds + span).map((item) => item.speed)
    const average = mean(inside)
    if (inside.length >= span * 5 && average !== null && average < best.speed) best = { start: point.videoSeconds, speed: average }
  }
  return best.start
}

/** 用分析器自己的特征提取示范者的参考 */
export function taijiquanReference(samples: ReadonlyArray<AnalyzerSample<TaijiquanFeatures>>, chapter: RoutineChapter, step: TaijiquanStep): TaijiquanChapterReference | null {
  const scale = robustScale(samples)
  if (!scale) return null
  const speeds = speedSeries(samples, scale).flat()
  const settleStart = settleWindowStart(speeds, chapter)
  const ratios = samples.map((sample) => sample.features?.supportRatio ?? null)
  const known = finite(ratios)
  const settle = finite(samples.filter((sample) => sample.videoSeconds >= settleStart && sample.videoSeconds < settleStart + CONFIG.weightShift.settleSeconds).map((sample) => sample.features?.supportRatio))
  const p10 = percentile(known, 0.1)
  const p90 = percentile(known, 0.9)
  return {
    speeds,
    settleStart,
    settleAgreement: step.weightShift === 'transfer' || !settle.length ? null : settle.filter((ratio) => agrees(ratio, step.weightShift)).length / settle.length,
    supportRange: p10 === null || p90 === null ? null : p90 - p10,
    knownShare: samples.length ? known.length / samples.length : 0,
    crossings: hysteresisCrossings(known, CONFIG.weightShift.crossLow, CONFIG.weightShift.crossHigh),
  }
}

export function scoreShiftRule(reference: TaijiquanChapterReference, step: TaijiquanStep): boolean {
  if (step.weightShift === 'transfer') return reference.knownShare >= CONFIG.weightShift.scoreShiftMinShare && reference.crossings >= 1
  return (reference.settleAgreement ?? 0) >= CONFIG.weightShift.scoreShiftMinShare
}

// 太极拳连续性（基于姿态关键点的二维近似）：架势与示范的一致程度、动作是否圆顺不抖、
// 示范仍在动时是否停顿、舒展度，以及二维髋中心估计的支撑腿是否符合标注
export class TaijiquanAnalyzer implements RoutineAnalyzer<TaijiquanFeatures, TaijiquanEvaluation> {
  readonly id = 'taijiquan' as const
  readonly version = CONFIG.version
  readonly title = '太极拳连续性'
  readonly liveWindowMs = CONFIG.liveWindowMs
  private readonly references = new Map<string, TaijiquanChapterReference>()

  constructor(program: RoutineProgram, track?: ReferenceTrack) {
    if (!track) return
    for (const chapter of program.chapters) {
      const step = TAIJIQUAN_STEPS[chapter.id]
      if (!step) continue
      const reference = taijiquanReference(referenceSamples(track, chapter, (pose) => taijiquanFeatures(pose, {})), chapter, step)
      if (reference) this.references.set(chapter.id, reference)
    }
  }

  reference(chapterId: string): TaijiquanChapterReference | undefined {
    return this.references.get(chapterId)
  }

  covers(chapter: RoutineChapter): boolean {
    return Boolean(TAIJIQUAN_STEPS[chapter.id])
  }

  extractFeatures(pose: AnalyzerPose, context: AnalyzerContext): TaijiquanFeatures | null {
    return taijiquanFeatures(pose, context)
  }

  evaluate(samples: ReadonlyArray<AnalyzerSample<TaijiquanFeatures>>, chapter: RoutineChapter): TaijiquanEvaluation | null {
    const step = TAIJIQUAN_STEPS[chapter.id]
    const reference = this.references.get(chapter.id)
    if (!step || !reference) return null
    const usable = samples.filter((sample) => sample.features !== null)
    if (usable.length < CONFIG.minSamples) return null
    const scale = robustScale(usable)
    if (!scale) return null

    const similarity = mean(finite(usable.map((sample) => sample.features?.similarity)))
    const runs = speedSeries(usable, scale)
    const jitter = positionJitter(usable, scale)
    const pauseShare = pausedShare(runs, reference)
    const extentRatio = extent(runs, reference)
    const weightShiftValue = this.weightShiftValue(usable, step, reference)
    const { score, metrics } = combineMetrics([
      poseMetric(similarity),
      smoothnessMetric(jitter),
      pauseMetric(pauseShare),
      extentMetric(extentRatio),
      weightShiftMetric(step, weightShiftValue),
    ])
    return {
      score,
      metrics,
      usableSamples: usable.length,
      weightShift: step.weightShift,
      scoreShift: step.scoreShift,
      similarity: similarity === null ? null : round(similarity, 3),
      jitter: jitter === null ? null : round(jitter, 4),
      pauseShare: pauseShare === null ? null : round(pauseShare, 3),
      extentRatio: extentRatio === null ? null : round(extentRatio, 3),
      weightShiftValue: weightShiftValue === null ? null : round(weightShiftValue, 3),
    }
  }

  private weightShiftValue(samples: ReadonlyArray<AnalyzerSample<TaijiquanFeatures>>, step: TaijiquanStep, reference: TaijiquanChapterReference): number | null {
    if (step.weightShift === 'transfer') {
      const known = finite(samples.map((sample) => sample.features?.supportRatio))
      if (known.length < CONFIG.weightShift.minKnownSamples || !reference.supportRange) return null
      return ((percentile(known, 0.9) as number) - (percentile(known, 0.1) as number)) / reference.supportRange
    }
    const from = reference.settleStart
    const to = reference.settleStart + CONFIG.weightShift.settleSeconds + CONFIG.weightShift.lagSeconds
    const inside = samples.filter((sample) => sample.videoSeconds >= from && sample.videoSeconds <= to && sample.features)
    const known = inside.filter((sample) => sample.features?.supportRatio !== null)
    if (known.length < CONFIG.weightShift.minKnownSamples) return null
    const mirrored = inside.filter((sample) => sample.features?.mirrored).length > inside.length / 2
    const expected = mirrored ? mirroredShift(step.weightShift) : step.weightShift
    return known.filter((sample) => agrees(sample.features?.supportRatio as number, expected)).length / known.length
  }

  buildFeedback(evaluation: TaijiquanEvaluation, chapter: RoutineChapter): AnalyzerFeedbackItem[] {
    const step = TAIJIQUAN_STEPS[chapter.id]
    if (!step) return []
    return orderFeedback(evaluation.metrics.map((metric) => ({ metric, item: feedbackFor(metric, step) })))
  }

  buildReportMetrics(chapters: ReadonlyArray<{ chapter: RoutineChapter; evaluation: TaijiquanEvaluation | null }>): AnalyzerReportMetrics {
    const average = mean(finite(chapters.map(({ evaluation }) => evaluation?.score)))
    return {
      analyzerId: this.id,
      version: this.version,
      title: this.title,
      score: average === null ? null : Math.round(average),
      chapters: chapters.map(({ chapter, evaluation }) => ({
        chapterId: chapter.id,
        score: evaluation?.score ?? null,
        metrics: evaluation?.metrics ?? [],
        feedback: evaluation ? this.buildFeedback(evaluation, chapter) : [],
      })),
      notes: [
        '连续性看三件事：速度是否均匀、示范者仍在动时你是否停顿、架势与示范是否一致（跟练相似度）。',
        '重心方向是基于姿态关键点的二维髋中心近似估计：侧身或背身时左右可能颠倒，所以只在示范视频上的估计与标注一致的式中计分，其余式只记录；权重较低。',
        '全部阈值为暂定值，尚未用真人数据标定。快速模式下速度类指标没有意义。',
      ],
      extras: {
        weightShift: chapters.map(({ chapter }) => ({
          chapterId: chapter.id,
          label: TAIJIQUAN_STEPS[chapter.id]?.weightShift ?? null,
          scoreShift: TAIJIQUAN_STEPS[chapter.id]?.scoreShift ?? false,
        })),
      },
    }
  }
}

/** 位置相对短平均的 RMS，按 1 s 分块与坐标取中位数，单位躯干长 */
function positionJitter(samples: ReadonlyArray<AnalyzerSample<TaijiquanFeatures>>, scale: number): number | null {
  const blocks: number[] = []
  const block = CONFIG.smoothness.blockSamples
  for (const run of continuousRuns(samples, CONFIG.maxGapMs)) {
    if (run.length < block) continue
    const coordinates = (run[0].features as TaijiquanFeatures).points.length
    for (let index = 0; index < coordinates; index += 1) {
      const series = run.map((sample) => (sample.features as TaijiquanFeatures).points[index] / scale)
      if (!series.every(Number.isFinite)) continue
      const residual = residuals(series, CONFIG.smoothness.residualHalfWidth)
      for (let from = 0; from + block <= residual.length; from += block) blocks.push(rms(residual.slice(from, from + block)) as number)
    }
  }
  return percentile(blocks, 0.5)
}

/** 用户路程 / 示范者路程，均在用户的样本时刻计算 */
function extent(runs: ReadonlyArray<ReadonlyArray<SpeedPoint>>, reference: TaijiquanChapterReference): number | null {
  let user = 0
  let demonstrator = 0
  for (const run of runs) {
    for (let index = 1; index < run.length; index += 1) {
      const seconds = (run[index].at - run[index - 1].at) / 1000
      const expected = speedAt(reference.speeds, run[index].videoSeconds)
      if (expected === null) continue
      user += run[index].speed * seconds
      demonstrator += expected * seconds
    }
  }
  return demonstrator > 0.5 ? Math.min(CONFIG.extent.maxRatio, user / demonstrator) : null
}

/** 示范者在动时，用户停住至少 minStopSeconds 的时间占比 */
function pausedShare(runs: ReadonlyArray<ReadonlyArray<SpeedPoint>>, reference: TaijiquanChapterReference): number | null {
  let moving = 0
  let paused = 0
  for (const run of runs) {
    const stopped = run.map((point) => point.speed < CONFIG.pauses.stopSpeed)
    const inStop = new Array<boolean>(run.length).fill(false)
    let start = -1
    for (let index = 0; index <= run.length; index += 1) {
      if (index < run.length && stopped[index]) {
        if (start < 0) start = index
        continue
      }
      if (start >= 0 && run[index - 1].at - run[start].at >= CONFIG.pauses.minStopSeconds * 1000) inStop.fill(true, start, index)
      start = -1
    }
    run.forEach((point, index) => {
      const demonstrator = speedAt(reference.speeds, point.videoSeconds)
      if (demonstrator === null || demonstrator < CONFIG.pauses.demonstratorMovingSpeed) return
      moving += 1
      if (inStop[index]) paused += 1
    })
  }
  return moving >= 10 ? paused / moving : null
}

function poseMetric(similarity: number | null): MetricDraft {
  return {
    id: 'pose',
    label: '架势与示范一致',
    value: similarity === null ? null : round(similarity, 3),
    unit: '相似度',
    display: similarity === null ? '暂无比对' : `跟练相似度 ${percentText(similarity)}`,
    target: `≥ ${percentText(CONFIG.pose.fullSimilarity)}`,
    score: similarity === null ? null : rampScore(similarity, CONFIG.pose.zeroSimilarity, CONFIG.pose.fullSimilarity),
    nominalWeight: CONFIG.weights.pose,
    evaluated: true,
  }
}

function smoothnessMetric(value: number | null): MetricDraft {
  return {
    id: 'smoothness',
    label: '动作圆顺不抖',
    value: value === null ? null : round(value, 4),
    unit: '躯干长',
    display: value === null ? '动作数据不足' : `抖动 ${value.toFixed(3)} 躯干长`,
    target: `≤ ${CONFIG.smoothness.fullJitter} 躯干长`,
    score: value === null ? null : rampScore(value, CONFIG.smoothness.zeroJitter, CONFIG.smoothness.fullJitter),
    nominalWeight: CONFIG.weights.smoothness,
    evaluated: true,
  }
}

function extentMetric(ratio: number | null): MetricDraft {
  return {
    id: 'extent',
    label: '舒展度',
    value: ratio === null ? null : round(ratio, 3),
    unit: '示范倍数',
    display: ratio === null ? '动作数据不足' : `运动幅度为示范的 ${percentText(ratio)}`,
    target: `≥ 示范的 ${percentText(CONFIG.extent.fullRatio)}`,
    score: ratio === null ? null : rampScore(ratio, CONFIG.extent.zeroRatio, CONFIG.extent.fullRatio),
    nominalWeight: CONFIG.weights.extent,
    evaluated: true,
  }
}

function pauseMetric(share: number | null): MetricDraft {
  return {
    id: 'pauses',
    label: '连贯不停顿',
    value: share === null ? null : round(share, 3),
    unit: '比例',
    display: share === null ? '动作数据不足' : share === 0 ? '示范在动时没有停顿' : `示范在动时停顿 ${percentText(share)} 的时间`,
    target: `≤ ${percentText(CONFIG.pauses.fullShare)}`,
    score: share === null ? null : rampScore(share, CONFIG.pauses.zeroShare, CONFIG.pauses.fullShare),
    nominalWeight: CONFIG.weights.pauses,
    evaluated: true,
  }
}

function weightShiftMetric(step: TaijiquanStep, value: number | null): MetricDraft {
  const transfer = step.weightShift === 'transfer'
  const display = value === null
    ? '两踝不可见或过近，无法判断'
    : transfer ? `估计的左右转换幅度为示范的 ${percentText(value)}` : `定势时估计为${WEIGHT_SHIFT_LABEL[step.weightShift]}的时间占 ${percentText(value)}`
  const score = value === null ? null : transfer
    ? rampScore(value, CONFIG.weightShift.zeroRangeRatio, CONFIG.weightShift.fullRangeRatio)
    : rampScore(value, CONFIG.weightShift.zeroShare, CONFIG.weightShift.fullShare)
  return {
    id: 'weightShift',
    label: `重心转移估计：${WEIGHT_SHIFT_LABEL[step.weightShift]}（二维髋中心近似）`,
    value: value === null ? null : round(value, 3),
    unit: transfer ? '示范倍数' : '比例',
    display,
    target: transfer ? `≥ 示范的 ${percentText(CONFIG.weightShift.fullRangeRatio)}` : `≥ ${percentText(CONFIG.weightShift.fullShare)}`,
    score: step.scoreShift ? score : null,
    nominalWeight: CONFIG.weights.weightShift,
    evaluated: step.scoreShift,
    note: step.note,
  }
}

const SETTLE_ADVICE: Readonly<Record<WeightShift, string>> = { left: '定势时重心落在左腿', right: '定势时重心落在右腿', balanced: '定势时重心保持居中', transfer: '' }

function feedbackFor(metric: MetricResult, step: TaijiquanStep): AnalyzerFeedbackItem | null {
  if (metric.value === null) return null
  const good = metric.score !== null && metric.score >= 100
  switch (metric.id) {
    case 'pose':
      return good
        ? { metricId: metric.id, tone: 'success', message: `架势与示范一致（${metric.display}）` }
        : { metricId: metric.id, tone: 'warning', message: `${metric.display}，对照示范调整手脚位置` }
    case 'smoothness':
      return good
        ? { metricId: metric.id, tone: 'success', message: '动作圆顺，没有抖动' }
        : { metricId: metric.id, tone: 'warning', message: `${metric.display}，放松肩臂，动作缓慢圆顺` }
    case 'extent':
      return good
        ? { metricId: metric.id, tone: 'success', message: `动作舒展（${metric.display}）` }
        : { metricId: metric.id, tone: 'warning', message: `${metric.display}，手脚再走开一些，动作舒展大方` }
    case 'pauses':
      return good
        ? { metricId: metric.id, tone: 'success', message: '动作连贯，没有明显停顿' }
        : { metricId: metric.id, tone: 'warning', message: `${metric.display}，动作要连绵不断，一式接一式` }
    case 'weightShift':
      if (!metric.evaluated) return { metricId: metric.id, tone: 'info', message: `重心方向只记录不计分：${metric.display}` }
      return good
        ? { metricId: metric.id, tone: 'success', message: `重心转移估计与示范一致（${metric.display}）` }
        : { metricId: metric.id, tone: 'warning', message: step.weightShift === 'transfer' ? `${metric.display}，重心前后左右转换再充分一些` : `${metric.display}，${SETTLE_ADVICE[step.weightShift]}` }
    default:
      return null
  }
}
