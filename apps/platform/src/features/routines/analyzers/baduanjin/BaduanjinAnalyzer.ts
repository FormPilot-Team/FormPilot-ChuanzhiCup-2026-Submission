import type { ReferenceTrack } from '../../followAlong/referenceTrack'
import type { RoutineChapter, RoutineProgram } from '../../types'
import { orderFeedback, percentText, secondsText } from '../format'
import { referenceSamples } from '../reference'
import { combineMetrics, continuousRuns, finite, mean, movingAverage, percentile, rampScore, residuals, rms, round, type MetricDraft } from '../signal'
import type { AnalyzerContext, AnalyzerEvaluation, AnalyzerFeedbackItem, AnalyzerPose, AnalyzerReportMetrics, AnalyzerSample, MetricResult, RoutineAnalyzer } from '../types'
import { BADUANJIN_ANALYZER_CONFIG as CONFIG } from './config'
import { baduanjinFeatures, type BaduanjinFeatures } from './features'
import { BADUANJIN_STEPS, type BaduanjinStep, type BaduanjinTrajectory } from './steps'

/** 示范者的一次动作（托举、开弓…）：时间为视频秒，幅度为躯干长 */
export interface Repetition {
  onset: number
  rise: number
  peakAt: number
  offset: number
  excursion: number
  secondaryExcursion: number | null
}

export interface BaduanjinChapterReference {
  base: number
  top: number
  repetitions: Repetition[]
}

export interface BaduanjinEvaluation extends AnalyzerEvaluation {
  trajectory: BaduanjinTrajectory
  /** 攒拳只检测阶段，不评幅度时为 false */
  amplitudeEvaluated: boolean
  observedRepetitions: number
  expectedRepetitions: number
  /** 用户自身升起即算完成，与幅度无关 */
  completedRepetitions: number
  amplitudeRatio: number | null
  secondaryRatio: number | null
  /** 平均升起时刻差，s；正值表示偏晚 */
  timingOffsetSeconds: number | null
  holdJitter: number | null
}

interface TrajectoryPoint {
  at: number
  videoSeconds: number
  value: number
  secondary: number | null
  steady: ReadonlyArray<number>
}

function robustScale(samples: ReadonlyArray<AnalyzerSample<BaduanjinFeatures>>): number | null {
  const torsos = samples.flatMap((sample) => (sample.features ? [sample.features.torso] : []))
  const scale = percentile(torsos, CONFIG.scalePercentile)
  return scale !== null && scale > 0 ? scale : null
}

/** 缩放并轻度平滑；每个连续段单独平滑 */
function trajectoryRuns(samples: ReadonlyArray<AnalyzerSample<BaduanjinFeatures>>, scale: number): TrajectoryPoint[][] {
  const usable = samples.filter((sample) => typeof sample.features?.trajectory === 'number')
  return continuousRuns(usable, CONFIG.maxGapMs).map((run) => {
    const smooth = movingAverage(run.map((sample) => (sample.features as BaduanjinFeatures).trajectory as number / scale), CONFIG.smoothHalfWidth)
    return run.map((sample, index) => {
      const features = sample.features as BaduanjinFeatures
      return {
        at: sample.at,
        videoSeconds: sample.videoSeconds,
        value: smooth[index],
        secondary: features.secondary,
        steady: features.steady.map((value) => value / scale),
      }
    })
  })
}

function riseTime(points: ReadonlyArray<TrajectoryPoint>, base: number, peak: number): number | null {
  const level = base + CONFIG.timing.riseLevel * (peak - base)
  return points.find((point) => point.value >= level)?.videoSeconds ?? null
}

function secondaryPeak(points: ReadonlyArray<TrajectoryPoint>): number | null {
  const values = finite(points.map((point) => point.secondary))
  return values.length ? Math.max(...values) : null
}

