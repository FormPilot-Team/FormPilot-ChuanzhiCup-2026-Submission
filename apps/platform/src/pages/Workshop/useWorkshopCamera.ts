import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserCameraAdapter } from '../../adapters/camera/BrowserCameraAdapter'
import type { PoseOverlayHandle } from '../../components/pose/PoseOverlay'
import { useCameraFailure } from '../../features/camera/useCameraFailure'
import { normalizePoseFrame, type NormalizedPoseFrame } from '../../features/pose/PoseNormalizer'
import { PoseFilter } from '../../features/pose/PoseFilter'
import type { PoseFrame } from '../../features/pose/types'
import { WorkshopGestureDetector, WorkshopPoseDetector, type WorkshopModelVariant } from '../../features/workshop/detector'
import { FIXTURE_ASPECT, FIXTURE_SIZE, fixtureFrame, type FixtureMode } from '../../features/workshop/fixture'
import type { CapturedPose } from '../../features/workshop/types'

export type WorkshopCameraMode = 'idle' | 'requesting_permission' | 'model_loading' | 'live' | 'demo' | 'error'

export interface WorkshopFrame {
  /** 滤波并归一化后的姿态；未检测到人时为 null */
  pose: NormalizedPoseFrame | null
  /** 滤波后的帧，用于绘制 */
  raw: PoseFrame | null
  /** 滤波前的检测帧（手势使用自己的轻量滤波）；传入 gestureFrames 时为手势专用帧，不需要手势时为 null */
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
export function useWorkshopCamera({ synthetic, onFrame, fixture, showOverlay = () => true, gestureFrames }: {
  synthetic: boolean
  onFrame: (frame: WorkshopFrame) => void
  fixture?: () => WorkshopFixtureControl
  /** 本帧是否绘制骨架（跟练中隐藏，与其他模式一致） */
  showOverlay?: () => boolean
  /**
   * 自定义训练：本帧是否需要判断开始 / 继续手势。手势帧来自与热身、功法相同的 lite 模型（见 WorkshopGestureDetector），
   * 识别、取景和骨架仍用 full 模型；不需要手势时不做这次额外推理。不传时 detected 就是识别帧（动作编辑页）。
   */
  gestureFrames?: () => boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const demoImageRef = useRef<HTMLImageElement>(null)
  const overlayRef = useRef<PoseOverlayHandle>(null)
  const cameraRef = useRef<BrowserCameraAdapter | null>(null)
  const detectorRef = useRef<WorkshopPoseDetector | null>(null)
  const gestureDetectorRef = useRef<WorkshopGestureDetector | null>(null)
  const gestureFramesRef = useRef(gestureFrames)
  gestureFramesRef.current = gestureFrames
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
  const deliver = useCallback((raw: PoseFrame | null, timestamp: number, aspect: number, mirrored: boolean, width: number, height: number, detected: PoseFrame | null = raw) => {
    const filtered = raw ? (filterRef.current ??= new PoseFilter()).push(raw) : null
    const pose = filtered ? normalizePoseFrame(filtered) : null
    if (filtered && showOverlayRef.current()) overlayRef.current?.draw(filtered, [], { mirrored, sourceWidth: width, sourceHeight: height, fit: 'contain' })
    else overlayRef.current?.clear()
    onFrameRef.current({ pose, raw: filtered, detected, timestamp, aspect })
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
      // 手势模型在后台加载，不推迟开始识别；加载完成前手势沿用识别帧
      if (gestureFramesRef.current) void (gestureDetectorRef.current ??= new WorkshopGestureDetector()).initialize(detector.variant)
      if (generation !== generationRef.current) return camera.stop(video)
      setMode('live')
      const loop = () => {
        if (generation !== generationRef.current) return
        const now = performance.now()
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime
          const width = video.videoWidth || 1280
          const height = video.videoHeight || 720
          const raw = detector.detect(video, now)
          const wantsGesture = gestureFramesRef.current
          const gestureFrame = !wantsGesture ? raw
            : wantsGesture() ? (gestureDetectorRef.current ? gestureDetectorRef.current.detect(video, now, raw) : raw)
              : null
          deliver(raw, now, width / height, true, width, height, gestureFrame)
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
    const gestureDetector = gestureDetectorRef.current
    // 下一个 tick 再关闭，让进行中的 detect() 先完成
    if (detector) window.setTimeout(() => detector.close(), 0)
    if (gestureDetector) window.setTimeout(() => gestureDetector.close(), 0)
  }, [])

  return { videoRef, demoImageRef, overlayRef, mode, failure, modelVariant, start, stop, capturing: mode === 'live' || mode === 'demo' }
}
