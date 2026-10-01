import { describePose } from '../../followAlong/matcher'
import type { ReferenceTrack } from '../../followAlong/referenceTrack'
import type { RoutineChapter, RoutineProgram } from '../../types'
import { orderFeedback, percentText, secondsText } from '../format'
import { nearestTrackFrame, referenceSamples } from '../reference'
import { combineMetrics, continuousRuns, finite, longestTrueRun, mean, percentile, rampScore, residuals, rms, round, type MetricDraft } from '../signal'
import type { AnalyzerContext, AnalyzerEvaluation, AnalyzerFeedbackItem, AnalyzerPose, AnalyzerReportMetrics, AnalyzerSample, MetricResult, RoutineAnalyzer } from '../types'
import { YIJINJING_ANALYZER_CONFIG as CONFIG } from './config'
import { yijinjingFeatures, type PoseDescriptor, type YijinjingFeatures } from './features'
import { YIJINJING_MODE_LABEL, YIJINJING_STEPS, type YijinjingMode, type YijinjingStep } from './steps'

interface FramePoint {
  at: number
  videoSeconds: number
  /** 与前一样本（同一连续段）之间这一步是静止的 */
  still: boolean
  /** 这一步的起点，即同段前一样本的时间；段内第一帧为 null */
  stepFrom: number | null
  stepFromVideo: number | null
  /** 六个点相对短平均的残差 RMS，单位躯干长 */
  jitter: number | null
  /** 肩、髋中心（已缩放），用于晃动 */
  centre: { x: number; y: number } | null
  targetSimilarity: number | null
}

export interface StillStretch {
  from: number
  to: number
  durationMs: number
}

export interface YijinjingChapterReference {
  /** 示范者在本势中最长的静止段 */
  still: StillStretch
  /** 目标姿态：该静止段中点的示范帧（仅保持类） */
  target: PoseDescriptor | null
  targetAt: number | null
}

export interface YijinjingEvaluation extends AnalyzerEvaluation {
  mode: YijinjingMode
  /** 保持类为窗口内目标相似度均值，过渡类为跟练相似度均值 */
  pose: number | null
  holdRatio: number | null
  holdSeconds: number | null
  demonstratorHoldSeconds: number | null
  jitter: number | null
  /** 仅保持类：在目标姿态中时肩、髋中心的漂移 */
  sway: number | null
}

function robustScale(samples: ReadonlyArray<AnalyzerSample<YijinjingFeatures>>): number | null {
  const scale = percentile(samples.flatMap((sample) => (sample.features ? [sample.features.torso] : [])), CONFIG.scalePercentile)
  return scale !== null && scale > 0 ? scale : null
}

/** 逐样本的静止、抖动和中心位置；速度与残差不跨断点 */
export function framePoints(samples: ReadonlyArray<AnalyzerSample<YijinjingFeatures>>, scale: number): FramePoint[] {
  const points: FramePoint[] = []
  for (const run of continuousRuns(samples, CONFIG.maxGapMs)) {
    const coordinates = (run[0].features as YijinjingFeatures).points.length
    const raw: number[][] = []
    const shaking: number[][] = []
    for (let index = 0; index < coordinates; index += 1) {
      const series = run.map((sample) => (sample.features as YijinjingFeatures).points[index] / scale)
      raw.push(series)
      shaking.push(residuals(series, CONFIG.stability.residualHalfWidth))
    }
    run.forEach((sample, item) => {
      let fastest = 0
      let known = false
      if (item > 0) {
        const seconds = (sample.at - run[item - 1].at) / 1000
        const torso = (sample.features as YijinjingFeatures).torso / scale
        for (let index = 0; index < coordinates; index += 2) {
          const speed = Math.hypot(raw[index][item] - raw[index][item - 1], raw[index + 1][item] - raw[index + 1][item - 1]) / seconds / torso
          if (!Number.isFinite(speed)) continue
          known = true
          fastest = Math.max(fastest, speed)
        }
      }
      const residual = finite(shaking.map((series) => series[item]))
      // 六个点中第 2–5 对是双肩、双髋
      const centre = [2, 3, 4, 5].every((pair) => Number.isFinite(raw[pair * 2][item]) && Number.isFinite(raw[pair * 2 + 1][item]))
        ? { x: (raw[4][item] + raw[6][item] + raw[8][item] + raw[10][item]) / 4, y: (raw[5][item] + raw[7][item] + raw[9][item] + raw[11][item]) / 4 }
        : null
      points.push({
        at: sample.at,
        videoSeconds: sample.videoSeconds,
        still: known && fastest < CONFIG.stillness.maxSpeed,
        stepFrom: item > 0 ? run[item - 1].at : null,
        stepFromVideo: item > 0 ? run[item - 1].videoSeconds : null,
        jitter: residual.length ? rms(residual) : null,
        centre,
        targetSimilarity: (sample.features as YijinjingFeatures).targetSimilarity,
      })
    })
  }
  return points
}

