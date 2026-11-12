import { Camera, LoaderCircle, Maximize2, ScanLine, ScanSearch } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { CameraFailureReport } from '../../features/camera/cameraDiagnostics'
import type { CourseSnapshot } from '../../features/course/CourseController'
import { isDesktopApp } from '../../features/diagnostics/desktopBridge'
import type { MotionError } from '../../features/exercises/types'
import type { FramingAssistState } from '../../features/framing/FramingAssist'
import { cn } from '../../lib/cn'
import { CameraCountdown } from '../camera/CameraCountdown'
import { CameraFailureNotice } from '../camera/CameraFailureNotice'
import { FAILURE_STATUS } from '../camera/cameraStatus'
import { PoseOverlay, type PoseHighlightRegion, type PoseOverlayHandle } from '../pose/PoseOverlay'
import { useBodyFraming } from './useBodyFraming'

type CameraMode = 'idle' | 'requesting_permission' | 'model_loading' | 'live' | 'demo' | 'error'

interface ImmersiveCameraPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>
  demoImageRef: RefObject<HTMLImageElement | null>
  overlayRef: RefObject<PoseOverlayHandle | null>
  mode: CameraMode
  failure?: CameraFailureReport
  errors: ReadonlyArray<MotionError>
  demoAsset: { portraitSrc: string; landscapeSrc: string; alt: string; fit?: 'cover' | 'contain' }
  demoFrameSrc?: string
  preparationMessage?: string
  gesturePrompt?: string
  gestureProgress?: number
  gestureHolding?: boolean
  outOfFrameMessage: string
  showPoseOverlay?: boolean
  framingAssist?: FramingAssistState
  /** Body in frame, for runtimes without Framing Assist (custom actions); otherwise Framing Assist decides. */
  framingReady?: boolean
  /** A confirmed region correction, marked on the user's own skeleton. */
  highlight?: PoseHighlightRegion
  /** A confirmed side correction (warm-up): the side named by the runtime's errors is marked while the skeleton is hidden. */
  correctionActive?: boolean
  course?: Pick<CourseSnapshot, 'state' | 'countdown'>
  title?: string
  /** Small read-outs in the header strip (similarity, count…), never over the picture. */
  headerExtra?: ReactNode
  /** The one coaching line, in the band under the picture (never over the body). */
  guidance?: ReactNode
  className?: string
  /** Size of the picture box (the page matches it to the demonstration or lets it fill the screen). */
  stageStyle?: CSSProperties
  onStart: () => void
}

/**
 * The user's own camera picture on the dark training shell (Web V1.1, C2/C3).
 *
 * - Real camera content only (the synthetic fixture shows its recorded frames), mirrored, `object-contain`: the whole
 *   picture is always available and the body is never cropped by the box shape.
 * - 自动取景: the picture may be enlarged around the person, but only as far as every recently seen joint, hand and foot
 *   stays inside the stage (see bodyFraming.ts). The skeleton canvas moves with the video in one layer.
 * - Status chips sit in the header strip and the coaching line in the band below, so nothing covers the body.
 */
