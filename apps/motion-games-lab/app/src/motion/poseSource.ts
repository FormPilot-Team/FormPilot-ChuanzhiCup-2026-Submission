// Pose sources feed raw landmarks into the MotionAdapter. Only this layer knows about cameras and
// MediaPipe; the adapter turns samples into MotionFrames/MotionEvents for games.
import { BrowserCameraAdapter, cameraErrorPresentation, type CameraErrorPresentation } from './vendor/BrowserCameraAdapter'
import { PoseDetector, PoseModelError, type PoseDetectorConfig } from './vendor/PoseDetector'
import type { PoseLandmark } from './vendor/poseTypes'
import type { PoseWorkerRequest, PoseWorkerResponse, WorkerDelegate } from './poseWorker'

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
  /** 'worker' = pose inference off the main thread (default); 'main' = fallback or ?inference=main */
  inferenceThread: 'worker' | 'main' | 'none'
  /** why the worker path is not in use (diagnostics); null when it is */
  workerFallback: string | null
  /** camera frames skipped because a newer one replaced them while inference was busy (never queued) */
  framesDropped: number
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

/**
 * The worker receives the camera frame at full resolution. A downscaled frame (640 or 960 px) was
 * measured: on arm-raise / sweep clips it matched within ~1 % of torso length, but on arms crossing the
 * body MediaPipe's frame-to-frame tracking diverged (p95 ≈ 10 % of torso length) — so no resampling;
 * the worker sees exactly the pixels the old main-thread path saw.
 */
const WORKER_INIT_TIMEOUT_MS = 20_000

interface PendingFrame {
  now: number
  frameTime: number
}

/**
 * Camera + MediaPipe. Pose inference runs in a Worker by default, so game rendering never waits for the
 * model: each camera frame is offered to the worker; while it is busy only the newest frame is kept
 * (older ones are skipped, never queued); results arrive asynchronously and the adapter always consumes
 * the latest pose. If the worker cannot start (no OffscreenCanvas / module workers, GPU problems) the
 * same detector runs on the main thread as before; `?inference=main` forces that path for comparisons.
 */
export class CameraPoseSource implements PoseSource {
  readonly kind = 'camera' as const
  private readonly camera = new BrowserCameraAdapter()
  private readonly detectorConfig: PoseDetectorConfig
  private mainDetector: PoseDetector | null = null
  private worker: Worker | null = null
  private workerDelegate: string | null = null
  private workerFallback: string | null = null
  private thread: PoseSourceInfo['inferenceThread'] = 'none'
  private readonly video: FrameCallbackVideo
  private readonly listeners = new Set<SampleListener>()
  private mediaStream: MediaStream | null = null
  private running = false
  private handle = 0
  private usesFrameCallback = false
  private lastMediaTime = -1
  // worker pump: at most one frame in flight and one (the newest) waiting
  private busy = false
  private waiting: PendingFrame | null = null
  private lastSent = -Infinity
  private dropped = 0

