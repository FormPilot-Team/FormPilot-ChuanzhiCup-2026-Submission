import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserCameraAdapter } from '../../adapters/camera/BrowserCameraAdapter'
import type { PoseOverlayHandle } from '../../components/pose/PoseOverlay'
import { useCameraFailure } from '../../features/camera/useCameraFailure'
import { normalizePoseFrame, type NormalizedPoseFrame } from '../../features/pose/PoseNormalizer'
import { PoseFilter } from '../../features/pose/PoseFilter'
import type { PoseFrame } from '../../features/pose/types'
import { WorkshopPoseDetector, type WorkshopModelVariant } from '../../features/workshop/detector'
import { FIXTURE_ASPECT, FIXTURE_SIZE, fixtureFrame, type FixtureMode } from '../../features/workshop/fixture'
import type { CapturedPose } from '../../features/workshop/types'

export type WorkshopCameraMode = 'idle' | 'requesting_permission' | 'model_loading' | 'live' | 'demo' | 'error'

export interface WorkshopFrame {
  /** Filtered and normalised; null when no person is detected. */
  pose: NormalizedPoseFrame | null
  /** The filtered frame, for drawing. */
  raw: PoseFrame | null
  /** The detector's own frame before filtering (gestures use a lighter filter of their own). */
  detected: PoseFrame | null
  timestamp: number
  /** Width / height of the camera picture. */
  aspect: number
}

export interface WorkshopFixtureControl {
  mode: FixtureMode
  poses: { start?: CapturedPose; finish?: CapturedPose }
}

type FixtureWindow = typeof window & { __workshopFixtureMode?: FixtureMode }

/**
 * Camera + pose pipeline for the workshop and custom-action training: the shared camera adapter, filter and
 * normaliser with the workshop's own detector instance (see features/workshop/detector.ts). DEV builds can replace the
 * camera with a synthetic person (`?fixture=synthetic`) whose pose the page controls.
 */
export function useWorkshopCamera({ synthetic, onFrame, fixture, showOverlay = () => true }: {
  synthetic: boolean
  onFrame: (frame: WorkshopFrame) => void
  fixture?: () => WorkshopFixtureControl
  /** Whether to draw the skeleton on this frame (training hides it while following, as the other modes do). */
  showOverlay?: () => boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const demoImageRef = useRef<HTMLImageElement>(null)
  const overlayRef = useRef<PoseOverlayHandle>(null)
  const cameraRef = useRef<BrowserCameraAdapter | null>(null)
  const detectorRef = useRef<WorkshopPoseDetector | null>(null)
  const filterRef = useRef<PoseFilter | null>(null)
  const generationRef = useRef(0)
  const rafRef = useRef(0)
  const lastVideoTimeRef = useRef(-1)
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  const fixtureRef = useRef(fixture)
  fixtureRef.current = fixture
  const [mode, setMode] = useState<WorkshopCameraMode>('idle')
  const { failure, report: reportFailure, clear: clearFailure } = useCameraFailure()
  const [modelVariant, setModelVariant] = useState<WorkshopModelVariant>()

  const showOverlayRef = useRef(showOverlay)
  showOverlayRef.current = showOverlay
  const deliver = useCallback((raw: PoseFrame | null, timestamp: number, aspect: number, mirrored: boolean, width: number, height: number) => {
    const filtered = raw ? (filterRef.current ??= new PoseFilter()).push(raw) : null
    const pose = filtered ? normalizePoseFrame(filtered) : null
    if (filtered && showOverlayRef.current()) overlayRef.current?.draw(filtered, [], { mirrored, sourceWidth: width, sourceHeight: height, fit: 'contain' })
    else overlayRef.current?.clear()
    onFrameRef.current({ pose, raw: filtered, detected: raw, timestamp, aspect })
  }, [])

  const stop = useCallback(() => {
    generationRef.current += 1
    cancelAnimationFrame(rafRef.current)
    cameraRef.current?.stop(videoRef.current ?? undefined)
    overlayRef.current?.clear()
    filterRef.current?.reset()
    setMode('idle')
  }, [])

  const startSynthetic = useCallback(() => {
    generationRef.current += 1
    const generation = generationRef.current
    setMode('demo')
    let lastAt = 0
    const loop = () => {
      if (generation !== generationRef.current) return
      const now = performance.now()
      if (now - lastAt >= 33) {
        lastAt = now
        const control = fixtureRef.current?.() ?? { mode: 'start' as FixtureMode, poses: {} }
        const forced = (window as FixtureWindow).__workshopFixtureMode
        deliver(fixtureFrame(forced ?? control.mode, now, control.poses), now, FIXTURE_ASPECT, false, FIXTURE_SIZE.width, FIXTURE_SIZE.height)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [deliver])

  const start = useCallback(async () => {
    if (synthetic) return startSynthetic()
    const video = videoRef.current
    if (!video) return
    generationRef.current += 1
    const generation = generationRef.current
    cancelAnimationFrame(rafRef.current)
    setMode('requesting_permission')
    clearFailure()
    const camera = (cameraRef.current ??= new BrowserCameraAdapter())
    let cameraReady = false
    try {
      await camera.start(video)
      cameraReady = true
      if (generation !== generationRef.current) return camera.stop(video)
      setMode('model_loading')
      const detector = (detectorRef.current ??= new WorkshopPoseDetector())
      await detector.initialize()
      setModelVariant(detector.variant)
      if (generation !== generationRef.current) return camera.stop(video)
      setMode('live')
      const loop = () => {
        if (generation !== generationRef.current) return
        const now = performance.now()
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime
          const width = video.videoWidth || 1280
          const height = video.videoHeight || 720
          deliver(detector.detect(video, now), now, width / height, true, width, height)
        }
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch (caught) {
      if (generation !== generationRef.current) return
      setMode('error')
      reportFailure(caught, cameraReady ? 'model' : 'camera')
      camera.stop(video)
    }
  }, [clearFailure, deliver, reportFailure, startSynthetic, synthetic])

  useEffect(() => () => {
    generationRef.current += 1
    cancelAnimationFrame(rafRef.current)
    cameraRef.current?.stop()
    const detector = detectorRef.current
    // Closing on the next tick lets an in-flight detect() finish first.
    if (detector) window.setTimeout(() => detector.close(), 0)
  }, [])

  return { videoRef, demoImageRef, overlayRef, mode, failure, modelVariant, start, stop, capturing: mode === 'live' || mode === 'demo' }
}
