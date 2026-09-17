import { Camera, LoaderCircle, ScanLine } from 'lucide-react'
import type { RefObject } from 'react'
import type { CameraFailureKind } from '../../adapters/camera/BrowserCameraAdapter'
import type { MotionError } from '../../features/exercises/types'
import type { FeedbackEvent } from '../../features/feedback/types'
import type { PoseOverlayHandle } from '../pose/PoseOverlay'
import { PoseOverlay } from '../pose/PoseOverlay'

interface CameraPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>
  demoImageRef: RefObject<HTMLImageElement | null>
  overlayRef: RefObject<PoseOverlayHandle | null>
  mode: 'idle' | 'requesting_permission' | 'model_loading' | 'live' | 'demo' | 'error'
  errorMessage?: string
  errorKind?: CameraFailureKind
  errors: ReadonlyArray<MotionError>
  feedback?: FeedbackEvent
  demoAsset: { portraitSrc: string; landscapeSrc: string; alt: string; fit?: 'cover' | 'contain' }
  demoFrameSrc?: string
  preparationMessage?: string
  outOfFrameMessage: string
  onStart: () => void
}

export function CameraPanel({ videoRef, demoImageRef, overlayRef, mode, errorMessage, errorKind, errors, feedback, demoAsset, demoFrameSrc, preparationMessage, outOfFrameMessage, onStart }: CameraPanelProps) {
  const status = mode === 'demo' ? '演示模式' : mode === 'live' ? '摄像头已连接 · AI 实时分析中' : mode === 'requesting_permission' ? '等待摄像头授权' : mode === 'model_loading' ? '正在加载识别模型' : mode === 'error' ? '连接异常' : '等待连接摄像头'
  const blocking = ['idle', 'error', 'requesting_permission', 'model_loading'].includes(mode)
  const loading = mode === 'requesting_permission' || mode === 'model_loading'
  const title = mode === 'requesting_permission' ? '正在等待摄像头授权…' : mode === 'model_loading' ? '正在加载姿态识别模型…' : mode === 'error' ? '暂时无法开始识别' : '准备开始实时动作检测'
  return (
    <section className="panel flex min-h-0 min-w-0 flex-col p-3" aria-labelledby="camera-title">
      <div className="flex h-12 items-center gap-2 px-2">
        <span className="grid size-8 place-items-center rounded-xl bg-blue-50 text-blue-600"><ScanLine size={19} /></span>
        <h2 id="camera-title" className="font-bold text-slate-900">实时动作检测</h2>
        <span className="ml-auto hidden items-center gap-1.5 text-xs text-slate-500 sm:inline-flex"><i className={mode === 'live' || mode === 'demo' ? 'size-2 rounded-full bg-emerald-400' : mode === 'error' ? 'size-2 rounded-full bg-coral-500' : loading ? 'size-2 rounded-full bg-amber-400' : 'size-2 rounded-full bg-slate-300'} />{status}</span>
      </div>
      <div className="camera-stage relative min-h-[380px] flex-1 overflow-hidden rounded-2xl bg-slate-100">
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
        <PoseOverlay ref={overlayRef} />
        {mode === 'live' || mode === 'demo' ? <span className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-xl bg-slate-900/65 px-3 py-2 text-xs font-medium text-white"><ScanLine size={15} />AI 识别中</span> : null}
        {preparationMessage && (mode === 'demo' || mode === 'live') ? (
          <div className="absolute inset-x-4 top-16 rounded-xl bg-white/95 px-4 py-3 text-center text-lg font-bold text-blue-700 shadow-sm sm:text-xl" role="status" data-testid="preparation-state">
            {preparationMessage}
          </div>
        ) : null}
        {feedback ? (
          <div className={feedback.kind === 'recovery' ? 'correction-badge success' : 'correction-badge'} role="status">
            <span className="grid size-5 place-items-center rounded-full bg-current/10">!</span>{feedback.message}
          </div>
        ) : null}
        {blocking ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-50/92 p-6 text-center">
            <div>
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-blue-50 text-blue-600">{loading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Camera />}</span>
              <p className="mt-4 font-semibold text-slate-800">{title}</p>
              <p className="mt-1 text-pretty text-sm text-slate-500">{mode === 'requesting_permission' ? '请在浏览器提示中允许访问摄像头。' : mode === 'model_loading' ? '首次加载可能需要几秒钟。' : errorKind === 'permission_denied' ? '如已拒绝授权，请在地址栏的网站权限中重新允许摄像头。' : '请站在摄像头前，按提示调整距离。'}</p>
              {errorMessage ? <p className="mt-3 text-sm text-coral-600">{errorMessage}</p> : null}
              {mode === 'idle' || mode === 'error' ? <button type="button" onClick={onStart} className="primary-button mt-5">{mode === 'error' ? '重新尝试' : '启用摄像头'}</button> : null}
            </div>
          </div>
        ) : null}
        {errors.some((item) => item.code === 'BODY_OUT_OF_FRAME' || item.code === 'POSE_LOW_CONFIDENCE') ? (
          <div className="absolute inset-x-4 bottom-4 rounded-xl bg-white/95 px-4 py-3 text-center text-lg font-bold text-coral-600 shadow-sm sm:text-xl">{outOfFrameMessage}</div>
        ) : null}
      </div>
    </section>
  )
}
