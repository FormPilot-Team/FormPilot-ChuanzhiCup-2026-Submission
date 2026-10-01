import type { ReferenceTrack } from '../followAlong/referenceTrack'
import type { RoutineChapter } from '../types'
import type { AnalyzerContext, AnalyzerPose, AnalyzerSample } from './types'

/** Same rule as the matcher's reference frames. */
export const MIN_REFERENCE_CONFIDENCE = 0.5

/**
 * The demonstrator's own feature sequence for one chapter, taken from the standard video's pose track with the
 * analyzer's own `extractFeatures` (so the user and the demonstrator are measured the same way). Wall-clock time is
 * the video time: the standard video plays at normal speed.
 */
export function referenceSamples<F>(
  track: ReferenceTrack,
  chapter: RoutineChapter,
  extract: (pose: AnalyzerPose, context: AnalyzerContext) => F | null,
): Array<AnalyzerSample<F>> {
  const aspect = track.width / track.height
  const samples: Array<AnalyzerSample<F>> = []
  for (const frame of track.frames) {
    if (frame.t < chapter.startSeconds || frame.t >= chapter.endSeconds) continue
    const usable = frame.confidence >= MIN_REFERENCE_CONFIDENCE && frame.landmarks.length > 0
    const features = usable ? extract({ landmarks: frame.landmarks, confidence: frame.confidence, aspect }, { chapter, videoSeconds: frame.t }) : null
    samples.push({ at: Math.round(frame.t * 1000), videoSeconds: frame.t, features })
  }
  return samples
}

/** The track frame nearest to `seconds` (binary search; tracks are sorted by time). */
export function nearestTrackFrame(track: ReferenceTrack, seconds: number) {
  const frames = track.frames
  if (!frames.length) return undefined
  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (frames[middle].t < seconds) low = middle + 1
    else high = middle
  }
  const before = frames[low - 1]
  return before && Math.abs(before.t - seconds) < Math.abs(frames[low].t - seconds) ? before : frames[low]
}
