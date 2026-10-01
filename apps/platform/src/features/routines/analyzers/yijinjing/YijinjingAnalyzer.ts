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
  /** The step from the previous sample (same continuous run) was still. */
  still: boolean
  /** Time of the previous sample of the same run (the start of this sample's step), or null for a run's first sample. */
  stepFrom: number | null
  stepFromVideo: number | null
  /** Shaking at this sample: RMS over the six points of their residual around a short average (torso lengths). */
  jitter: number | null
  /** Shoulder and hip centres (scaled), for sway. */
  centre: { x: number; y: number } | null
  targetSimilarity: number | null
}

export interface StillStretch {
  /** Video seconds of the first and last still sample. */
  from: number
  to: number
  durationMs: number
}

export interface YijinjingChapterReference {
  /** The demonstrator's longest still stretch in the 势. */
  still: StillStretch
  /** Target pose: the demonstrator's frame at the middle of that stretch (holds only). */
  target: PoseDescriptor | null
  targetAt: number | null
}

export interface YijinjingEvaluation extends AnalyzerEvaluation {
  mode: YijinjingMode
  /** Mean target similarity in the hold window (holds) or mean follow-along similarity (transitions). */
  pose: number | null
  /** Longest still-and-in-pose stretch / the demonstrator's still stretch (holds). */
  holdRatio: number | null
  holdSeconds: number | null
  demonstratorHoldSeconds: number | null
  jitter: number | null
  /** Holds only: drift of the shoulder and hip centres while in the pose. */
  sway: number | null
}

function robustScale(samples: ReadonlyArray<AnalyzerSample<YijinjingFeatures>>): number | null {
  const scale = percentile(samples.flatMap((sample) => (sample.features ? [sample.features.torso] : [])), CONFIG.scalePercentile)
  return scale !== null && scale > 0 ? scale : null
}

/** Per-sample stillness, jitter and centre position; speeds and residuals never cross a gap. */
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
      // Shoulders and hips are pairs 2–5 of the six points.
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

/** Longest stretch of consecutive still steps, from the start of its first step to the end of its last. */
export function longestStill(points: ReadonlyArray<FramePoint>): StillStretch | null {
  let best: StillStretch | null = null
  let start = -1
  for (let index = 0; index <= points.length; index += 1) {
    // A still step always continues the run of the previous one (framePoints never marks a run's first sample still).
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

/** The mode rule of steps.ts: holds for 预备势 / 收势, else a demonstrator still stretch of at least holdMinMs. */
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

/**
 * 易筋经稳定性: holding each 势 steadily. Holds (保持类) are compared with the demonstrator's longest still stretch:
 * how close the pose comes to the demonstrator's pose at its middle (目标姿态), how long the user stays still in it
 * (保持完成度) and how much the body shakes or drifts meanwhile (稳定性). Transitions (过渡类) are judged on the
 * follow-along similarity and on shaking only (姿态 0.40 + 稳定性 0.35, renormalised).
 */
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
    // Compare with the part of the demonstrator's hold that the samples cover (the live window may hold only part of it).
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
    // Shaking and drift are read while the user is in the pose (the longest in-pose stretch).
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
