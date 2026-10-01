import { readFileSync } from 'node:fs'
import { RoutineFeedbackPolicy } from '../../src/features/routines/followAlong/feedbackPolicy'
import { liveChecks, type LiveCheck } from '../../src/features/routines/followAlong/liveChecks'
import { FOLLOW_ALONG_CONFIG, FollowAlongMatcher, type FollowAlongMatch } from '../../src/features/routines/followAlong/matcher'
import { parseReferenceTrack, type ReferenceFrame, type ReferencePoint, type ReferenceTrack } from '../../src/features/routines/followAlong/referenceTrack'
import { getRoutineProgram } from '../../src/features/routines/programs'
import { chapterAt, scopeChapters } from '../../src/features/routines/scope'
import { RoutineProgressRecorder } from '../../src/features/routines/session/RoutineProgressRecorder'
import type { RoutineSessionRecord } from '../../src/features/routines/session/types'
import type { RoutineId, RoutineProgram, RoutineScope } from '../../src/features/routines/types'
import { RoutineTechniqueEvaluator } from '../../src/features/scoring/routine/RoutineTechniqueEvaluator'

/**
 * Replays the follow-along pipeline of `useRoutineRuntime` without React, a camera or a video element: one comparison
 * tick per 0.1 s of video, the user's pose taken from the standard video's own pose track (optionally late, mirrored,
 * noisy, altered or partly missing). Used by the baseline snapshot regression and the analyzers' self-checks.
 */

export const ROUTINE_IDS: ReadonlyArray<RoutineId> = ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']

const tracks = new Map<RoutineId, ReferenceTrack>()

export function standardTrack(id: RoutineId): ReferenceTrack {
  let loaded = tracks.get(id)
  if (!loaded) {
    loaded = parseReferenceTrack(JSON.parse(readFileSync(`public/assets/routines/${id}-standard.pose.json`, 'utf8'))) as ReferenceTrack
    tracks.set(id, loaded)
  }
  return loaded
}

/** Seeded PRNG (mulberry32), so "random" perturbations are identical on every run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const MIRROR_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
]

export function mirrorLandmarks(landmarks: ReadonlyArray<ReferencePoint>): ReferencePoint[] {
  const next = landmarks.map((point) => ({ ...point, x: 1 - point.x }))
  for (const [left, right] of MIRROR_PAIRS) [next[left], next[right]] = [next[right], next[left]]
  return next
}

/** Gaussian-ish noise (sum of uniforms) of standard deviation `sigma`, in normalised image units, on every landmark. */
export function noisyLandmarks(sigma: number, seed: number): (landmarks: ReadonlyArray<ReferencePoint>) => ReferencePoint[] {
  const random = seededRandom(seed)
  const gauss = () => (random() + random() + random() + random() - 2) * Math.sqrt(3)
  return (landmarks) => landmarks.map((point) => ({ ...point, x: point.x + gauss() * sigma, y: point.y + gauss() * sigma }))
}

/** Bends both elbows by rotating each wrist about its elbow towards the shoulder (in true image proportions). */
export function bentElbows(degrees: number, aspect: number): (landmarks: ReadonlyArray<ReferencePoint>) => ReferencePoint[] {
  const elbowAngle = (s: ReferencePoint, e: ReferencePoint, w: ReferencePoint) => {
    const ax = (s.x - e.x) * aspect
    const ay = s.y - e.y
    const bx = (w.x - e.x) * aspect
    const by = w.y - e.y
    return Math.acos((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by)))
  }
  return (landmarks) => {
    const next = landmarks.map((point) => ({ ...point }))
    for (const [shoulder, elbow, wrist] of [[11, 13, 15], [12, 14, 16]] as const) {
      const e = next[elbow]
      const w = next[wrist]
      const candidates = [1, -1].map((sign) => {
        const radians = (sign * degrees * Math.PI) / 180
        const dx = (w.x - e.x) * aspect
        const dy = w.y - e.y
        const rotated = { ...w, x: e.x + (dx * Math.cos(radians) - dy * Math.sin(radians)) / aspect, y: e.y + dx * Math.sin(radians) + dy * Math.cos(radians) }
        return { rotated, angle: elbowAngle(next[shoulder], e, rotated) }
      })
      next[wrist] = candidates[0].angle <= candidates[1].angle ? candidates[0].rotated : candidates[1].rotated
    }
    return next
  }
}

export interface ReplayUserPose {
  landmarks: ReadonlyArray<ReferencePoint>
  confidence: number
  aspect: number
}

export interface ReplayTick {
  index: number
  /** Video time of the comparison, seconds. */
  videoSeconds: number
  /** Wall-clock time of the comparison, ms. */
  now: number
  pose: ReplayUserPose
  match: FollowAlongMatch
}

export interface ReplayOptions {
  scope?: RoutineScope
  /** The user's pose at video time v is the demonstrator's pose at v − lagSeconds. */
  lagSeconds?: number
  /** Alters the user's landmarks (index = tick index, for deterministic drops or noise). */
  transform?: (landmarks: ReadonlyArray<ReferencePoint>, videoSeconds: number, index: number) => ReadonlyArray<ReferencePoint>
  /** The user's pose instead of the demonstrator's (synthetic sequences); null = no pose this tick. */
  userPose?: (videoSeconds: number) => ReadonlyArray<ReferencePoint> | null
  /** Ticks with no detected pose at all (camera dropouts); the runtime makes no comparison then. */
  dropped?: (videoSeconds: number, index: number) => boolean
  /** Called after the built-in pipeline on every comparison tick. */
  onTick?: (tick: ReplayTick) => void
}

