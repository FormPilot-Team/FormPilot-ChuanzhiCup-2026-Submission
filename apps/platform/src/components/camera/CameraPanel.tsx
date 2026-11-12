import { Camera, LoaderCircle, ScanLine } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import type { CameraFailureReport } from '../../features/camera/cameraDiagnostics'
import type { CourseSnapshot } from '../../features/course/CourseController'
import { isDesktopApp } from '../../features/diagnostics/desktopBridge'
import type { MotionError } from '../../features/exercises/types'
import type { FeedbackEvent } from '../../features/feedback/types'
import type { FramingAssistState } from '../../features/framing/FramingAssist'
import { cn } from '../../lib/cn'
import type { PoseOverlayHandle } from '../pose/PoseOverlay'
import { PoseOverlay } from '../pose/PoseOverlay'
import { CameraCountdown } from './CameraCountdown'
import { CameraFailureNotice } from './CameraFailureNotice'
import { FAILURE_STATUS } from './cameraStatus'

interface CameraPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>
  demoImageRef: RefObject<HTMLImageElement | null>
  overlayRef: RefObject<PoseOverlayHandle | null>
  mode: 'idle' | 'requesting_permission' | 'model_loading' | 'live' | 'demo' | 'error'
  /** Why the camera or the pose model did not start (mode 'error'). */
  failure?: CameraFailureReport
  errors: ReadonlyArray<MotionError>
  feedback?: FeedbackEvent
  demoAsset: { portraitSrc: string; landscapeSrc: string; alt: string; fit?: 'cover' | 'contain' }
  demoFrameSrc?: string
  preparationMessage?: string
  gesturePrompt?: string
  gestureProgress?: number
  gestureHolding?: boolean
  outOfFrameMessage: string
  showPoseOverlay?: boolean
  framingAssist?: FramingAssistState
  /** `compact` sizes the stage to the camera's native 16:9 viewport without changing the recognition input. */
  variant?: 'default' | 'compact'
  /**
   * Compact only: a fixed stage height in px, so the camera box matches the demonstration video beside it. The feed
   * keeps `object-contain` inside it (a slightly different shape shows a neutral surface, never a cropped body).
   */
  stageHeight?: number
  /** The course's state and countdown: drives the large 3-2-1 → 开始 in the middle of the picture. */
  course?: Pick<CourseSnapshot, 'state' | 'countdown'>
  /** Visible panel heading; routine training uses “我的画面” while other training modes keep the default. */
  title?: string
  /** Shown under the stage (routine training: framing requirement and recognition status). */
  footer?: ReactNode
  onStart: () => void
}


