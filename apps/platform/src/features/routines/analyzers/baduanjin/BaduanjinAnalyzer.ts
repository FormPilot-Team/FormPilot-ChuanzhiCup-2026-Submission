import type { ReferenceTrack } from '../../followAlong/referenceTrack'
import type { RoutineChapter, RoutineProgram } from '../../types'
import { referenceSamples } from '../reference'
import { combineMetrics, continuousRuns, mean, movingAverage, percentile, rampScore, round, type MetricDraft } from '../signal'
import type { AnalyzerContext, AnalyzerEvaluation, AnalyzerFeedbackItem, AnalyzerPose, AnalyzerReportMetrics, AnalyzerSample, RoutineAnalyzer } from '../types'
import { BADUANJIN_ANALYZER_CONFIG as CONFIG } from './config'
import { baduanjinFeatures, type BaduanjinFeatures } from './features'
import { BADUANJIN_STEPS, type BaduanjinStep, type BaduanjinTrajectory } from './steps'

/** One movement of the demonstrator (托举 / 开弓 …), in video seconds; excursion in torso lengths. */
export interface Repetition {
  onset: number
  peakAt: number
  offset: number
  excursion: number
}

export interface BaduanjinChapterReference {
  base: number
  top: number
  repetitions: Repetition[]
}

export interface BaduanjinEvaluation extends AnalyzerEvaluation {
  trajectory: BaduanjinTrajectory
  /** False for 攒拳怒目增气力: the punch is only detected, its amplitude is not judged (未评估幅度). */
  amplitudeEvaluated: boolean
  /** Demonstrator repetitions whose time span the samples covered. */
  observedRepetitions: number
  expectedRepetitions: number
  /** Mean user excursion / demonstrator excursion over the observed repetitions. */
  amplitudeRatio: number | null
}

interface TrajectoryPoint {
  at: number
  videoSeconds: number
  value: number
}

/** Scaled, lightly smoothed trajectory; smoothing never crosses a gap. */
function trajectoryPoints(samples: ReadonlyArray<AnalyzerSample<BaduanjinFeatures>>, scale: number): TrajectoryPoint[] {
  const usable = samples.filter((sample) => sample.features?.trajectory !== null && sample.features?.trajectory !== undefined)
  const points: TrajectoryPoint[] = []
  for (const run of continuousRuns(usable, CONFIG.maxGapMs)) {
    const smooth = movingAverage(run.map((sample) => (sample.features as BaduanjinFeatures).trajectory as number / scale), CONFIG.smoothHalfWidth)
    run.forEach((sample, index) => points.push({ at: sample.at, videoSeconds: sample.videoSeconds, value: smooth[index] }))
  }
  return points
}

function robustScale(samples: ReadonlyArray<AnalyzerSample<BaduanjinFeatures>>): number | null {
  const torsos = samples.flatMap((sample) => (sample.features ? [sample.features.torso] : []))
  const scale = percentile(torsos, CONFIG.scalePercentile)
  return scale !== null && scale > 0 ? scale : null
}

/** The demonstrator's repetitions: stretches above a share of the chapter's own range (see config). */
export function findRepetitions(points: ReadonlyArray<TrajectoryPoint>, chapter: RoutineChapter): BaduanjinChapterReference | null {
  const values = points.map((point) => point.value)
  const base = percentile(values, CONFIG.repetition.basePercentile)
  const top = percentile(values, CONFIG.repetition.topPercentile)
  if (base === null || top === null || !(top > base)) return null
  const level = base + CONFIG.repetition.levelShare * (top - base)
  const repetitions: Repetition[] = []
  let start = -1
  for (let index = 0; index <= points.length; index += 1) {
    if (index < points.length && points[index].value >= level) {
      if (start < 0) start = index
      continue
    }
    if (start < 0) continue
    const end = index - 1
    start = start < 0 ? index : start
    const first = points[start]
    const last = points[end]
    let peak = first
    for (let item = start; item <= end; item += 1) if (points[item].value > peak.value) peak = points[item]
    if (last.videoSeconds - first.videoSeconds >= CONFIG.repetition.minSeconds && first.videoSeconds - chapter.startSeconds >= CONFIG.repetition.startMarginSeconds) {
      repetitions.push({ onset: first.videoSeconds, peakAt: peak.videoSeconds, offset: last.videoSeconds, excursion: peak.value - base })
    }
    start = -1
  }
  return { base, top, repetitions }
}

