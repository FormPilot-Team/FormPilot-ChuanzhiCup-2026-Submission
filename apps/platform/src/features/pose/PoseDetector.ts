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

  private async createLandmarker() {
    this.initializationCount += 1
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(this.config.wasmRoot)
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: this.config.modelAssetPath, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: this.config.minConfidence,
      minPosePresenceConfidence: this.config.minConfidence,
      minTrackingConfidence: this.config.minConfidence,
      outputSegmentationMasks: false,
    })
  }
}