export function findRepetitions(runs: ReadonlyArray<ReadonlyArray<TrajectoryPoint>>, chapter: RoutineChapter): BaduanjinChapterReference | null {
  const points = runs.flat()
  const values = points.map((point) => point.value)
  const base = percentile(values, CONFIG.repetition.basePercentile)
  const top = percentile(values, CONFIG.repetition.topPercentile)
  if (base === null || top === null || !(top > base)) return null
  const secondaryBase = percentile(finite(points.map((point) => point.secondary)), CONFIG.repetition.basePercentile)
  const level = base + CONFIG.repetition.levelShare * (top - base)
  const repetitions: Repetition[] = []
  let start = -1
  for (let index = 0; index <= points.length; index += 1) {
    if (index < points.length && points[index].value >= level) {
      if (start < 0) start = index
      continue
    }
    if (start < 0) continue
    const first = points[start]
    const last = points[index - 1]
    const span = points.slice(start, index)
    start = -1
    if (last.videoSeconds - first.videoSeconds < CONFIG.repetition.minSeconds) continue
    if (first.videoSeconds - chapter.startSeconds < CONFIG.repetition.startMarginSeconds) continue
    const peak = span.reduce((best, point) => (point.value > best.value ? point : best), span[0])
    const window = points.filter((point) => point.videoSeconds >= first.videoSeconds - CONFIG.repetition.leadSeconds && point.videoSeconds <= last.videoSeconds)
    const secondary = secondaryPeak(window)
    repetitions.push({
      onset: first.videoSeconds,
      rise: riseTime(window, base, peak.value) ?? first.videoSeconds,
      peakAt: peak.videoSeconds,
      offset: last.videoSeconds,
      excursion: peak.value - base,
      secondaryExcursion: secondary !== null && secondaryBase !== null && secondary > secondaryBase ? secondary - secondaryBase : null,
    })
  }
  return { base, top, repetitions }
}

/** 一次保持内各坐标残差 RMS 的中位数；有缺失的坐标跳过 */
function holdJitter(hold: ReadonlyArray<TrajectoryPoint>): number | null {
  if (hold.length < CONFIG.steadiness.minHoldSamples) return null
  const coordinates = hold[0].steady.length
  const values: number[] = []
  for (let index = 0; index < coordinates; index += 1) {
    const series = hold.map((point) => point.steady[index])
    if (!series.every(Number.isFinite)) continue
    const value = rms(residuals(series, CONFIG.steadiness.residualHalfWidth))
    if (value !== null) values.push(value)
  }
  return percentile(values, 0.5)
}

/** 包含峰值、且不低于 level 的连续段，即一次动作的顶点保持 */
function topHold(points: ReadonlyArray<TrajectoryPoint>, peakIndex: number, level: number): TrajectoryPoint[] {
  let from = peakIndex
  let to = peakIndex
  while (from > 0 && points[from - 1].value >= level && points[from].at - points[from - 1].at <= CONFIG.maxGapMs) from -= 1
  while (to < points.length - 1 && points[to + 1].value >= level && points[to + 1].at - points[to].at <= CONFIG.maxGapMs) to += 1
  return points.slice(from, to + 1)
}

interface RepetitionResult {
  ratio: number
  secondaryRatio: number | null
  completed: boolean
  timingOffset: number | null
  jitter: number | null
}

// 八段锦到位度（基于姿态关键点的二维近似）：在示范者每次动作的时间段内，
// 比较用户与示范者的峰值幅度、升起时机、顶点抖动以及是否完成
export class BaduanjinAnalyzer implements RoutineAnalyzer<BaduanjinFeatures, BaduanjinEvaluation> {
  readonly id = 'baduanjin' as const
  readonly version = CONFIG.version
  readonly title = '八段锦到位度'
  readonly liveWindowMs = CONFIG.liveWindowMs
  private readonly references = new Map<string, BaduanjinChapterReference>()

  constructor(program: RoutineProgram, track?: ReferenceTrack) {
    if (!track) return
    for (const chapter of program.chapters) {
      const step = BADUANJIN_STEPS[chapter.id]
      if (!step) continue
      const samples = referenceSamples(track, chapter, (pose) => baduanjinFeatures(pose, step))
      const scale = robustScale(samples)
      const reference = scale ? findRepetitions(trajectoryRuns(samples, scale), chapter) : null
      if (reference) this.references.set(chapter.id, reference)
    }
  }

