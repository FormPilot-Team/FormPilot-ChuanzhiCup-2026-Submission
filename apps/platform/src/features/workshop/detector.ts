import { PoseDetector, type PoseDetectorLike, type PoseImageSource } from '../pose/PoseDetector'
import type { PoseFrame } from '../pose/types'

/**
 * The workshop's own pose detector. Custom actions are free-form (floor, side-on and seated moves), so they use
 * MediaPipe's larger "full" landmark model, created only on workshop pages. The warm-up and follow-along pages keep
 * the shared default detector (lite model) and never load this model. If the full model cannot start, the workshop
 * falls back to the lite model rather than failing.
 */
export const WORKSHOP_POSE_MODELS = Object.freeze({
  full: '/models/pose_landmarker_full.task',
  lite: '/models/pose_landmarker_lite.task',
})

export type WorkshopModelVariant = keyof typeof WORKSHOP_POSE_MODELS

function createDetector(variant: WorkshopModelVariant): PoseDetector {
  return new PoseDetector({ wasmRoot: '/wasm', modelAssetPath: WORKSHOP_POSE_MODELS[variant], minConfidence: 0.5 })
}

export class WorkshopPoseDetector implements PoseDetectorLike {
  private detector: PoseDetector
  private currentVariant: WorkshopModelVariant

  constructor(private readonly factory: (variant: WorkshopModelVariant) => PoseDetector = createDetector) {
    this.currentVariant = 'full'
    this.detector = factory('full')
  }

  get variant(): WorkshopModelVariant {
    return this.currentVariant
  }

  async initialize(): Promise<void> {
    try {
      await this.detector.initialize()
    } catch (error) {
      if (this.currentVariant === 'lite') throw error
      this.detector.close()
      this.currentVariant = 'lite'
      this.detector = this.factory('lite')
      await this.detector.initialize()
    }
  }

  detect(source: PoseImageSource, timestamp: number): PoseFrame | null {
    return this.detector.detect(source, timestamp)
  }

  close(): void {
    this.detector.close()
  }
}

/**
 * The hands-together start / resume gesture (features/gesture) is shared by every training mode, and its visibility
 * gate (GESTURE_VISIBILITY_THRESHOLD) was set on the lite model that the warm-up and follow-along pages feed it. The
 * full model rates wrists held together in front of the body much lower (on the same camera frames: right wrist 0.55
 * vs 0.82), so on custom-action training the gesture never held for its 1.2 s and training could not start.
 *
 * Custom-action training therefore reads the gesture from the lite model, and only while it waits for a gesture.
 * Recognition, framing and the overlay keep the full model, and the gesture thresholds are unchanged. If the lite
 * model cannot start, the gesture uses the full model's frames, as before.
 */
export class WorkshopGestureDetector {
  private detector?: PoseDetector
  private loading?: Promise<void>
  private closed = false

  constructor(private readonly factory: (variant: WorkshopModelVariant) => PoseDetector = createDetector) {}

  /** True once gesture frames come from the lite model rather than the recognition detector's frames. */
  get separate(): boolean {
    return Boolean(this.detector)
  }

  /** Loads the lite model, unless recognition already runs on it (its frames are then used as they are). */
  initialize(recognitionVariant: WorkshopModelVariant): Promise<void> {
    this.closed = false
    if (recognitionVariant === 'lite' || this.detector) return Promise.resolve()
    this.loading ??= (async () => {
      const detector = this.factory('lite')
      try {
        await detector.initialize()
        if (this.closed) detector.close()
        else this.detector = detector
      } catch {
        detector.close()
      } finally {
        this.loading = undefined
      }
    })()
    return this.loading
  }

  /** The frame the gesture is judged on; `recognitionFrame` is the full model's frame for the same picture. */
  detect(source: PoseImageSource, timestamp: number, recognitionFrame: PoseFrame | null): PoseFrame | null {
    return this.detector ? this.detector.detect(source, timestamp) : recognitionFrame
  }

  close(): void {
    this.closed = true
    this.detector?.close()
    this.detector = undefined
  }
}
