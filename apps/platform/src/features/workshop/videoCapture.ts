import type { LandmarkName } from '../pose/types'
import { averageLandmarks } from './recognition/capture'
import { MIN_VISIBILITY, isUsable, landmark } from './recognition/geometry'
import { WorkshopPoseDetector } from './detector'
import { inferContinuousSuggestion, type ContinuousSuggestion, type VideoPoseSample } from './recognition/continuous'
import type { CapturedPose } from './types'

const SAMPLE_INTERVAL_SECONDS = 0.05
const SAMPLE_COUNT = 5
export function videoFileProblem(file: Pick<File, 'size'>): string | null {
  if (file.size === 0) return '这个文件是空的，请重新选择视频。'
  return null
}

export function videoFrameProblem(start: number, duration: number): string | null {
  if (!Number.isFinite(duration) || duration <= 0) return '无法读取视频时长，请换一个文件或先转换为 MP4。'
  if (!Number.isFinite(start) || start < 0 || start >= duration) return '请在视频有效画面内选择一个姿势。'
  return null
}

function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - seconds) < 0.001 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve()
      return
    }
    const cleanup = () => {
      window.clearTimeout(timeout)
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', failed)
    }
    const done = () => { cleanup(); resolve() }
    const failed = () => { cleanup(); reject(new Error('视频解码失败，请换一个文件或先转换为 MP4。')) }
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('视频定位超时，请换一个文件或先裁剪视频。')) }, 8000)
    video.addEventListener('seeked', done, { once: true })
    video.addEventListener('error', failed, { once: true })
    video.currentTime = seconds
  })
}

/** Picks the clearest pose near the selected frame; raw video never enters storage. */
export async function capturePoseFromVideo(video: HTMLVideoElement, required: ReadonlyArray<LandmarkName>,
  createDetector: () => WorkshopPoseDetector = () => new WorkshopPoseDetector()): Promise<CapturedPose> {
  const start = video.currentTime
  const problem = videoFrameProblem(start, video.duration)
  if (problem) throw new Error(problem)
  video.pause()
  const aspect = video.videoWidth / video.videoHeight
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('无法读取视频画面，请换一个视频。')
  const detector = createDetector()
  try {
    await detector.initialize()
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const seconds = Math.min(video.duration - 0.001, start + index * SAMPLE_INTERVAL_SECONDS)
      await seekTo(video, seconds)
      const frame = detector.detect(video, performance.now())
      if (frame && required.every((name) => isUsable(landmark(frame.landmarks, name), MIN_VISIBILITY))) {
        return { landmarks: averageLandmarks([frame.landmarks]), aspect, frames: 1, capturedAt: new Date().toISOString() }
      }
    }
    throw new Error('当前画面附近未能完整识别身体关键点。请选一个清晰、完整入镜的画面。')
  } finally {
    detector.close()
  }
}

/** Scans at most eight seconds of a local video; only MediaPipe landmarks enter the proposal. */
export async function captureContinuousVideo(video: HTMLVideoElement, required: ReadonlyArray<LandmarkName>,
  onProgress: (done: number, total: number) => void, isCurrent: () => boolean,
  createDetector: () => WorkshopPoseDetector = () => new WorkshopPoseDetector()): Promise<ContinuousSuggestion> {
  const start = video.currentTime
  const problem = videoFrameProblem(start, video.duration)
  if (problem) throw new Error(problem)
  const aspect = video.videoWidth / video.videoHeight
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('无法读取视频画面。')
  video.pause()
  const total = Math.min(81, Math.floor((video.duration - start - 0.001) * 10) + 1)
  if (total < 8) throw new Error('剩余视频太短，请把进度条移到完整动作开始前。')
  const samples: VideoPoseSample[] = []
  const detector = createDetector()
  try {
    await detector.initialize()
    for (let index = 0; index < total; index += 1) {
      if (!isCurrent()) throw new Error('分析已取消。')
      await seekTo(video, Math.min(video.duration - 0.001, start + index * 0.1))
      const frame = detector.detect(video, performance.now() + index)
      if (frame && required.every((name) => isUsable(landmark(frame.landmarks, name), MIN_VISIBILITY))) {
        samples.push({ seconds: video.currentTime, landmarks: frame.landmarks })
      }
      onProgress(index + 1, total)
    }
    if (!samples.length || samples[0].seconds - start > 0.35) throw new Error('开头没有看清身体，请从准备姿势开始拍摄。')
    return inferContinuousSuggestion(samples, aspect)
  } finally {
    detector.close()
  }
}