  constructor(private readonly options: { delegate?: 'GPU' | 'CPU'; inference?: 'auto' | 'main' } = {}) {
    this.detectorConfig = {
      wasmRoot: `${import.meta.env.BASE_URL}wasm`,
      modelAssetPath: `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`,
      minConfidence: 0.5,
      delegate: options.delegate,
    }
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
      await this.startInference()
    } catch (error) {
      const detail = error instanceof PoseModelError ? error.details.stage : 'unknown'
      this.video.remove()
      throw new PoseSourceError({ message: '动作识别模型没有加载成功。', guidance: `请刷新页面后再试一次（${detail}）。` }, error)
    }
    try {
      this.mediaStream = await this.camera.start(this.video)
    } catch (error) {
      this.closeInference()
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
    this.closeInference()
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
      delegate: (this.thread === 'worker' ? this.workerDelegate : this.mainDetector?.delegate) ?? 'pending',
      model: 'pose_landmarker_lite',
      cameraWidth: settings?.width ?? null,
      cameraHeight: settings?.height ?? null,
      cameraFrameRate: settings?.frameRate ?? null,
      inferenceThread: this.thread,
      workerFallback: this.workerFallback,
      framesDropped: this.dropped,
    }
  }

  // ---------- inference setup ----------

  private async startInference(): Promise<void> {
    const workerCapable = typeof Worker === 'function' && typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function'
    if (this.options.inference !== 'main' && workerCapable) {
      try {
        await this.startWorker()
        this.thread = 'worker'
        return
      } catch (error) {
        this.workerFallback = (error instanceof Error ? error.message : String(error)).slice(0, 200)
        this.worker?.terminate()
        this.worker = null
      }
    } else {
      this.workerFallback = this.options.inference === 'main' ? 'forced (?inference=main)' : 'worker unsupported'
    }
    this.mainDetector = new PoseDetector(this.detectorConfig)
    await this.mainDetector.initialize()
    this.thread = 'main'
  }

  private startWorker(): Promise<void> {
    const worker = new Worker(new URL('./poseWorker.ts', import.meta.url), { type: 'module', name: 'pose-inference' })
    this.worker = worker
    const absolute = (path: string) => new URL(path, location.href).href
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker init timeout')), WORKER_INIT_TIMEOUT_MS)
      worker.onerror = (event) => {
        clearTimeout(timer)
        reject(new Error(`worker error: ${event.message || 'load failed'}`))
      }
      worker.onmessage = (event: MessageEvent<PoseWorkerResponse>) => {
        const message = event.data
        if (message.type === 'ready') {
          clearTimeout(timer)
          this.workerDelegate = message.delegate
          worker.onmessage = (next: MessageEvent<PoseWorkerResponse>) => this.onWorkerMessage(next.data)
          resolve()
        } else if (message.type === 'error') {
          clearTimeout(timer)
          reject(new Error(`worker ${message.stage}: ${message.message}`))
        }
      }
      // default AUTO: CPU first (the integrated GPU is busy rendering the game), GPU if the CPU is too slow
      const delegate: WorkerDelegate = this.detectorConfig.delegate ?? 'AUTO'
      const init: PoseWorkerRequest = {
        type: 'init',
        wasmRoot: absolute(this.detectorConfig.wasmRoot),
        modelUrl: absolute(this.detectorConfig.modelAssetPath),
        minConfidence: this.detectorConfig.minConfidence,
        delegate,
      }
      worker.postMessage(init)
    })
  }

  private closeInference(): void {
    if (this.worker) {
      this.worker.onmessage = null
      this.worker.postMessage({ type: 'close' } satisfies PoseWorkerRequest)
      this.worker = null
    }
    this.mainDetector?.close()
    this.mainDetector = null
    this.busy = false
    this.waiting = null
  }

  // ---------- frame pump ----------

  private schedule(): void {
    if (!this.running) return
    if (this.usesFrameCallback) {
      this.handle = this.video.requestVideoFrameCallback!((now, metadata) => {
        this.onCameraFrame(now, metadata.captureTime ?? metadata.presentationTime ?? now)
        this.schedule()
      })
    } else {
      this.handle = requestAnimationFrame((now) => {
        // Fallback: only process when the video actually advanced to a new frame.
        if (this.video.currentTime !== this.lastMediaTime) {
          this.lastMediaTime = this.video.currentTime
          this.onCameraFrame(now, now)
        }
        this.schedule()
      })
    }
  }

  private onCameraFrame(now: number, frameTime: number): void {
    if (document.hidden) return
    const frame: PendingFrame = { now, frameTime: Math.min(frameTime, now) }
    if (this.thread === 'main') {
      this.processOnMain(frame)
      return
    }
    if (this.busy) {
      // keep only the newest frame; the one it replaces is skipped, never queued
      if (this.waiting) this.dropped += 1
      this.waiting = frame
      return
    }
    this.send(frame)
  }

  private send(frame: PendingFrame): void {
    const worker = this.worker
    if (!worker || frame.now <= this.lastSent || this.video.readyState < 2 || !this.video.videoWidth) return
    this.busy = true
    this.lastSent = frame.now
    createImageBitmap(this.video).then(
      (bitmap) => {
        if (this.worker !== worker) {
          bitmap.close()
          return
        }
        worker.postMessage({ type: 'frame', bitmap, timestamp: frame.now, frameTime: frame.frameTime } satisfies PoseWorkerRequest, [bitmap])
      },
      () => this.onWorkerIdle(),
    )
  }

  private onWorkerMessage(message: PoseWorkerResponse): void {
    if (message.type === 'delegate') {
      this.workerDelegate = `${message.delegate} (auto: ${message.reason})`
      return
    }
    if (message.type !== 'result') return
    this.emit({
      timestamp: message.timestamp,
      frameTime: message.frameTime,
      landmarks: message.landmarks,
      imageWidth: this.video.videoWidth || 1280,
      imageHeight: this.video.videoHeight || 720,
      inferenceMs: message.inferenceMs,
    })
    this.onWorkerIdle()
  }

  private onWorkerIdle(): void {
    this.busy = false
    const next = this.waiting
    this.waiting = null
    if (next && this.running && !document.hidden) this.send(next)
  }

  private processOnMain(frame: PendingFrame): void {
    const detector = this.mainDetector
    if (!detector) return
    const result = detector.detect(this.video, frame.now)
    this.emit({
      timestamp: frame.now,
      frameTime: frame.frameTime,
      landmarks: result?.landmarks ?? null,
      imageWidth: this.video.videoWidth || 1280,
      imageHeight: this.video.videoHeight || 720,
      inferenceMs: detector.lastInferenceMs,
    })
  }

  private emit(sample: RawPoseSample): void {
    for (const listener of this.listeners) listener(sample)
  }
}
