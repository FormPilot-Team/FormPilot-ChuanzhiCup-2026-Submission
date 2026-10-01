import { ANALYZER_SELF_CHECK } from '../../src/features/routines/analyzers/selfCheckConfig'
import type { AnalyzerEvaluation } from '../../src/features/routines/analyzers/types'
import type { ReferencePoint } from '../../src/features/routines/followAlong/referenceTrack'
import { getRoutineProgram } from '../../src/features/routines/programs'
import { chapterAt } from '../../src/features/routines/scope'
import type { RoutineId, RoutineScope } from '../../src/features/routines/types'
import { replayRoutine, seededRandom, standardTrack, type ReplayOptions } from './routineReplay'

/**
 * The analyzers' self-check: the demonstrator follows their own standard video (identity replay), then the same
 * sequence with noise, with movements shrunk to 0.6 × and with late, stop-and-go timing. Parameters live in
 * ANALYZER_SELF_CHECK (src) so the report can quote them.
 */

export type SelfCheckCase = 'demonstrator' | 'noise' | 'amplitude' | 'timing'
export const SELF_CHECK_CASES: ReadonlyArray<SelfCheckCase> = ['demonstrator', 'noise', 'amplitude', 'timing']

const HIP_LEFT = 23
const HIP_RIGHT = 24

function torsoLength(landmarks: ReadonlyArray<ReferencePoint>, aspect: number): number {
  const sx = ((landmarks[11].x + landmarks[12].x) / 2) * aspect
  const sy = (landmarks[11].y + landmarks[12].y) / 2
  const hx = ((landmarks[23].x + landmarks[24].x) / 2) * aspect
  const hy = (landmarks[23].y + landmarks[24].y) / 2
  return Math.hypot(sx - hx, sy - hy)
}

/** Isotropic Gaussian noise of `sigmaTorso` torso lengths on every landmark (seeded). */
function noiseTransform(id: RoutineId): ReplayOptions['transform'] {
  const { sigmaTorso, seed } = ANALYZER_SELF_CHECK.perturbations.noise
  const aspect = standardTrack(id).width / standardTrack(id).height
  const random = seededRandom(seed)
  const gauss = () => (random() + random() + random() + random() - 2) * Math.sqrt(3)
  return (landmarks) => {
    const sigma = sigmaTorso * torsoLength(landmarks, aspect)
    return landmarks.map((point) => ({ ...point, x: point.x + (gauss() * sigma) / aspect, y: point.y + gauss() * sigma }))
  }
}

interface ChapterMean {
  hip: { x: number; y: number }
  relative: Array<{ x: number; y: number }>
}

/** Pulls every landmark towards the chapter's mean posture (relative to the hip centre) and the hip centre towards its mean path. */
function amplitudeTransform(id: RoutineId): ReplayOptions['transform'] {
  const { factor } = ANALYZER_SELF_CHECK.perturbations.amplitude
  const program = getRoutineProgram(id)
  const track = standardTrack(id)
  const means = new Map<string, ChapterMean>()
  for (const chapter of program.chapters) {
    const frames = track.frames.filter((frame) => frame.t >= chapter.startSeconds && frame.t < chapter.endSeconds && frame.confidence >= 0.5 && frame.landmarks.length)
    if (!frames.length) continue
    const hip = { x: 0, y: 0 }
    const relative = Array.from({ length: 33 }, () => ({ x: 0, y: 0 }))
    for (const frame of frames) {
      const hx = (frame.landmarks[HIP_LEFT].x + frame.landmarks[HIP_RIGHT].x) / 2
      const hy = (frame.landmarks[HIP_LEFT].y + frame.landmarks[HIP_RIGHT].y) / 2
      hip.x += hx / frames.length
      hip.y += hy / frames.length
      frame.landmarks.forEach((point, index) => {
        relative[index].x += (point.x - hx) / frames.length
        relative[index].y += (point.y - hy) / frames.length
      })
    }
    means.set(chapter.id, { hip, relative })
  }
  return (landmarks, videoSeconds) => {
    const mean = means.get(chapterAt(program, videoSeconds).id)
    if (!mean) return landmarks
    const hx = (landmarks[HIP_LEFT].x + landmarks[HIP_RIGHT].x) / 2
    const hy = (landmarks[HIP_LEFT].y + landmarks[HIP_RIGHT].y) / 2
    const nx = mean.hip.x + factor * (hx - mean.hip.x)
    const ny = mean.hip.y + factor * (hy - mean.hip.y)
    return landmarks.map((point, index) => ({
      ...point,
      x: nx + mean.relative[index].x + factor * (point.x - hx - mean.relative[index].x),
      y: ny + mean.relative[index].y + factor * (point.y - hy - mean.relative[index].y),
    }))
  }
}

/** Demonstrator time shown at video time v: `lagSeconds` late, standing still for the first `pauseSeconds` of every cycle. */
export function timingWarp(videoSeconds: number): number {
  const { lagSeconds, cycleSeconds, pauseSeconds } = ANALYZER_SELF_CHECK.perturbations.timing
  const cycle = Math.floor(videoSeconds / cycleSeconds) * cycleSeconds
  const into = videoSeconds - cycle
  const warped = into < pauseSeconds ? cycle : cycle + ((into - pauseSeconds) * cycleSeconds) / (cycleSeconds - pauseSeconds)
  return warped - lagSeconds
}

export function selfCheckOptions(id: RoutineId, kind: SelfCheckCase, scope: RoutineScope = { kind: 'full' }): ReplayOptions {
  if (kind === 'noise') return { scope, transform: noiseTransform(id) }
  if (kind === 'amplitude') return { scope, transform: amplitudeTransform(id) }
  if (kind === 'timing') return { scope, sourceSeconds: timingWarp }
  return { scope }
}

export interface SelfCheckRun {
  /** Chapter scores of the analyzer (null when not scored). */
  chapters: Map<string, AnalyzerEvaluation | null>
  /** Mean of the scored chapters. */
  mean: number
}

export function selfCheckRun(id: RoutineId, kind: SelfCheckCase): SelfCheckRun {
  const run = replayRoutine(id, selfCheckOptions(id, kind))
  const analysis = run.record.analysis
  if (!analysis) throw new Error(`${id} has no analyzer`)
  const chapters = new Map(analysis.chapters.map((item) => [item.chapterId, item.evaluation]))
  const scores = [...chapters.values()].flatMap((evaluation) => (evaluation?.score === null || evaluation?.score === undefined ? [] : [evaluation.score]))
  return { chapters, mean: scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length) }
}

/** Mean score of one metric over the chapters where it was scored. */
export function metricMean(run: SelfCheckRun, metricId: string): number | null {
  const scores = [...run.chapters.values()].flatMap((evaluation) => evaluation?.metrics.filter((metric) => metric.id === metricId && metric.evaluated && metric.score !== null).map((metric) => metric.score as number) ?? [])
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null
}
