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
  /** 滤波并归一化后的姿态；未检测到人时为 null */
  pose: NormalizedPoseFrame | null
  /** 滤波后的帧，用于绘制 */
  raw: PoseFrame | null
  /** 滤波前的检测帧（手势使用自己的轻量滤波） */
  detected: PoseFrame | null
  timestamp: number
  /** 摄像头画面宽 / 高 */
  aspect: number
}

export interface WorkshopFixtureControl {
  mode: FixtureMode
  poses: { start?: CapturedPose; finish?: CapturedPose }
}

type FixtureWindow = typeof window & { __workshopFixtureMode?: FixtureMode }

/** 动作工坊与自定义训练的摄像头 + 姿态管线；开发环境可用 ?fixture=synthetic 的合成人物代替摄像头 */
export function useWorkshopCamera({ synthetic, onFrame, fixture, showOverlay = () => true }: {
  synthetic: boolean
  onFrame: (frame: WorkshopFrame) => void
  fixture?: () => WorkshopFixtureControl
  /** 本帧是否绘制骨架（跟练中隐藏，与其他模式一致） */
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
    // 下一个 tick 再关闭，让进行中的 detect() 先完成
    if (detector) window.setTimeout(() => detector.close(), 0)
  }, [])

  return { videoRef, demoImageRef, overlayRef, mode, failure, modelVariant, start, stop, capturing: mode === 'live' || mode === 'demo' }
}
