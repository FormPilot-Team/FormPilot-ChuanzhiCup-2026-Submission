// Pose sources feed raw landmarks into the MotionAdapter. Only this layer knows about cameras and
// MediaPipe; the adapter turns samples into MotionFrames/MotionEvents for games.
import { BrowserCameraAdapter, cameraErrorPresentation, type CameraErrorPresentation } from './vendor/BrowserCameraAdapter'
import { PoseDetector, PoseModelError } from './vendor/PoseDetector'
import type { PoseLandmark } from './vendor/poseTypes'

export interface RawPoseSample {
  /** monotonic detection timestamp (ms) */
  timestamp: number
  /** best estimate of when the camera frame became available (ms, performance.now clock) */
  frameTime: number
  landmarks: ReadonlyArray<PoseLandmark> | null
  imageWidth: number
  imageHeight: number
  inferenceMs: number
  /** synthesized by the adapter watchdog because no camera frame arrived */
  stale?: boolean
}

export type SampleListener = (sample: RawPoseSample) => void

export interface PoseSourceInfo {
  kind: 'camera' | 'synthetic'
  delegate: string
  model: string
  cameraWidth: number | null
  cameraHeight: number | null
  cameraFrameRate: number | null
}

export interface PoseSource {
  readonly kind: 'camera' | 'synthetic'
  start(): Promise<void>
  stop(): void
  onSample(listener: SampleListener): () => void
  /** live camera stream for the mirror window; null for synthetic sources */
  stream(): MediaStream | null
  info(): PoseSourceInfo
}

export class PoseSourceError extends Error {
  constructor(readonly presentation: Pick<CameraErrorPresentation, 'message' | 'guidance'>, readonly cause?: unknown) {
    super(presentation.message)
    this.name = 'PoseSourceError'
  }
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: { captureTime?: number; presentationTime?: number; mediaTime?: number }) => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

export class CameraPoseSource implements PoseSource {
  readonly kind = 'camera' as const
  private readonly camera = new BrowserCameraAdapter()
  private readonly detector: PoseDetector
  private readonly video: FrameCallbackVideo
  private readonly listeners = new Set<SampleListener>()
  private mediaStream: MediaStream | null = null
  private running = false
  private handle = 0
  private usesFrameCallback = false
  private lastMediaTime = -1

  constructor(options: { delegate?: 'GPU' | 'CPU' } = {}) {
    this.detector = new PoseDetector({
      wasmRoot: `${import.meta.env.BASE_URL}wasm`,
      modelAssetPath: `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`,
      minConfidence: 0.5,
      delegate: options.delegate,
    })
    this.video = document.createElement('video') as FrameCallbackVideo
    this.video.muted = true
    this.video.playsInline = true
    this.video.setAttribute('aria-hidden', 'true')
    // Kept in the document (tiny, transparent) so frame callbacks are delivered reliably.
    Object.assign(this.video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' })
  }

  async start(): Promise<void> {
    if (this.running) return
    if (!this.video.isConnected) document.body.appendChild(this.video)
    try {
      await this.detector.initialize()
    } catch (error) {
      const detail = error instanceof PoseModelError ? error.details.stage : 'unknown'
      this.video.remove()
      throw new PoseSourceError({ message: '动作识别模型没有加载成功。', guidance: `请刷新页面后再试一次（${detail}）。` }, error)
    }
    try {
      this.mediaStream = await this.camera.start(this.video)
    } catch (error) {
      this.detector.close()
      this.video.remove()
      throw new PoseSourceError(cameraErrorPresentation(error), error)
    }
    this.running = true
    this.usesFrameCallback = typeof this.video.requestVideoFrameCallback === 'function'
    this.schedule()
  }

  stop(): void {
    this.running = false
    if (this.usesFrameCallback) this.video.cancelVideoFrameCallback?.(this.handle)
    else cancelAnimationFrame(this.handle)
    this.camera.stop(this.video)
    this.detector.close()
    this.mediaStream = null
    this.video.remove()
  }

  onSample(listener: SampleListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  stream(): MediaStream | null {
    return this.mediaStream
  }

  info(): PoseSourceInfo {
    const settings = this.camera.lastStart.settings
    return {
      kind: 'camera',
      delegate: this.detector.delegate ?? 'pending',
      model: 'pose_landmarker_lite',
      cameraWidth: settings?.width ?? null,
      cameraHeight: settings?.height ?? null,
      cameraFrameRate: settings?.frameRate ?? null,
    }
  }

  private schedule(): void {
    if (!this.running) return
    if (this.usesFrameCallback) {
      this.handle = this.video.requestVideoFrameCallback!((now, metadata) => {
        this.process(now, metadata.captureTime ?? metadata.presentationTime ?? now)
        this.schedule()
      })
    } else {
      this.handle = requestAnimationFrame((now) => {
        // Fallback: only process when the video actually advanced to a new frame.
        if (this.video.currentTime !== this.lastMediaTime) {
          this.lastMediaTime = this.video.currentTime
          this.process(now, now)
        }
        this.schedule()
      })
    }
  }

  private process(now: number, frameTime: number): void {
    if (document.hidden) return
    const frame = this.detector.detect(this.video, now)
    const sample: RawPoseSample = {
      timestamp: now,
      frameTime: Math.min(frameTime, now),
      landmarks: frame?.landmarks ?? null,
      imageWidth: this.video.videoWidth || 1280,
      imageHeight: this.video.videoHeight || 720,
      inferenceMs: this.detector.lastInferenceMs,
    }
    for (const listener of this.listeners) listener(sample)
  }
}