function percentText(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/**
 * 八段锦到位度: does each movement reach the position the demonstrator reaches, repetition by repetition? The
 * demonstrator's repetitions are found once in the standard video's pose track (the video is the clock); the
 * user's peak inside each repetition's time span is compared with the demonstrator's.
 */
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
      const reference = scale ? findRepetitions(trajectoryPoints(samples, scale), chapter) : null
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
    const usable = samples.filter((sample) => sample.features?.trajectory !== null && sample.features?.trajectory !== undefined)
    if (usable.length < CONFIG.minSamples) return null
    const scale = robustScale(usable)
    if (!scale) return null
    const points = trajectoryPoints(usable, scale)
    const userBase = percentile(points.map((point) => point.value), CONFIG.repetition.basePercentile) as number

    const ratios: number[] = []
    for (const repetition of reference.repetitions) {
      const from = repetition.onset - CONFIG.repetition.leadSeconds
      const to = repetition.offset + CONFIG.repetition.lagSeconds
      const inside = points.filter((point) => point.videoSeconds >= from && point.videoSeconds <= to)
      // Only repetitions whose rise and peak were both followed count.
      if (inside.length < 5 || inside[0].videoSeconds > repetition.onset || inside[inside.length - 1].videoSeconds < repetition.peakAt) continue
      const peak = Math.max(...inside.map((point) => point.value))
      ratios.push(Math.min(1.5, Math.max(0, (peak - userBase) / repetition.excursion)))
    }
    const amplitudeRatio = mean(ratios)
    const amplitudeEvaluated = step.amplitude !== 'phase-only'
    const drafts: MetricDraft[] = [amplitudeMetric(step, amplitudeRatio, amplitudeEvaluated)]
    const { score, metrics } = combineMetrics(drafts)
    return {
      score,
      metrics,
      usableSamples: usable.length,
      trajectory: step.trajectory,
      amplitudeEvaluated,
      observedRepetitions: ratios.length,
      expectedRepetitions: reference.repetitions.length,
      amplitudeRatio: amplitudeRatio === null ? null : round(amplitudeRatio, 3),
    }
  }

  buildFeedback(evaluation: BaduanjinEvaluation, chapter: RoutineChapter): AnalyzerFeedbackItem[] {
    const step = BADUANJIN_STEPS[chapter.id] as BaduanjinStep
    const items: AnalyzerFeedbackItem[] = []
    const amplitude = evaluation.metrics.find((metric) => metric.id === 'amplitude' || metric.id === 'heelRiseProxy')
    if (amplitude?.evaluated && amplitude.score !== null && evaluation.amplitudeRatio !== null) {
      items.push(amplitude.score >= 100
        ? { metricId: amplitude.id, tone: 'success', message: `幅度到位：${step.label}达到示范的 ${percentText(evaluation.amplitudeRatio)}` }
        : { metricId: amplitude.id, tone: 'warning', message: `${step.label}只达到示范的 ${percentText(evaluation.amplitudeRatio)}，${step.cue}` })
    }
    return items
  }

  buildReportMetrics(chapters: ReadonlyArray<{ chapter: RoutineChapter; evaluation: BaduanjinEvaluation | null }>): AnalyzerReportMetrics {
    const scored = chapters.flatMap(({ evaluation }) => (evaluation?.score !== null && evaluation?.score !== undefined ? [evaluation.score] : []))
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
        '到位度按示范视频逐次比较：在示范者每一次托举、开弓等动作的时间段内，取你的最大幅度与示范者的幅度之比。',
        '幅度是二维画面中的投影值，以躯干长为单位；阈值为暂定值，尚未用真人数据标定。',
      ],
      extras: {},
    }
  }
}

function amplitudeMetric(step: BaduanjinStep, ratio: number | null, evaluated: boolean): MetricDraft {
  const proxy = step.amplitude === 'proxy'
  return {
    id: step.trajectory === 'heelRiseProxy' ? 'heelRiseProxy' : 'amplitude',
    label: proxy ? `${step.label}` : `幅度到位：${step.label}`,
    value: ratio === null ? null : round(ratio, 3),
    unit: '示范倍数',
    display: !evaluated ? '未评估幅度' : ratio === null ? '未观测到完整动作' : `示范的 ${percentText(ratio)}${proxy ? '（近似）' : ''}`,
    target: `≥ 示范的 ${percentText(CONFIG.amplitude.fullRatio)}`,
    score: evaluated && ratio !== null ? rampScore(ratio, CONFIG.amplitude.zeroRatio, CONFIG.amplitude.fullRatio) : null,
    nominalWeight: CONFIG.weights.amplitude[step.amplitude],
    evaluated,
    note: step.note,
  }
}