  reference(chapterId: string): BaduanjinChapterReference | undefined {
    return this.references.get(chapterId)
  }

  covers(chapter: RoutineChapter): boolean {
    return Boolean(BADUANJIN_STEPS[chapter.id])
  }

  extractFeatures(pose: AnalyzerPose, context: AnalyzerContext): BaduanjinFeatures | null {
    const step = BADUANJIN_STEPS[context.chapter.id]
    return step ? baduanjinFeatures(pose, step) : null
  }

  evaluate(samples: ReadonlyArray<AnalyzerSample<BaduanjinFeatures>>, chapter: RoutineChapter): BaduanjinEvaluation | null {
    const step = BADUANJIN_STEPS[chapter.id]
    const reference = this.references.get(chapter.id)
    if (!step || !reference) return null
    const usable = samples.filter((sample) => typeof sample.features?.trajectory === 'number')
    if (usable.length < CONFIG.minSamples) return null
    const scale = robustScale(usable)
    if (!scale) return null
    const points = trajectoryRuns(usable, scale).flat()
    const values = points.map((point) => point.value)
    const userBase = percentile(values, CONFIG.repetition.basePercentile) as number
    const userTop = percentile(values, CONFIG.repetition.topPercentile) as number
    const secondaryBase = percentile(finite(points.map((point) => point.secondary)), CONFIG.repetition.basePercentile)

    const results: RepetitionResult[] = []
    for (const repetition of reference.repetitions) {
      const from = repetition.onset - CONFIG.repetition.leadSeconds
      const to = repetition.offset + CONFIG.repetition.lagSeconds
      const inside = points.filter((point) => point.videoSeconds >= from && point.videoSeconds <= to)
      // 只统计升起和峰值都被跟到的动作
      if (inside.length < CONFIG.repetition.minSamples || inside[0].videoSeconds > repetition.onset || inside[inside.length - 1].videoSeconds < repetition.peakAt) continue
      const peakIndex = inside.reduce((best, point, index) => (point.value > inside[best].value ? index : best), 0)
      const peak = inside[peakIndex].value
      const completed = userTop > userBase && peak - userBase >= CONFIG.phase.riseShare * (userTop - userBase)
      const rise = completed ? riseTime(inside, userBase, peak) : null
      const secondary = secondaryPeak(inside)
      results.push({
        ratio: Math.min(CONFIG.amplitude.maxRatio, Math.max(0, (peak - userBase) / repetition.excursion)),
        secondaryRatio: secondary !== null && secondaryBase !== null && repetition.secondaryExcursion
          ? Math.min(CONFIG.amplitude.maxRatio, Math.max(0, (secondary - secondaryBase) / repetition.secondaryExcursion))
          : null,
        completed,
        timingOffset: rise === null ? null : rise - repetition.rise,
        jitter: completed ? holdJitter(topHold(inside, peakIndex, userBase + CONFIG.steadiness.holdLevel * (peak - userBase))) : null,
      })
    }

    const amplitudeRatio = mean(results.map((result) => result.ratio))
    const secondaryRatio = mean(finite(results.map((result) => result.secondaryRatio)))
    const offsets = finite(results.map((result) => result.timingOffset))
    const jitter = percentile(finite(results.map((result) => result.jitter)), 0.5)
    const completed = results.filter((result) => result.completed).length
    const amplitudeEvaluated = step.amplitude !== 'phase-only'
    const { score, metrics } = combineMetrics([
      amplitudeMetric(step, amplitudeRatio, secondaryRatio, amplitudeEvaluated),
      timingMetric(offsets),
      steadinessMetric(jitter),
      phaseMetric(completed, results.length),
    ])
    return {
      score,
      metrics,
      usableSamples: usable.length,
      trajectory: step.trajectory,
      amplitudeEvaluated,
      observedRepetitions: results.length,
      expectedRepetitions: reference.repetitions.length,
      completedRepetitions: completed,
      amplitudeRatio: amplitudeRatio === null ? null : round(amplitudeRatio, 3),
      secondaryRatio: secondaryRatio === null ? null : round(secondaryRatio, 3),
      timingOffsetSeconds: offsets.length ? round(mean(offsets) as number, 2) : null,
      holdJitter: jitter === null ? null : round(jitter, 4),
    }
  }

