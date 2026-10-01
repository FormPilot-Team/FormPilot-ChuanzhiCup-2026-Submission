import type { ReferenceTrack } from '../../followAlong/referenceTrack'
import type { RoutineChapter, RoutineProgram } from '../../types'
import { orderFeedback, percentText, secondsText } from '../format'
import { referenceSamples } from '../reference'
import { combineMetrics, continuousRuns, finite, mean, movingAverage, percentile, rampScore, residuals, rms, round, type MetricDraft } from '../signal'
import type { AnalyzerContext, AnalyzerEvaluation, AnalyzerFeedbackItem, AnalyzerPose, AnalyzerReportMetrics, AnalyzerSample, MetricResult, RoutineAnalyzer } from '../types'
import { WUQINXI_ANALYZER_CONFIG as CONFIG } from './config'
import { WUQINXI_FEATURES, wuqinxiFeatures, type WuqinxiFeatureId, type WuqinxiFeatures } from './features'
import { WUQINXI_CATEGORY_LABEL, WUQINXI_CATEGORY_QUALITY, WUQINXI_STEPS, type WuqinxiCategory, type WuqinxiStep } from './steps'

interface SeriesPoint {
  videoSeconds: number
  value: number
}

export interface WuqinxiChapterReference {
  /** 示范者各特征的范围（已缩放），顺序同步骤表 */
  ranges: Array<number | null>
  /** 第一个特征的示范序列，按视频时间排序，作节律参考 */
  primary: SeriesPoint[]
}

export interface WuqinxiEvaluation extends AnalyzerEvaluation {
  category: WuqinxiCategory
  profile: Array<{ feature: WuqinxiFeatureId; ratio: number | null }>
  similarity: number | null
  /** 动作节律相对示范的滞后，s；正值表示偏晚，读不出时为 null */
  lagSeconds: number | null
  jitter: number | null
}

function robustScale(samples: ReadonlyArray<AnalyzerSample<WuqinxiFeatures>>): number | null {
  const scale = percentile(samples.flatMap((sample) => (sample.features ? [sample.features.torso] : [])), CONFIG.scalePercentile)
  return scale !== null && scale > 0 ? scale : null
}

/** 单个特征的平滑序列，长度按身体尺度缩放；平滑不跨断点 */
function featureSeries(samples: ReadonlyArray<AnalyzerSample<WuqinxiFeatures>>, index: number, feature: WuqinxiFeatureId, scale: number): SeriesPoint[] {
  const divisor = WUQINXI_FEATURES[feature].kind === 'length' ? scale : 1
  const visible = samples.filter((sample) => typeof sample.features?.profile[index] === 'number')
  return continuousRuns(visible, CONFIG.maxGapMs).flatMap((run) => {
    const smooth = movingAverage(run.map((sample) => (sample.features as WuqinxiFeatures).profile[index] as number / divisor), CONFIG.smoothHalfWidth)
    return run.map((sample, item) => ({ videoSeconds: sample.videoSeconds, value: smooth[item] }))
  })
}

function range(points: ReadonlyArray<SeriesPoint>): number | null {
  if (points.length < CONFIG.profile.minFeatureSamples) return null
  const values = points.map((point) => point.value)
  return (percentile(values, CONFIG.profile.highPercentile) as number) - (percentile(values, CONFIG.profile.lowPercentile) as number)
}

function valueAt(series: ReadonlyArray<SeriesPoint>, videoSeconds: number): number | null {
  let low = 0
  let high = series.length - 1
  if (high < 0) return null
  while (low < high) {
    const middle = (low + high) >> 1
    if (series[middle].videoSeconds < videoSeconds) low = middle + 1
    else high = middle
  }
  const nearest = low > 0 && Math.abs(series[low - 1].videoSeconds - videoSeconds) < Math.abs(series[low].videoSeconds - videoSeconds) ? series[low - 1] : series[low]
  return Math.abs(nearest.videoSeconds - videoSeconds) <= 0.3 ? nearest.value : null
}