/** 最长的连续静止段，从第一步的起点到最后一步的终点 */
export function longestStill(points: ReadonlyArray<FramePoint>): StillStretch | null {
  let best: StillStretch | null = null
  let start = -1
  for (let index = 0; index <= points.length; index += 1) {
    // 静止步总是接在同一段的前一样本之后（段内第一帧不会被标为静止）
    const continues = index < points.length && points[index].still && (start < 0 || points[index].stepFrom === points[index - 1].at)
    if (continues) {
      if (start < 0) start = index
      continue
    }
    if (start >= 0) {
      const first = points[start]
      const last = points[index - 1]
      const durationMs = last.at - (first.stepFrom as number)
      if (!best || durationMs > best.durationMs) best = { from: first.stepFromVideo as number, to: last.videoSeconds, durationMs }
    }
    start = index < points.length && points[index].still ? index : -1
  }
  return best
}

/** 预备势、收势为保持类；其余按示范静止是否达到 holdMinMs */
export function modeRule(chapter: RoutineChapter, still: StillStretch | null): YijinjingMode {
  if (chapter.kind !== 'form') return 'hold'
  return still && still.durationMs >= CONFIG.stillness.holdMinMs ? 'hold' : 'transition'
}

function blockMedian(values: ReadonlyArray<number | null>, block = 10): number | null {
  const blocks: number[] = []
  for (let from = 0; from + block <= values.length; from += block) {
    const slice = finite(values.slice(from, from + block))
    if (slice.length >= block / 2) blocks.push(rms(slice) as number)
  }
  return percentile(blocks, 0.5)
}

function sway(points: ReadonlyArray<FramePoint>): number | null {
  const centres = points.flatMap((point) => (point.centre ? [point.centre] : []))
  if (centres.length < 5) return null
  const x = mean(centres.map((centre) => centre.x)) as number
  const y = mean(centres.map((centre) => centre.y)) as number
  return rms(centres.map((centre) => Math.hypot(centre.x - x, centre.y - y)))
}

// 易筋经稳定性（基于姿态关键点的二维近似）：保持类与示范者最长静止段比较目标姿态、保持时长与抖动晃动；
// 过渡类只看跟练相似度与动作中的抖动
export class YijinjingAnalyzer implements RoutineAnalyzer<YijinjingFeatures, YijinjingEvaluation> {
  readonly id = 'yijinjing' as const
  readonly version = CONFIG.version
  readonly title = '易筋经稳定性'
  readonly liveWindowMs = CONFIG.liveWindowMs
  private readonly references = new Map<string, YijinjingChapterReference>()

  constructor(program: RoutineProgram, track?: ReferenceTrack) {
    if (!track) return
    const aspect = track.width / track.height
    for (const chapter of program.chapters) {
      const step = YIJINJING_STEPS[chapter.id]
      if (!step) continue
      const samples = referenceSamples(track, chapter, (pose) => yijinjingFeatures(pose, {}))
      const scale = robustScale(samples)
      const still = scale ? longestStill(framePoints(samples, scale)) : null
      if (!still) continue
      const targetAt = (still.from + still.to) / 2
      const frame = step.mode === 'hold' ? nearestTrackFrame(track, targetAt) : undefined
      const target = frame && frame.landmarks.length ? describePose(frame.landmarks, aspect) : null
      this.references.set(chapter.id, { still, target, targetAt: target ? frame?.t ?? null : null })
    }
  }

  reference(chapterId: string): YijinjingChapterReference | undefined {
    return this.references.get(chapterId)
  }

  covers(chapter: RoutineChapter): boolean {
    return Boolean(YIJINJING_STEPS[chapter.id])
  }

  extractFeatures(pose: AnalyzerPose, context: AnalyzerContext): YijinjingFeatures | null {
    const step = YIJINJING_STEPS[context.chapter.id]
    const target = this.references.get(context.chapter.id)?.target
    if (!step) return null
    return yijinjingFeatures(pose, context, target ? { descriptor: target, sided: step.sided } : undefined)
  }

  evaluate(samples: ReadonlyArray<AnalyzerSample<YijinjingFeatures>>, chapter: RoutineChapter): YijinjingEvaluation | null {
    const step = YIJINJING_STEPS[chapter.id]
    const reference = this.references.get(chapter.id)
    if (!step || !reference) return null
    const usable = samples.filter((sample) => sample.features !== null)
    if (usable.length < CONFIG.minSamples) return null
    const scale = robustScale(usable)
    if (!scale) return null
    const points = framePoints(usable, scale)
    return step.mode === 'hold' && reference.target ? this.evaluateHold(points, usable.length, step, reference) : this.evaluateTransition(points, usable, step)
  }