export interface FeedbackRun {
  code: string
  tone: string
  message: string
  ticks: number
}

export interface ReplayResult {
  program: RoutineProgram
  scope: RoutineScope
  record: RoutineSessionRecord
  feedback: FeedbackRun[]
  spoken: Array<{ tick: number; id: string; text: string }>
  /** 动作规范检查 as shown on the training page at each chapter's midpoint. */
  liveChecks: Array<{ chapterId: string; checks: LiveCheck[] }>
  ticks: number
}

function nearestFrame(track: ReferenceTrack, seconds: number): ReferenceFrame | undefined {
  const frames = track.frames
  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (frames[middle].t < seconds) low = middle + 1
    else high = middle
  }
  return [frames[low], frames[low - 1]].filter(Boolean).sort((a, b) => Math.abs(a.t - seconds) - Math.abs(b.t - seconds))[0]
}

const TICK_SECONDS = 0.1
/** Arbitrary but fixed wall-clock origin, so `now` never starts at zero. */
const CLOCK_ORIGIN_MS = 1_000_000

export function replayRoutine(id: RoutineId, options: ReplayOptions = {}): ReplayResult {
  const program = getRoutineProgram(id)
  const scope = options.scope ?? { kind: 'full' }
  const track = standardTrack(id)
  const aspect = track.width / track.height
  const chapters = scopeChapters(program, scope)
  const start = chapters[0].startSeconds
  const end = chapters[chapters.length - 1].endSeconds

  const matcher = new FollowAlongMatcher(track)
  const technique = new RoutineTechniqueEvaluator(program, scope, track)
  const recorder = new RoutineProgressRecorder(program, scope)
  const policy = new RoutineFeedbackPolicy()
  const feedback: FeedbackRun[] = []
  const spoken: ReplayResult['spoken'] = []
  const checks: ReplayResult['liveChecks'] = []
  const midpoints = chapters.map((chapter) => ({ chapter, at: (chapter.startSeconds + chapter.endSeconds) / 2, done: false }))

  let chapterId = chapterAt(program, start).id
  let lastVideo = start
  let lastMatch: FollowAlongMatch | undefined
  let index = 0
  for (let video = start; video < end; index += 1, video = Number((start + index * TICK_SECONDS).toFixed(2))) {
    const now = CLOCK_ORIGIN_MS + index * TICK_SECONDS * 1000
    recorder.markPlayback(lastVideo, video, 3)
    lastVideo = video
    const chapter = chapterAt(program, video)
    if (chapter.id !== chapterId) {
      chapterId = chapter.id
      policy.reset()
    }
    for (const midpoint of midpoints) {
      if (midpoint.done || video < midpoint.at) continue
      midpoint.done = true
      checks.push({
        chapterId: midpoint.chapter.id,
        checks: liveChecks({ routine: id, chapter: midpoint.chapter, record: technique.snapshot(), videoSeconds: video, match: lastMatch, following: true, comparisonAvailable: true }),
      })
    }
    if (options.dropped?.(video, index)) continue
    let landmarks: ReadonlyArray<ReferencePoint> | null
    let confidence = 0.95
    if (options.userPose) landmarks = options.userPose(video)
    else {
      const frame = nearestFrame(track, video - (options.lagSeconds ?? 0))
      landmarks = frame && frame.confidence > 0 && frame.landmarks.length ? frame.landmarks : null
      confidence = frame?.confidence ?? 0
    }
    if (!landmarks) continue
    if (options.transform) landmarks = options.transform(landmarks, video, index)
    const pose = { landmarks, confidence, aspect }
    const match = matcher.evaluate(pose, video, now)
    lastMatch = match
    recorder.recordComparison(video, match)
    technique.observe(video, pose)
    const update = policy.update(match, now, chapter.cue)
    const previous = feedback.at(-1)
    if (previous && previous.code === update.feedback.code && previous.message === update.feedback.message && previous.tone === update.feedback.tone) previous.ticks += 1
    else feedback.push({ ...update.feedback, ticks: 1 })
    if (update.speak) spoken.push({ tick: index, ...update.speak })
    options.onTick?.({ index, videoSeconds: video, now, pose, match })
  }

  const startedAt = Date.UTC(2026, 9, 1, 8)
  const record: RoutineSessionRecord = {
    schemaVersion: 1,
    kind: 'routine',
    id: `replay-${id}`,
    programId: id,
    programVersion: program.version,
    scope,
    source: 'live',
    mode: 'normal',
    matcher: { version: FOLLOW_ALONG_CONFIG.version, available: true },
    startedAt,
    endedAt: startedAt + Math.round((end - start) * 1000),
    activeMs: Math.round((end - start) * 1000),
    outcome: 'completed',
    chapters: recorder.snapshot(),
    technique: technique.snapshot(),
  }
  return { program, scope, record, feedback, spoken, liveChecks: checks, ticks: index }
}