export function CameraPanel({ videoRef, demoImageRef, overlayRef, mode, failure, errors, feedback, demoAsset, demoFrameSrc, preparationMessage, gesturePrompt, gestureProgress = 0, gestureHolding = false, outOfFrameMessage, showPoseOverlay = true, framingAssist, variant = 'default', stageHeight, course, title: panelTitle = '实时动作检测', footer, onStart }: CameraPanelProps) {
  const compact = variant === 'compact'
  const promptText = compact ? 'text-base' : 'text-lg sm:text-xl'
  const status = mode === 'demo' ? '演示模式' : mode === 'live' ? '摄像头已连接 · AI 实时分析中' : mode === 'requesting_permission' ? '等待摄像头授权' : mode === 'model_loading' ? '正在加载识别模型' : mode === 'error' ? (failure ? FAILURE_STATUS[failure.kind] : '摄像头无法启动') : '等待连接摄像头'
  const blocking = ['idle', 'error', 'requesting_permission', 'model_loading'].includes(mode)
  const loading = mode === 'requesting_permission' || mode === 'model_loading'
  const title = mode === 'requesting_permission' ? '正在等待摄像头授权…' : mode === 'model_loading' ? '正在加载姿态识别模型…' : mode === 'error' ? '暂时无法开始识别' : '准备开始实时动作检测'
  return (
    <section className="panel flex min-h-0 min-w-0 flex-col p-3" aria-labelledby="camera-title" data-testid="camera-panel" data-variant={variant}>
      {/* The compact header is as tall as the demonstration video's header, so both pictures start on one line. */}
      <div className={compact ? 'flex min-h-12 items-center gap-2 px-2 pb-2' : 'flex h-12 items-center gap-2 px-2'}>
        <span className="grid size-8 place-items-center rounded-xl bg-blue-50 text-blue-600"><ScanLine size={19} aria-hidden="true" /></span>
        <h2 id="camera-title" className="font-bold text-slate-900">{panelTitle}</h2>
        <span className="ml-auto hidden items-center gap-1.5 text-xs text-slate-500 sm:inline-flex"><i className={mode === 'live' || mode === 'demo' ? 'size-2 rounded-full bg-emerald-400' : mode === 'error' ? 'size-2 rounded-full bg-coral-500' : loading ? 'size-2 rounded-full bg-amber-400' : 'size-2 rounded-full bg-slate-300'} />{status}</span>
      </div>
      {/* A compact stage keeps the camera's 16:9 picture, or the height it is given to match the video beside it; with no
          picture to show (a failure) it grows to fit the notice. Letterboxing is a neutral surface, never black. */}
      <div
        className={compact ? cn('relative w-full overflow-hidden rounded-2xl bg-slate-100', mode === 'error' ? 'min-h-[400px]' : stageHeight ? undefined : 'aspect-video') : 'camera-stage relative min-h-[380px] flex-1 overflow-hidden rounded-2xl bg-slate-100'}
        style={compact && stageHeight && mode !== 'error' ? { height: stageHeight } : undefined}
        data-testid="camera-stage"
        data-stage-height={compact && stageHeight && mode !== 'error' ? 'matched' : 'own'}
      >
        {mode === 'demo' ? (
          demoFrameSrc ? (
            <img ref={demoImageRef} src={demoFrameSrc} alt={demoAsset.alt} className={demoAsset.fit === 'contain' ? 'size-full object-contain object-center' : 'size-full object-cover object-center'} data-demo-source="real-image-sequence" />
          ) : (
            <picture className="block size-full">
              <source media="(min-width: 768px)" srcSet={demoAsset.landscapeSrc} />
              <img ref={demoImageRef} src={demoAsset.portraitSrc} alt={demoAsset.alt} className={demoAsset.fit === 'contain' ? 'size-full object-contain object-center' : 'size-full object-cover object-center'} data-demo-source="real-static-image" />
            </picture>
          )
        ) : (
          <video ref={videoRef} muted playsInline className="size-full scale-x-[-1] object-contain" />
        )}
        <PoseOverlay ref={overlayRef} visible={showPoseOverlay} />
        {/* No safe-zone frame: recognition uses the whole camera picture, and a drawn box (over the letterbox too) made
            people think they had to stand inside it. Framing Assist speaks through the status chip and edge warnings. */}
        {mode === 'live' || mode === 'demo' ? <span className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-xl bg-slate-900/65 px-3 py-2 text-xs font-medium text-white"><ScanLine size={15} />AI 识别中</span> : null}
        {framingAssist && (mode === 'live' || mode === 'demo') ? (
          <span
            className={cn('absolute right-4 top-4 max-w-[58%] truncate rounded-xl px-3 py-2 text-xs font-semibold shadow-sm', framingAssist.status === 'READY' ? 'bg-emerald-50/95 text-emerald-700' : framingAssist.status === 'TOO_FAR' ? 'bg-white/95 text-blue-700' : 'bg-amber-50/95 text-amber-800')}
            role="status"
            data-testid="framing-status"
            data-framing-profile={framingAssist.profile}
          >
            {framingAssist.primaryHint}
          </span>
        ) : null}
        {preparationMessage && (mode === 'demo' || mode === 'live') ? (
          <div className={`absolute inset-x-4 ${compact ? 'top-12' : 'top-16'} rounded-xl bg-white/95 px-4 py-3 text-center text-pretty ${promptText} font-bold text-blue-700 shadow-sm`} role="status" data-testid="preparation-state">
            {preparationMessage}
          </div>
        ) : null}
        {gesturePrompt && (mode === 'demo' || mode === 'live') ? (
          <div className={`absolute inset-x-4 ${compact ? 'top-12' : 'top-16'} rounded-xl bg-white/95 px-4 py-3 text-center shadow-sm`} role="status" data-testid="gesture-control">
            <p className={`text-pretty ${promptText} font-bold text-blue-700`}>{gesturePrompt}</p>
            {gestureHolding ? (
              <div className="mt-2 flex items-center gap-3 text-sm font-semibold text-blue-600" data-testid="gesture-hold-progress">
                <progress className="h-2 flex-1 accent-blue-600" max={1} value={gestureProgress} aria-label="手势保持进度" />
                <span className="min-w-14 tabular-nums">保持中… {Math.round(gestureProgress * 100)}%</span>
              </div>
            ) : null}
          </div>
        ) : null}
        {feedback ? (
          <div className={feedback.kind === 'recovery' ? 'correction-badge success' : 'correction-badge'} role="status">
            <span className="grid size-5 place-items-center rounded-full bg-current/10">!</span>{feedback.message}
          </div>
        ) : null}
        {mode === 'live' || mode === 'demo' ? <CameraCountdown course={course} /> : null}
        {blocking ? (
          <div className={cn('absolute inset-0 overflow-y-auto bg-slate-50/92 text-center', compact ? 'p-4' : 'p-6')}>
            <div className="flex min-h-full flex-col items-center justify-center">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600">{loading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Camera />}</span>
              <p className="mt-4 font-semibold text-slate-800">{title}</p>
              {mode === 'error' ? (
                failure ? (
                  <div className="mt-2 w-full"><CameraFailureNotice failure={failure} onRetry={onStart} /></div>
                ) : (
                  <button type="button" onClick={onStart} className="primary-button mt-5">重新检测</button>
                )
              ) : (
                <>
                  <p className="mt-1 text-pretty text-sm text-slate-500">{mode === 'requesting_permission' ? (isDesktopApp() ? '正在打开摄像头，请稍候。' : '请在浏览器提示中允许访问摄像头。') : mode === 'model_loading' ? '首次加载可能需要几秒钟。' : '请站在摄像头前，按提示调整距离。'}</p>
                  {mode === 'idle' ? <button type="button" onClick={onStart} className="primary-button mt-5">启用摄像头</button> : null}
                </>
              )}
            </div>
          </div>
        ) : null}
        {errors.some((item) => item.code === 'BODY_OUT_OF_FRAME' || item.code === 'POSE_LOW_CONFIDENCE') ? (
          <div className={`absolute inset-x-4 bottom-4 rounded-xl bg-white/95 px-4 py-3 text-center ${promptText} font-bold text-coral-600 shadow-sm`}>{outOfFrameMessage}</div>
        ) : null}
      </div>
      {footer}
    </section>
  )
}
