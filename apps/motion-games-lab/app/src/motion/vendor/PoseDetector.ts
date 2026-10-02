// Copied from FormPilot_v3: src/features/pose/PoseDetector.ts (commit 9cf6c24, 2026-10-02).
// Lab changes:
// - the desktop diagnostics bridge/errorText imports are replaced by a local errorText;
// - presence is no longer forced to 1 (Phase 0 audit: a constant 1 looks like a real confidence);
// - detect() skips non-increasing timestamps instead of letting MediaPipe throw;
// - lastInferenceMs records the synchronous detectForVideo cost for the debug panel;
// - optional `delegate` forces GPU or CPU (performance comparison) instead of GPU-then-CPU.
// GPU-first / CPU-fallback order, VIDEO mode, numPoses=1 and confidence options are unchanged.
import type { PoseFrame, PoseLandmark } from './poseTypes'

export interface PoseDetectorConfig {
  wasmRoot: string
  modelAssetPath: string
  minConfidence: number
  delegate?: PoseDelegate
}

export interface PoseDetectorLike {
  initialize(): Promise<void>
  detect(source: PoseImageSource, timestamp: number): PoseFrame | null
  close(): void
}

export type PoseImageSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement

export type PoseDelegate = 'GPU' | 'CPU'

export interface PoseModelFailure {
  stage: 'model-fetch' | 'landmarker'
  modelAssetPath: string
  /** 模型文件的 HTTP 状态；null 表示请求本身失败 */
  modelStatus: number | null
  modelBytes: number | null
  gpuError: string | null
  cpuError: string | null
}

export class PoseModelError extends Error {
  constructor(message: string, readonly details: PoseModelFailure) {
    super(message)
    this.name = 'PoseModelError'
  }
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '')
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

const DEFAULT_CONFIG: PoseDetectorConfig = {
  wasmRoot: './wasm',
  modelAssetPath: './models/pose_landmarker_lite.task',
  minConfidence: 0.5,
}

export class PoseDetector implements PoseDetectorLike {
  private landmarker?: import('@mediapipe/tasks-vision').PoseLandmarker
  private initPromise?: Promise<import('@mediapipe/tasks-vision').PoseLandmarker>
  private closed = true
  private lastTimestamp = -Infinity

  constructor(private readonly config: PoseDetectorConfig = DEFAULT_CONFIG) {}

  initializeCalls = 0
  initializationCount = 0
  /** 仅当 GPU 委托无法启动时才用 CPU */
  delegate?: PoseDelegate
  gpuError?: string
  lastInferenceMs = 0

  async initialize(): Promise<void> {
    this.initializeCalls += 1
    this.closed = false
    if (this.landmarker) return
    this.initPromise ??= this.createLandmarker()
    try {
      const created = await this.initPromise
      if (this.closed) {
        created.close()
        return
      }
      this.landmarker = created
    } catch (error) {
      this.initPromise = undefined
      throw error
    } finally {
      if (this.closed && !this.landmarker) this.initPromise = undefined
    }
  }

  detect(source: PoseImageSource, timestamp: number): PoseFrame | null {
    if (!this.landmarker) return null
    if (timestamp <= this.lastTimestamp) return null
    if (source instanceof HTMLVideoElement && source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null
    if (source instanceof HTMLImageElement && (!source.complete || source.naturalWidth === 0)) return null
    if (source instanceof HTMLCanvasElement && (source.width === 0 || source.height === 0)) return null
    this.lastTimestamp = timestamp
    const started = performance.now()
    const result = this.landmarker.detectForVideo(source, timestamp)
    this.lastInferenceMs = performance.now() - started
    const raw = result.landmarks[0]
    if (!raw) return null
    const landmarks: PoseLandmark[] = raw.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
      visibility: point.visibility ?? 0,
    }))
    const confidence = landmarks.reduce((sum, point) => sum + point.visibility, 0) / landmarks.length
    return { timestamp, landmarks, confidence }
  }

  close(): void {
    this.closed = true
    this.lastTimestamp = -Infinity
    if (this.landmarker) {
      this.landmarker.close()
      this.landmarker = undefined
      this.initPromise = undefined
    }
  }

  /** 单独请求模型文件，以区分文件缺失和委托无法启动 */
  private async fetchModel(): Promise<Uint8Array> {
    const failure = (modelStatus: number | null, message: string): PoseModelError => new PoseModelError(message, {
      stage: 'model-fetch', modelAssetPath: this.config.modelAssetPath, modelStatus, modelBytes: null, gpuError: null, cpuError: null,
    })
    let response: Response
    try {
      response = await fetch(this.config.modelAssetPath)
    } catch (error) {
      throw failure(null, `Pose model request failed: ${errorText(error)}`)
    }
    if (!response.ok) throw failure(response.status, `Pose model answered HTTP ${response.status}`)
    try {
      return new Uint8Array(await response.arrayBuffer())
    } catch (error) {
      throw failure(response.status, `Pose model download broke off: ${errorText(error)}`)
    }
  }

  private async createLandmarker() {
    this.initializationCount += 1
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
    const model = await this.fetchModel()
    const vision = await FilesetResolver.forVisionTasks(this.config.wasmRoot)
    const create = (delegate: PoseDelegate) => PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: model, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: this.config.minConfidence,
      minPosePresenceConfidence: this.config.minConfidence,
      minTrackingConfidence: this.config.minConfidence,
      outputSegmentationMasks: false,
    })
    if (this.config.delegate === 'CPU') {
      const landmarker = await create('CPU')
      this.delegate = 'CPU'
      return landmarker
    }
    try {
      const landmarker = await create('GPU')
      this.delegate = 'GPU'
      this.gpuError = undefined
      return landmarker
    } catch (gpuFailure) {
      // 部分显卡驱动无法运行 GPU 委托；CPU 委托结果相同，只是更慢
      this.gpuError = errorText(gpuFailure)
      try {
        const landmarker = await create('CPU')
        this.delegate = 'CPU'
        return landmarker
      } catch (cpuFailure) {
        throw new PoseModelError('Pose landmarker could not start on GPU or CPU', {
          stage: 'landmarker', modelAssetPath: this.config.modelAssetPath, modelStatus: 200, modelBytes: model.byteLength, gpuError: this.gpuError, cpuError: errorText(cpuFailure),
        })
      }
    }
  }
}