export function ImmersiveCameraPanel({
  videoRef, demoImageRef, overlayRef, mode, failure, errors, demoAsset, demoFrameSrc, preparationMessage, gesturePrompt, gestureProgress = 0,
  gestureHolding = false, outOfFrameMessage, showPoseOverlay = true, framingAssist, framingReady, highlight, correctionActive = false, course, title = '我的画面', headerExtra, guidance, className, stageStyle, onStart,
}: ImmersiveCameraPanelProps) {
  const [autoFraming, setAutoFraming] = useState(true)
  const capturing = mode === 'live' || mode === 'demo'
  const highlightActive = (Boolean(highlight) || correctionActive) && capturing
  // Framing follows the landmarks of the picture on screen: the live camera, or a recorded frame sequence. A static
  // test image (synthetic fixture without frames) does not move with its landmarks, so it is always shown whole.
  const framingAvailable = mode === 'live' || (mode === 'demo' && Boolean(demoFrameSrc))
  const framing = useBodyFraming({ overlayRef, enabled: autoFraming && framingAvailable, ready: capturing && (framingReady ?? Boolean(framingAssist?.isReady)), skeletonVisible: showPoseOverlay, highlightActive })
  const blocking = mode === 'idle' || mode === 'error' || mode === 'requesting_permission' || mode === 'model_loading'
  const loading = mode === 'requesting_permission' || mode === 'model_loading'
  const outOfFrame = errors.some((item) => item.code === 'BODY_OUT_OF_FRAME' || item.code === 'POSE_LOW_CONFIDENCE')
  const status = mode === 'demo' ? '演示模式' : mode === 'live' ? '摄像头已连接 · AI 识别中' : mode === 'requesting_permission' ? '等待摄像头授权' : mode === 'model_loading' ? '正在加载识别模型' : mode === 'error' ? (failure ? FAILURE_STATUS[failure.kind] : '摄像头无法启动') : '摄像头未开启'
  const blockingTitle = mode === 'requesting_permission' ? '正在等待摄像头授权…' : mode === 'model_loading' ? '正在加载姿态识别模型…' : mode === 'error' ? '暂时无法开始识别' : '开启摄像头开始训练'
  // One line under the picture, by priority: start gesture, preparation, out of frame, then the page's coaching line.
  const message = gesturePrompt && capturing ? (
    <div className="imm-toast" data-tone="info" role="status" data-testid="gesture-control">
      <span className="imm-toast-bar" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-pretty font-bold">{gesturePrompt}</p>
        {gestureHolding ? (
          <div className="mt-1.5 flex items-center gap-3 text-xs font-semibold text-sky-200" data-testid="gesture-hold-progress">
            <progress className="h-1.5 flex-1 accent-sky-300" max={1} value={gestureProgress} aria-label="手势保持进度" />
            <span className="min-w-14 tabular-nums">保持中… {Math.round(gestureProgress * 100)}%</span>
          </div>
        ) : null}
      </div>
    </div>
  ) : preparationMessage && capturing ? (
    <div className="imm-toast" data-tone="info" role="status" data-testid="preparation-state"><span className="imm-toast-bar" aria-hidden="true" /><p className="min-w-0 flex-1 text-pretty font-bold">{preparationMessage}</p></div>
  ) : outOfFrame && capturing ? (
    <div className="imm-toast" data-tone="warning" role="status" data-testid="camera-out-of-frame"><span className="imm-toast-bar" aria-hidden="true" /><p className="min-w-0 flex-1 text-pretty font-bold">{outOfFrameMessage}</p></div>
  ) : guidance
  return (
    <section className={cn('imm-panel', className)} aria-labelledby="camera-title" data-testid="camera-panel" data-variant="immersive">
      <div className="imm-panel-head">
        <h2 id="camera-title" className="imm-chip shrink-0"><ScanLine size={14} aria-hidden="true" />{title}<span className="imm-hide-sm text-slate-400">· 镜像</span></h2>
        <span className="imm-chip imm-hide-md" data-camera-status={mode}><i className={cn('size-2 rounded-full', capturing ? 'bg-emerald-300' : mode === 'error' ? 'bg-coral-500' : loading ? 'bg-amber-300' : 'bg-slate-500')} aria-hidden="true" />{status}</span>
        {framingAssist && capturing ? (
          <span className={cn('imm-chip max-w-[46%] truncate', framingAssist.status === 'READY' ? 'imm-chip-good' : 'imm-chip-warn')} role="status" data-testid="framing-status" data-framing-profile={framingAssist.profile}>{framingAssist.primaryHint}</span>
        ) : null}
        <span className="ml-auto flex min-w-0 items-center gap-2">
          {headerExtra}
          {framingAvailable ? (
            <button
              type="button"
              className="imm-chip imm-chip-button"
              aria-pressed={autoFraming}
              onClick={() => setAutoFraming((value) => !value)}
              title={autoFraming ? '按人体自动放大画面；四肢始终留在画面内' : '显示摄像头完整画面'}
              data-testid="camera-framing-toggle"
            >
              {autoFraming ? <ScanSearch size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}<span className="imm-hide-sm">{autoFraming ? '自动取景' : '完整画面'}</span>
            </button>
          ) : null}
        </span>
      </div>

      <div ref={framing.stageRef} className="imm-stage" style={stageStyle} data-testid="camera-stage" data-stage-height="matched" data-framing-mode="full" data-framing-scale="1.00" data-framing-available={framingAvailable ? 'true' : 'false'}>
        <div ref={framing.layerRef} className="imm-layer">
          {mode === 'demo' ? (
            demoFrameSrc ? (
              <img ref={demoImageRef} src={demoFrameSrc} alt={demoAsset.alt} className={demoAsset.fit === 'contain' ? 'size-full object-contain' : 'size-full object-cover'} data-demo-source="real-image-sequence" />
            ) : (
              <picture className="block size-full">
                <source media="(min-width: 768px)" srcSet={demoAsset.landscapeSrc} />
                <img ref={demoImageRef} src={demoAsset.portraitSrc} alt={demoAsset.alt} className={demoAsset.fit === 'contain' ? 'size-full object-contain' : 'size-full object-cover'} data-demo-source="real-static-image" />
              </picture>
            )
          ) : (
            <video ref={videoRef} muted playsInline className="size-full scale-x-[-1] object-contain" />
          )}
          <PoseOverlay ref={framing.innerRef} visible={showPoseOverlay || highlightActive} highlight={highlightActive ? highlight : undefined} highlightOnly={!showPoseOverlay} />
        </div>
        {blocking ? (
          <div className="imm-blocking">
            <div className="flex min-h-full flex-col items-center justify-center">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/10 text-sky-200">{loading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Camera aria-hidden="true" />}</span>
              <p className="mt-4 font-semibold text-white">{blockingTitle}</p>
              {mode === 'error' ? (
                failure ? (
                  <div className="mt-3 w-full rounded-2xl bg-white p-4 text-slate-800"><CameraFailureNotice failure={failure} onRetry={onStart} /></div>
                ) : (
                  <button type="button" onClick={onStart} className="imm-primary mt-5">重新检测</button>
                )
              ) : (
                <>
                  <p className="mt-1 text-pretty text-sm text-slate-300">{mode === 'requesting_permission' ? (isDesktopApp() ? '正在打开摄像头，请稍候。' : '请在浏览器提示中允许访问摄像头。') : mode === 'model_loading' ? '首次加载可能需要几秒钟。' : '站到离屏幕约 2.5 米处，让全身完整入镜。'}</p>
                  {mode === 'idle' ? <button type="button" onClick={onStart} className="imm-primary mt-5">启用摄像头</button> : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="imm-guidance" data-testid="camera-guidance">
        {capturing ? <CameraCountdown course={course} variant="band" fallback={message} /> : message}
      </div>
    </section>
  )
}

/** The single coaching line under the picture: one message, one tone, an optional second line. */
export function CoachToast({ message, detail, tone, label, testId = 'coach-toast' }: { message: string; detail?: string; tone: 'neutral' | 'info' | 'success' | 'warning'; label?: string; testId?: string }) {
  return (
    <div className="imm-toast" data-tone={tone} data-testid={testId}>
      <span className="imm-toast-bar" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-pretty font-bold" role="status" aria-live="polite" aria-atomic="true">{message}</p>
        {detail ? <p className="mt-0.5 line-clamp-1 text-xs text-slate-300">{detail}</p> : null}
      </div>
      {label ? <span className="shrink-0 text-xs font-semibold text-slate-400">{label}</span> : null}
    </div>
  )
}