  buildFeedback(evaluation: BaduanjinEvaluation, chapter: RoutineChapter): AnalyzerFeedbackItem[] {
    const step = BADUANJIN_STEPS[chapter.id]
    if (!step) return []
    return orderFeedback(evaluation.metrics.map((metric) => ({ metric, item: feedbackFor(metric, evaluation, step) })))
  }

  buildReportMetrics(chapters: ReadonlyArray<{ chapter: RoutineChapter; evaluation: BaduanjinEvaluation | null }>): AnalyzerReportMetrics {
    const scored = finite(chapters.map(({ evaluation }) => evaluation?.score))
    const average = mean(scored)
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
        '到位度按示范视频逐次比较：在示范者每一次托举、开弓等动作的时间段内，比较你与示范者的最大幅度、到位时机和顶点停留时的抖动。',
        '幅度是二维画面中的投影值，以躯干长为单位。第七式攒拳怒目增气力只检测冲拳阶段，未评估幅度；第八式背后七颠百病消的提踵幅度用肩部抬升近似，权重较低。',
        '预备势与收势没有到位动作，不计算到位度。全部阈值为暂定值，尚未用真人数据标定。',
      ],
      extras: {
        repetitions: chapters.map(({ chapter, evaluation }) => ({
          chapterId: chapter.id,
          expected: evaluation?.expectedRepetitions ?? null,
          observed: evaluation?.observedRepetitions ?? null,
          completed: evaluation?.completedRepetitions ?? null,
          amplitudeEvaluated: evaluation?.amplitudeEvaluated ?? BADUANJIN_STEPS[chapter.id]?.amplitude !== 'phase-only',
        })),
      },
    }
  }
}

function amplitudeMetric(step: BaduanjinStep, ratio: number | null, secondaryRatio: number | null, evaluated: boolean): MetricDraft {
  const proxy = step.amplitude === 'proxy'
  // 摇头摆尾：头部偏移和躯干侧倾都计入
  const combined = ratio !== null && step.secondary && secondaryRatio !== null ? (ratio + secondaryRatio) / 2 : ratio
  const secondaryText = step.secondary && secondaryRatio !== null && ratio !== null ? `（头部偏移 ${percentText(ratio)}，${step.secondary.label} ${percentText(secondaryRatio)}）` : ''
  return {
    id: proxy ? 'heelRiseProxy' : 'amplitude',
    label: proxy ? step.label : `到位幅度：${step.label}`,
    value: combined === null ? null : round(combined, 3),
    unit: '示范倍数',
    display: !evaluated ? '未评估幅度' : combined === null ? '未观测到完整动作' : `示范的 ${percentText(combined)}${secondaryText}${proxy ? '（近似）' : ''}`,
    target: evaluated ? `≥ 示范的 ${percentText(CONFIG.amplitude.fullRatio)}` : '只检测阶段',
    score: evaluated && combined !== null ? rampScore(combined, CONFIG.amplitude.zeroRatio, CONFIG.amplitude.fullRatio) : null,
    nominalWeight: CONFIG.weights.amplitude[step.amplitude],
    evaluated,
    note: step.note,
  }
}

/** 超出容差的秒数（晚于 1 s 或早于 0.6 s） */
function timingExcess(offset: number): number {
  return offset >= 0 ? Math.max(0, offset - CONFIG.timing.lateToleranceSeconds) : Math.max(0, -offset - CONFIG.timing.earlyToleranceSeconds)
}