function correlation(pairs: ReadonlyArray<readonly [number, number]>): number | null {
  if (pairs.length < 20) return null
  const meanA = pairs.reduce((sum, [a]) => sum + a, 0) / pairs.length
  const meanB = pairs.reduce((sum, [, b]) => sum + b, 0) / pairs.length
  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (const [a, b] of pairs) {
    covariance += (a - meanA) * (b - meanB)
    varianceA += (a - meanA) ** 2
    varianceB += (b - meanB) ** 2
  }
  return varianceA > 0 && varianceB > 0 ? covariance / Math.sqrt(varianceA * varianceB) : null
}

/** 用户第一个特征与示范者相关最强的滞后（正值表示偏晚） */
export function rhythmLag(user: ReadonlyArray<SeriesPoint>, reference: ReadonlyArray<SeriesPoint>): number | null {
  if (!user.length || user[user.length - 1].videoSeconds - user[0].videoSeconds < CONFIG.rhythm.minSeconds) return null
  let best: { lag: number; correlation: number } | null = null
  const steps = Math.round((CONFIG.rhythm.maxLagSeconds - CONFIG.rhythm.minLagSeconds) / CONFIG.rhythm.lagStepSeconds)
  for (let step = 0; step <= steps; step += 1) {
    const lag = round(CONFIG.rhythm.minLagSeconds + step * CONFIG.rhythm.lagStepSeconds, 2)
    const pairs: Array<readonly [number, number]> = []
    for (const point of user) {
      const expected = valueAt(reference, point.videoSeconds - lag)
      if (expected !== null) pairs.push([point.value, expected])
    }
    const value = correlation(pairs)
    // 相关相同时取绝对值最小的滞后
    if (value !== null && (!best || value > best.correlation + 1e-6 || (Math.abs(value - best.correlation) <= 1e-6 && Math.abs(lag) < Math.abs(best.lag)))) best = { lag, correlation: value }
  }
  return best && best.correlation >= CONFIG.rhythm.minCorrelation ? best.lag : null
}

function blockJitter(samples: ReadonlyArray<AnalyzerSample<WuqinxiFeatures>>, scale: number): number | null {
  const blocks: number[] = []
  const block = CONFIG.steadiness.blockSamples
  for (const run of continuousRuns(samples, CONFIG.maxGapMs)) {
    if (run.length < block) continue
    const coordinates = (run[0].features as WuqinxiFeatures).steady.length
    for (let index = 0; index < coordinates; index += 1) {
      const series = run.map((sample) => (sample.features as WuqinxiFeatures).steady[index] / scale)
      if (!series.every(Number.isFinite)) continue
      const residual = residuals(series, CONFIG.steadiness.residualHalfWidth)
      for (let from = 0; from + block <= residual.length; from += block) blocks.push(rms(residual.slice(from, from + block)) as number)
    }
  }
  return percentile(blocks, 0.5)
}

// 五禽戏五戏特征（基于姿态关键点的二维近似）：每一动比较该戏特征的变化范围与示范者的比值，
// 并结合节律、跟练相似度与稳定性；报告按虎、鹿、熊、猿、鸟分组
export class WuqinxiAnalyzer implements RoutineAnalyzer<WuqinxiFeatures, WuqinxiEvaluation> {
  readonly id = 'wuqinxi' as const
  readonly version = CONFIG.version
  readonly title = '五禽戏五戏特征'
  readonly liveWindowMs = CONFIG.liveWindowMs
  private readonly references = new Map<string, WuqinxiChapterReference>()

  constructor(program: RoutineProgram, track?: ReferenceTrack) {
    if (!track) return
    for (const chapter of program.chapters) {
      const step = WUQINXI_STEPS[chapter.id]
      if (!step) continue
      const samples = referenceSamples(track, chapter, (pose) => wuqinxiFeatures(pose, {}, step.features))
      const scale = robustScale(samples)
      if (!scale) continue
      this.references.set(chapter.id, {
        ranges: step.features.map((feature, index) => range(featureSeries(samples, index, feature, scale))),
        primary: featureSeries(samples, 0, step.features[0], scale),
      })
    }
  }

  reference(chapterId: string): WuqinxiChapterReference | undefined {
    return this.references.get(chapterId)
  }

  covers(chapter: RoutineChapter): boolean {
    return Boolean(WUQINXI_STEPS[chapter.id])
  }