  private evaluateHold(points: ReadonlyArray<FramePoint>, usableSamples: number, step: YijinjingStep, reference: YijinjingChapterReference): YijinjingEvaluation {
    // 只与样本覆盖到的那部分示范静止段比较（实时窗口可能只覆盖一部分）
    const coveredFrom = Math.max(reference.still.from, points[0]?.videoSeconds ?? Infinity)
    const coveredTo = Math.min(reference.still.to, points[points.length - 1]?.videoSeconds ?? -Infinity)
    const demonstratorSeconds = Math.max(0, coveredTo - coveredFrom)
    const window = demonstratorSeconds >= CONFIG.hold.minCoveredSeconds
      ? points.filter((point) => point.videoSeconds >= coveredFrom && point.videoSeconds <= reference.still.to + CONFIG.target.lagSeconds)
      : []
    const similarities = finite(window.map((point) => point.targetSimilarity))
    const pose = similarities.length >= 5 ? (mean(similarities) as number) : null
    const inPose = window.map((point) => point.targetSimilarity !== null && point.targetSimilarity >= CONFIG.target.reachSimilarity)
    const held = longestStill(window.map((point, index) => ({ ...point, still: point.still && inPose[index] })))
    const holdSeconds = window.length >= 5 ? (held?.durationMs ?? 0) / 1000 : null
    const holdRatio = holdSeconds === null || !(demonstratorSeconds > 0) ? null : Math.min(1, holdSeconds / demonstratorSeconds)
    // 抖动与晃动取用户处于目标姿态的最长一段
    const posed = longestTrueRun(inPose, window.map((point) => point.at))
    const stretch = posed.from >= 0 ? window.slice(posed.from, posed.to + 1) : []
    const jitter = stretch.length >= 5 ? rms(finite(stretch.map((point) => point.jitter))) : null
    const drift = stretch.length >= 5 ? sway(stretch) : null
    const { score, metrics } = combineMetrics([
      targetMetric(pose),
      holdMetric(holdRatio, holdSeconds, demonstratorSeconds),
      stabilityMetric(step.mode, jitter, drift),
    ])
    return {
      score,
      metrics,
      usableSamples,
      mode: 'hold',
      pose: pose === null ? null : round(pose, 3),
      holdRatio: holdRatio === null ? null : round(holdRatio, 3),
      holdSeconds: holdSeconds === null ? null : round(holdSeconds, 1),
      demonstratorHoldSeconds: round(demonstratorSeconds, 1),
      jitter: jitter === null ? null : round(jitter, 4),
      sway: drift === null ? null : round(drift, 4),
    }
  }

  private evaluateTransition(points: ReadonlyArray<FramePoint>, usable: ReadonlyArray<AnalyzerSample<YijinjingFeatures>>, step: YijinjingStep): YijinjingEvaluation {
    const similarity = mean(finite(usable.map((sample) => sample.features?.similarity)))
    const jitter = blockMedian(points.map((point) => point.jitter))
    const { score, metrics } = combineMetrics([poseMetric(similarity), stabilityMetric(step.mode, jitter, null)])
    return {
      score,
      metrics,
      usableSamples: usable.length,
      mode: 'transition',
      pose: similarity === null ? null : round(similarity, 3),
      holdRatio: null,
      holdSeconds: null,
      demonstratorHoldSeconds: null,
      jitter: jitter === null ? null : round(jitter, 4),
      sway: null,
    }
  }

  buildFeedback(evaluation: YijinjingEvaluation, chapter: RoutineChapter): AnalyzerFeedbackItem[] {
    const step = YIJINJING_STEPS[chapter.id]
    if (!step) return []
    return orderFeedback(evaluation.metrics.map((metric) => ({ metric, item: feedbackFor(metric, step, evaluation) })))
  }

  buildReportMetrics(chapters: ReadonlyArray<{ chapter: RoutineChapter; evaluation: YijinjingEvaluation | null }>): AnalyzerReportMetrics {
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
        '保持类的势与示范者最长的静止段比较：目标姿态取该静止段中点的示范姿态，保持完成度是你在目标姿态中静止不动的最长时长与示范静止时长之比，稳定性看保持时的抖动与晃动。',
        '过渡类的势没有长时间定势，只看跟练相似度与动作中的抖动（姿态 0.40、稳定性 0.35 按比例归一）。有左右之分的势只按原样比较目标姿态，不做镜像。',
        '全部阈值为暂定值，尚未用真人数据标定。',
      ],
      extras: {
        holds: chapters.map(({ chapter, evaluation }) => ({
          chapterId: chapter.id,
          mode: YIJINJING_STEPS[chapter.id]?.mode ?? null,
          holdSeconds: evaluation?.holdSeconds ?? null,
          demonstratorHoldSeconds: evaluation?.demonstratorHoldSeconds ?? null,
        })),
      },
    }
  }
}

