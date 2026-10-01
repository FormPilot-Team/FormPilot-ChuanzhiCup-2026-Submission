import type { ReferenceTrack } from '../followAlong/referenceTrack'
import type { RoutineChapter } from '../types'
import type { AnalyzerContext, AnalyzerPose, AnalyzerSample } from './types'

/** 与跟练比对的参考帧门槛一致 */
export const MIN_REFERENCE_CONFIDENCE = 0.5

/** 示范者在一章内的特征序列，用分析器自己的 extractFeatures 提取，保证与用户同一测法；视频按原速播放，墙钟即视频时间 */
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

/** 离 seconds 最近的轨迹帧（轨迹按时间排序，二分查找） */
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
