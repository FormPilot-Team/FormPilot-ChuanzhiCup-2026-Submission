import { logDiagnostics } from '../diagnostics/desktopBridge'
import { errorText } from '../diagnostics/diagnosticsReport'
import type { PoseFrame, PoseLandmark } from './types'

export interface PoseDetectorConfig {
  wasmRoot: string
  modelAssetPath: string
  minConfidence: number
}

export interface PoseDetectorLike {
  initialize(): Promise<void>
  detect(source: PoseImageSource, timestamp: number): PoseFrame | null
  close(): void
}

export type PoseImageSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement

export type PoseDelegate = 'GPU' | 'CPU'

/** Why the pose model did not start, for the diagnostics panel. */
export interface PoseModelFailure {
  stage: 'model-fetch' | 'landmarker'
  modelAssetPath: string
  /** HTTP status of the model file (null: the request itself failed). */
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

const DEFAULT_CONFIG: PoseDetectorConfig = {
  wasmRoot: '/wasm',
  modelAssetPath: '/models/pose_landmarker_lite.task',
  minConfidence: 0.5,
}

export class PoseDetector implements PoseDetectorLike {
  private landmarker?: import('@mediapipe/tasks-vision').PoseLandmarker
  private initPromise?: Promise<import('@mediapipe/tasks-vision').PoseLandmarker>
  private closed = true

  constructor(private readonly config: PoseDetectorConfig = DEFAULT_CONFIG) {}

  initializeCalls = 0
  initializationCount = 0
  /** The delegate the running landmarker uses; CPU only when the GPU delegate could not start on this machine. */
  delegate?: PoseDelegate
  /** Why the GPU delegate failed, when it did. */
  gpuError?: string

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
    if (source instanceof HTMLVideoElement && source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null
    if (source instanceof HTMLImageElement && (!source.complete || source.naturalWidth === 0)) return null
    if (source instanceof HTMLCanvasElement && (source.width === 0 || source.height === 0)) return null
    const result = this.landmarker.detectForVideo(source, timestamp)
    const raw = result.landmarks[0]
    if (!raw) return null
    const landmarks: PoseLandmark[] = raw.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
      visibility: point.visibility ?? 0,
      presence: 1,
    }))
    const confidence = landmarks.reduce((sum, point) => sum + point.visibility, 0) / landmarks.length
    return { timestamp, landmarks, confidence }
  }

  close(): void {
    this.closed = true
    if (this.landmarker) {
      this.landmarker.close()
      this.landmarker = undefined
      this.initPromise = undefined
    }
  }

  /** The model file itself, so a missing or unreadable file is told apart from a delegate that cannot start. */
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
    try {
      const landmarker = await create('GPU')
      this.delegate = 'GPU'
      this.gpuError = undefined
      return landmarker
    } catch (gpuFailure) {
      // Some GPUs / drivers cannot run the GPU delegate; the CPU delegate gives the same landmarks, only slower.
      this.gpuError = errorText(gpuFailure)
      try {
        const landmarker = await create('CPU')
        this.delegate = 'CPU'
        logDiagnostics('model-fallback', { modelAssetPath: this.config.modelAssetPath, gpuError: this.gpuError })
        return landmarker
      } catch (cpuFailure) {
        throw new PoseModelError('Pose landmarker could not start on GPU or CPU', {
          stage: 'landmarker', modelAssetPath: this.config.modelAssetPath, modelStatus: 200, modelBytes: model.byteLength, gpuError: this.gpuError, cpuError: errorText(cpuFailure),
        })
      }
    }
  }
}