function targetMetric(similarity: number | null): MetricDraft {
  return {
    id: 'pose',
    label: '目标姿态',
    value: similarity === null ? null : round(similarity, 3),
    unit: '相似度',
    display: similarity === null ? '未观测到定势' : `与示范定势的相似度 ${percentText(similarity)}`,
    target: `≥ ${percentText(CONFIG.target.fullSimilarity)}`,
    score: similarity === null ? null : rampScore(similarity, CONFIG.target.zeroSimilarity, CONFIG.target.fullSimilarity),
    nominalWeight: CONFIG.weights.pose,
    evaluated: true,
  }
}

function poseMetric(similarity: number | null): MetricDraft {
  return {
    id: 'pose',
    label: '姿态（跟练相似度）',
    value: similarity === null ? null : round(similarity, 3),
    unit: '相似度',
    display: similarity === null ? '暂无比对' : `跟练相似度 ${percentText(similarity)}`,
    target: `≥ ${percentText(CONFIG.pose.fullSimilarity)}`,
    score: similarity === null ? null : rampScore(similarity, CONFIG.pose.zeroSimilarity, CONFIG.pose.fullSimilarity),
    nominalWeight: CONFIG.weights.pose,
    evaluated: true,
  }
}

function holdMetric(ratio: number | null, seconds: number | null, demonstratorSeconds: number): MetricDraft {
  return {
    id: 'hold',
    label: '保持完成度',
    value: ratio === null ? null : round(ratio, 3),
    unit: '比例',
    display: seconds === null ? '未观测到定势' : `静止保持 ${seconds.toFixed(1)} 秒（示范 ${demonstratorSeconds.toFixed(1)} 秒）`,
    target: `≥ 示范的 ${percentText(CONFIG.hold.fullRatio)}`,
    score: ratio === null ? null : rampScore(ratio, CONFIG.hold.zeroRatio, CONFIG.hold.fullRatio),
    nominalWeight: CONFIG.weights.hold,
    evaluated: true,
  }
}

function stabilityMetric(mode: YijinjingMode, jitter: number | null, drift: number | null): MetricDraft {
  const jitterScore = jitter === null ? null : rampScore(jitter, CONFIG.stability.zeroJitter, CONFIG.stability.fullJitter)
  const swayScore = drift === null ? null : rampScore(drift, CONFIG.stability.zeroSway, CONFIG.stability.fullSway)
  const parts = finite([jitterScore, swayScore])
  const score = parts.length ? Math.round(mean(parts) as number) : null
  const display = jitter === null && drift === null
    ? '动作数据不足'
    : [jitter === null ? null : `抖动 ${jitter.toFixed(3)}`, drift === null ? null : `晃动 ${drift.toFixed(3)}`].filter(Boolean).join('，') + ' 躯干长'
  return {
    id: 'stability',
    label: mode === 'hold' ? '稳定性（抖动与晃动）' : '稳定性（动作中的抖动）',
    value: jitter === null ? null : round(jitter, 4),
    unit: '躯干长',
    display,
    target: mode === 'hold' ? `抖动 ≤ ${CONFIG.stability.fullJitter}、晃动 ≤ ${CONFIG.stability.fullSway} 躯干长` : `抖动 ≤ ${CONFIG.stability.fullJitter} 躯干长`,
    score,
    nominalWeight: CONFIG.weights.stability,
    evaluated: true,
  }
}

function feedbackFor(metric: MetricResult, step: YijinjingStep, evaluation: YijinjingEvaluation): AnalyzerFeedbackItem | null {
  if (metric.score === null) return null
  const good = metric.score >= 100
  switch (metric.id) {
    case 'pose':
      return good
        ? { metricId: metric.id, tone: 'success', message: evaluation.mode === 'hold' ? `定势到位（${metric.display}）` : `姿态与示范一致（${metric.display}）` }
        : { metricId: metric.id, tone: 'warning', message: `${metric.display}，${step.cue}` }
    case 'hold':
      return good
        ? { metricId: metric.id, tone: 'success', message: `保持充分（${metric.display}）` }
        : { metricId: metric.id, tone: 'warning', message: `${metric.display}，到位后多停一会儿${evaluation.holdSeconds !== null && evaluation.demonstratorHoldSeconds !== null ? `，还差约 ${secondsText(Math.max(0, evaluation.demonstratorHoldSeconds - evaluation.holdSeconds))}` : ''}` }
    case 'stability':
      return good
        ? { metricId: metric.id, tone: 'success', message: `${YIJINJING_MODE_LABEL[evaluation.mode]}的势做得平稳` }
        : { metricId: metric.id, tone: 'warning', message: `${metric.display}，${step.cue}` }
    default:
      return null
  }
}