  extractFeatures(pose: AnalyzerPose, context: AnalyzerContext): WuqinxiFeatures | null {
    const step = WUQINXI_STEPS[context.chapter.id]
    return step ? wuqinxiFeatures(pose, context, step.features) : null
  }

  evaluate(samples: ReadonlyArray<AnalyzerSample<WuqinxiFeatures>>, chapter: RoutineChapter): WuqinxiEvaluation | null {
    const step = WUQINXI_STEPS[chapter.id]
    const reference = this.references.get(chapter.id)
    if (!step || !reference) return null
    const usable = samples.filter((sample) => sample.features !== null)
    if (usable.length < CONFIG.minSamples) return null
    const scale = robustScale(usable)
    if (!scale) return null

    const profile = step.features.map((feature, index) => {
      const userRange = range(featureSeries(usable, index, feature, scale))
      const demonstrator = reference.ranges[index]
      const ratio = userRange === null || !demonstrator ? null : Math.min(CONFIG.profile.maxRatio, userRange / demonstrator)
      return { feature, ratio: ratio === null ? null : round(ratio, 3) }
    })
    const similarity = mean(finite(usable.map((sample) => sample.features?.similarity)))
    const lagSeconds = rhythmLag(featureSeries(usable, 0, step.features[0], scale), reference.primary)
    const jitter = blockJitter(usable, scale)
    const { score, metrics } = combineMetrics([
      ...profile.map((item) => profileMetric(step, item.feature, item.ratio)),
      poseMetric(similarity),
      rhythmMetric(lagSeconds),
      steadinessMetric(jitter),
    ])
    return {
      score,
      metrics,
      usableSamples: usable.length,
      category: step.category,
      profile,
      similarity: similarity === null ? null : round(similarity, 3),
      lagSeconds,
      jitter: jitter === null ? null : round(jitter, 4),
    }
  }

  buildFeedback(evaluation: WuqinxiEvaluation, chapter: RoutineChapter): AnalyzerFeedbackItem[] {
    const step = WUQINXI_STEPS[chapter.id]
    if (!step) return []
    return orderFeedback(evaluation.metrics.map((metric) => ({ metric, item: feedbackFor(metric, step, evaluation) })))
  }

  buildReportMetrics(chapters: ReadonlyArray<{ chapter: RoutineChapter; evaluation: WuqinxiEvaluation | null }>): AnalyzerReportMetrics {
    const average = mean(finite(chapters.map(({ evaluation }) => evaluation?.score)))
    const categories = (Object.keys(WUQINXI_CATEGORY_LABEL) as WuqinxiCategory[]).flatMap((category) => {
      const forms = chapters.filter(({ chapter }) => WUQINXI_STEPS[chapter.id]?.category === category)
      if (!forms.length) return []
      const ratios = forms.flatMap(({ evaluation }) => (Array.isArray(evaluation?.profile) ? finite(evaluation.profile.map((item) => item.ratio)) : []))
      const scores = finite(forms.map(({ evaluation }) => evaluation?.score))
      const ratio = mean(ratios)
      const score = mean(scores)
      return [{
        category,
        label: WUQINXI_CATEGORY_LABEL[category],
        quality: WUQINXI_CATEGORY_QUALITY[category],
        chapterIds: forms.map(({ chapter }) => chapter.id),
        profileRatio: ratio === null ? null : round(ratio, 3),
        score: score === null ? null : Math.round(score),
      }]
    })
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
        '五戏特征按动物分组：每一动选取一到两个能在正面画面中看到的特征（如熊晃的提髋与晃动、猿提的耸肩与提踵），把你的动作幅度与示范者同一动作的幅度相比。',
        '躯干前屈、转腰、提踵等是二维画面中的近似量（代理指标），起势与收势不属于任何一戏，不计算五戏特征。',
        '全部阈值为暂定值，尚未用真人数据标定。',
      ],
      extras: { categories },
    }
  }
}

