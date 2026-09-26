import type { FollowAlongMatch, FollowAlongRegion } from '../followAlong/matcher'
import type { RoutineChapter, RoutineProgram, RoutineScope } from '../types'
import { chapterAt, scopeChapters } from '../scope'
import type { RoutineChapterResult } from './types'

const REGIONS: ReadonlyArray<FollowAlongRegion> = ['arms', 'torso', 'legs']

/** Whole seconds whose midpoint lies inside the chapter; boundaries shared by two chapters go to exactly one. */
function chapterBuckets(chapter: RoutineChapter): number[] {
  const buckets: number[] = []
  for (let second = Math.floor(chapter.startSeconds); second < Math.ceil(chapter.endSeconds); second += 1) {
    const middle = second + 0.5
    if (middle >= chapter.startSeconds && middle < chapter.endSeconds) buckets.push(second)
  }
  return buckets
}

function emptyResult(chapter: RoutineChapter, totalSeconds: number): RoutineChapterResult {
  return {
    chapterId: chapter.id,
    totalSeconds,
    coveredSeconds: 0,
    samples: 0,
    insufficientSamples: 0,
    similaritySum: 0,
    regionSums: { arms: 0, torso: 0, legs: 0 },
    regionSamples: { arms: 0, torso: 0, legs: 0 },
    statusCounts: { in_sync: 0, ahead: 0, behind: 0, mismatch: 0 },
    mirroredSamples: 0,
  }
}

/**
 * Accumulates what happened in each chapter of the scope: which seconds of the standard video were actually
 * followed (coverage survives pauses, jumps and repeats) and the follow-along comparisons made meanwhile.
 */
export class RoutineProgressRecorder {
  private readonly chapters: ReadonlyArray<RoutineChapter>
  private readonly buckets = new Map<string, ReadonlySet<number>>()
  private readonly covered = new Set<number>()
  private readonly results = new Map<string, RoutineChapterResult>()

  constructor(private readonly program: RoutineProgram, scope: RoutineScope) {
    this.chapters = scopeChapters(program, scope)
    for (const chapter of this.chapters) {
      const buckets = chapterBuckets(chapter)
      this.buckets.set(chapter.id, new Set(buckets))
      this.results.set(chapter.id, emptyResult(chapter, buckets.length))
    }
  }

  /**
   * Marks the video seconds played between two consecutive observations. A backwards step or a step longer
   * than `maxContinuousStepSeconds` is a seek, so only the landing second is marked.
   */
  markPlayback(fromSeconds: number, toSeconds: number, maxContinuousStepSeconds = 3): void {
    if (!Number.isFinite(toSeconds)) return
    const continuous = Number.isFinite(fromSeconds) && toSeconds >= fromSeconds && toSeconds - fromSeconds <= maxContinuousStepSeconds
    const first = continuous ? Math.floor(fromSeconds) : Math.floor(toSeconds)
    for (let second = first; second <= Math.floor(toSeconds); second += 1) this.covered.add(second)
  }

  /** Records one comparison made while the video was at `videoSeconds`. */
  recordComparison(videoSeconds: number, match: FollowAlongMatch): void {
    const chapter = chapterAt(this.program, videoSeconds)
    const result = this.results.get(chapter.id)
    if (!result) return
    if (match.status === 'insufficient') {
      result.insufficientSamples += 1
      return
    }
    result.samples += 1
    result.similaritySum += match.similarity
    result.statusCounts[match.status] += 1
    if (match.mirrored) result.mirroredSamples += 1
    for (const region of REGIONS) {
      const score = match.regionScores[region]
      if (score === null) continue
      result.regionSums[region] += score
      result.regionSamples[region] += 1
    }
  }

  /** Seconds of the scope followed so far. */
  coveredSeconds(): number {
    let total = 0
    for (const chapter of this.chapters) total += this.chapterCoverage(chapter.id)
    return total
  }

  snapshot(): RoutineChapterResult[] {
    return this.chapters.map((chapter) => {
      const result = this.results.get(chapter.id) as RoutineChapterResult
      return structuredClone({ ...result, coveredSeconds: this.chapterCoverage(chapter.id) })
    })
  }

  private chapterCoverage(chapterId: string): number {
    const buckets = this.buckets.get(chapterId)
    if (!buckets) return 0
    let count = 0
    for (const second of buckets) if (this.covered.has(second)) count += 1
    return count
  }
}
