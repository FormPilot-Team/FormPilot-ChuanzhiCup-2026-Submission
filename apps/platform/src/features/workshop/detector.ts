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