function profileMetric(step: WuqinxiStep, feature: WuqinxiFeatureId, ratio: number | null): MetricDraft {
  const definition = WUQINXI_FEATURES[feature]
  return {
    id: `profile.${feature}`,
    label: `${WUQINXI_CATEGORY_LABEL[step.category]}特征：${definition.label}`,
    value: ratio,
    unit: '示范倍数',
    display: ratio === null ? '未能稳定识别' : `幅度为示范的 ${percentText(ratio)}`,
    target: `≥ 示范的 ${percentText(CONFIG.profile.fullRatio)}`,
    score: ratio === null ? null : rampScore(ratio, CONFIG.profile.zeroRatio, CONFIG.profile.fullRatio),
    nominalWeight: CONFIG.weights.profile / step.features.length,
    evaluated: true,
    note: definition.proxy,
  }
}

function poseMetric(similarity: number | null): MetricDraft {
  return {
    id: 'pose',
    label: '形似示范',
    value: similarity === null ? null : round(similarity, 3),
    unit: '相似度',
    display: similarity === null ? '暂无比对' : `跟练相似度 ${percentText(similarity)}`,
    target: `≥ ${percentText(CONFIG.pose.fullSimilarity)}`,
    score: similarity === null ? null : rampScore(similarity, CONFIG.pose.zeroSimilarity, CONFIG.pose.fullSimilarity),
    nominalWeight: CONFIG.weights.pose,
    evaluated: true,
  }
}

function rhythmExcess(lag: number): number {
  return lag >= 0 ? Math.max(0, lag - CONFIG.rhythm.lateToleranceSeconds) : Math.max(0, -lag - CONFIG.rhythm.earlyToleranceSeconds)
}

function rhythmMetric(lag: number | null): MetricDraft {
  return {
    id: 'rhythm',
    label: '动作节律',
    value: lag,
    unit: '秒',
    display: lag === null ? '节律未能识别' : Math.abs(lag) < 0.05 ? '与示范同步' : `比示范${lag > 0 ? '慢' : '快'} ${secondsText(lag)}`,
    target: `慢 ≤ ${CONFIG.rhythm.lateToleranceSeconds} 秒、快 ≤ ${CONFIG.rhythm.earlyToleranceSeconds} 秒`,
    score: lag === null ? null : rampScore(rhythmExcess(lag), CONFIG.rhythm.zeroExcessSeconds, 0),
    nominalWeight: CONFIG.weights.rhythm,
    evaluated: true,
  }
}

function steadinessMetric(jitter: number | null): MetricDraft {
  return {
    id: 'steadiness',
    label: '动作稳定',
    value: jitter === null ? null : round(jitter, 4),
    unit: '躯干长',
    display: jitter === null ? '动作数据不足' : `抖动 ${jitter.toFixed(3)} 躯干长`,
    target: `≤ ${CONFIG.steadiness.fullJitter} 躯干长`,
    score: jitter === null ? null : rampScore(jitter, CONFIG.steadiness.zeroJitter, CONFIG.steadiness.fullJitter),
    nominalWeight: CONFIG.weights.steadiness,
    evaluated: true,
  }
}

function feedbackFor(metric: MetricResult, step: WuqinxiStep, evaluation: WuqinxiEvaluation): AnalyzerFeedbackItem | null {
  if (metric.value === null) return null
  const good = metric.score !== null && metric.score >= 100
  if (metric.id.startsWith('profile.')) {
    return good
      ? { metricId: metric.id, tone: 'success', message: `${metric.label}到位（${metric.display}），${WUQINXI_CATEGORY_QUALITY[evaluation.category]}之意已出` }
      : { metricId: metric.id, tone: 'warning', message: `${metric.label}${metric.display}，${step.cue}` }
  }
  switch (metric.id) {
    case 'pose':
      return good
        ? { metricId: metric.id, tone: 'success', message: `形似示范（${metric.display}）` }
        : { metricId: metric.id, tone: 'warning', message: `${metric.display}，对照示范调整手形与步型` }
    case 'rhythm':
      return good
        ? { metricId: metric.id, tone: 'success', message: '动作节律与示范同步' }
        : { metricId: metric.id, tone: 'warning', message: `动作节律${metric.display}，跟随口令起落` }
    case 'steadiness':
      return good
        ? { metricId: metric.id, tone: 'success', message: '动作稳定' }
        : { metricId: metric.id, tone: 'warning', message: `${metric.display}，动作放慢、稳住重心` }
    default:
      return null
  }
}