function timingMetric(offsets: ReadonlyArray<number>): MetricDraft {
  const offset = mean(offsets)
  const excess = mean(offsets.map(timingExcess))
  return {
    id: 'timing',
    label: '到位时机',
    value: offset === null ? null : round(offset, 2),
    unit: '秒',
    display: offset === null ? '未观测到完整动作' : Math.abs(offset) < 0.05 ? '与示范同时到位' : `比示范${offset > 0 ? '晚' : '早'} ${secondsText(offset)}`,
    target: `晚 ≤ ${CONFIG.timing.lateToleranceSeconds} 秒、早 ≤ ${CONFIG.timing.earlyToleranceSeconds} 秒`,
    score: excess === null ? null : rampScore(excess, CONFIG.timing.zeroExcessSeconds, 0),
    nominalWeight: CONFIG.weights.timing,
    evaluated: true,
  }
}

function steadinessMetric(jitter: number | null): MetricDraft {
  return {
    id: 'steadiness',
    label: '定势稳定',
    value: jitter === null ? null : round(jitter, 4),
    unit: '躯干长',
    display: jitter === null ? '未观测到定势' : `顶点抖动 ${jitter.toFixed(3)} 躯干长`,
    target: `≤ ${CONFIG.steadiness.fullJitter} 躯干长`,
    score: jitter === null ? null : rampScore(jitter, CONFIG.steadiness.zeroJitter, CONFIG.steadiness.fullJitter),
    nominalWeight: CONFIG.weights.steadiness,
    evaluated: true,
  }
}

function phaseMetric(completed: number, observed: number): MetricDraft {
  const share = observed ? completed / observed : null
  return {
    id: 'phases',
    label: '完成次数',
    value: share === null ? null : round(share, 3),
    unit: '比例',
    display: share === null ? '未观测到完整动作' : `示范 ${observed} 次，完成 ${completed} 次`,
    target: '每次都完成',
    score: share === null ? null : rampScore(share, CONFIG.phase.zeroShare, CONFIG.phase.fullShare),
    nominalWeight: CONFIG.weights.phases,
    evaluated: true,
  }
}

function feedbackFor(metric: MetricResult, evaluation: BaduanjinEvaluation, step: BaduanjinStep): AnalyzerFeedbackItem | null {
  const good = metric.score !== null && metric.score >= 100
  switch (metric.id) {
    case 'amplitude':
    case 'heelRiseProxy':
      if (!metric.evaluated) return { metricId: metric.id, tone: 'info', message: `${step.label}：只检测冲拳阶段，未评估幅度` }
      if (evaluation.amplitudeRatio === null) return null
      return good
        ? { metricId: metric.id, tone: 'success', message: `幅度到位：${step.label}达到${metric.display}` }
        : { metricId: metric.id, tone: 'warning', message: `${step.label}只达到${metric.display}，${step.cue}` }
    case 'timing':
      if (evaluation.timingOffsetSeconds === null) return null
      return good
        ? { metricId: metric.id, tone: 'success', message: '到位时机与示范一致' }
        : { metricId: metric.id, tone: 'warning', message: evaluation.timingOffsetSeconds > 0 ? `动作平均比示范晚 ${secondsText(evaluation.timingOffsetSeconds)}到位，跟上口令节奏` : `动作平均比示范早 ${secondsText(evaluation.timingOffsetSeconds)}，随口令再起` }
    case 'steadiness':
      if (evaluation.holdJitter === null) return null
      return good
        ? { metricId: metric.id, tone: 'success', message: '定势稳定' }
        : { metricId: metric.id, tone: 'warning', message: `定势时抖动 ${evaluation.holdJitter.toFixed(3)} 躯干长，到位后稍停、稳住再走` }
    case 'phases':
      if (!evaluation.observedRepetitions || good) return null
      return { metricId: metric.id, tone: 'warning', message: `示范做了 ${evaluation.observedRepetitions} 次，识别到你完成 ${evaluation.completedRepetitions} 次` }
    default:
      return null
  }
}
