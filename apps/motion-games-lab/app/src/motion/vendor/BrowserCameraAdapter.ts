// Copied from FormPilot_v3: src/adapters/camera/BrowserCameraAdapter.ts (commit 9cf6c24, 2026-10-02).
// Lab changes: the FormPilot desktop diagnostics bridge is replaced by an optional onFallback callback;
// user-facing guidance no longer mentions FormPilot. Constraints and fallback order are unchanged.


export interface CameraAdapter {
  start(video: HTMLVideoElement): Promise<MediaStream>
  stop(video?: HTMLVideoElement): void
}

export type CameraFailureKind =
  | 'permission_denied'
  | 'not_found'
  | 'in_use'
  | 'constraint_failed'
  | 'security'
  | 'unsupported'
  | 'unknown_error'
  | 'model_error'

/** 首选参数；摄像头不支持时再用普通参数请求一次 */
export const PREFERRED_CAMERA_CONSTRAINTS: MediaTrackConstraints = Object.freeze({
  facingMode: 'user',
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, min: 20 },
})

/** 这些错误可用普通参数重试；权限和无设备错误不重试 */
const RETRY_WITH_BASIC: ReadonlySet<string> = new Set(['OverconstrainedError', 'NotReadableError', 'AbortError', 'TypeError'])

export interface CameraAttempt {
  request: 'preferred' | 'basic'
  ok: boolean
  errorName?: string
  errorMessage?: string
  /** OverconstrainedError 时无法满足的约束 */
  constraint?: string
}

export interface CameraStartInfo {
  attempts: CameraAttempt[]
  settings?: { width?: number; height?: number; frameRate?: number }
}

export class CameraStartError extends Error {
  constructor(
    readonly stage: 'unsupported' | 'getUserMedia' | 'play',
    readonly errorName: string,
    readonly errorMessage: string,
    readonly attempts: ReadonlyArray<CameraAttempt>,
  ) {
    super(`${stage}: ${errorName}`)
    this.name = 'CameraStartError'
  }
}

function errorName(error: unknown): string {
  if (error instanceof CameraStartError) return error.errorName
  return error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
}

function errorMessage(error: unknown): string {
  if (error instanceof CameraStartError) return error.errorMessage
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error ?? '')
  return message.replace(/\s+/g, ' ').trim().slice(0, 300)
}

function attemptOf(request: CameraAttempt['request'], error: unknown): CameraAttempt {
  const constraint = error && typeof error === 'object' && 'constraint' in error ? String(error.constraint) : undefined
  return { request, ok: false, errorName: errorName(error), errorMessage: errorMessage(error), ...(constraint ? { constraint } : {}) }
}

export interface CameraErrorContext {
  /** 桌面版总允许本页面使用摄像头，被拒说明来自 Windows 设置 */
  desktop?: boolean
  systemBlocked?: boolean
}

export interface CameraErrorPresentation {
  kind: Exclude<CameraFailureKind, 'model_error'>
  message: string
  guidance: string
  /** 需在 Windows 设置 → 隐私和安全性 → 相机 中开启 */
  windowsPrivacy: boolean
}

const WINDOWS_PRIVACY_STEPS = '打开 Windows 设置 → 隐私和安全性 → 相机（摄像头），开启“相机访问”和“允许桌面应用访问相机”，然后点“重新检测”。'

export function cameraErrorPresentation(error: unknown, context: CameraErrorContext = {}): CameraErrorPresentation {
  const name = errorName(error)
  const stage = error instanceof CameraStartError ? error.stage : 'getUserMedia'
  if (stage === 'unsupported') {
    return { kind: 'unsupported', message: '当前环境不支持摄像头访问。', guidance: '请在电脑上的 Edge 或 Chrome 浏览器中打开。', windowsPrivacy: false }
  }
  if (stage === 'getUserMedia') {
    const systemDenied = context.systemBlocked === true || (name === 'NotAllowedError' && (context.desktop === true || /system/i.test(errorMessage(error))))
    if (systemDenied) {
      return { kind: 'permission_denied', message: '摄像头权限未开启。请在 Windows 设置中允许桌面应用访问摄像头，然后重新尝试。', guidance: WINDOWS_PRIVACY_STEPS, windowsPrivacy: true }
    }
    if (name === 'NotAllowedError') {
      return { kind: 'permission_denied', message: '摄像头权限未开启。请在浏览器的网站权限中允许摄像头，然后重新尝试。', guidance: '点地址栏左侧的网站信息图标，把“摄像头”改为允许，然后点“重新检测”。', windowsPrivacy: false }
    }
    if (name === 'SecurityError') {
      return { kind: 'security', message: '摄像头被安全设置阻止，当前页面不能使用摄像头。', guidance: '请通过 http://127.0.0.1 或 https 地址打开本页面。', windowsPrivacy: false }
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return { kind: 'not_found', message: '未检测到可用摄像头，请确认设备已连接。', guidance: '外接摄像头请重新插拔；笔记本请确认摄像头开关或快捷键已打开，然后点“重新检测”。', windowsPrivacy: false }
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return { kind: 'in_use', message: '摄像头当前无法读取，可能正在被其他应用占用。', guidance: '关闭视频会议、录屏或浏览器里正在使用摄像头的页面后，点“重新检测”。', windowsPrivacy: false }
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return { kind: 'constraint_failed', message: '当前摄像头不支持所需的视频参数，已尝试兼容设置，仍无法打开。', guidance: '请重新连接摄像头后点“重新检测”；仍然不行请换一个摄像头试试。', windowsPrivacy: false }
    }
  }
  return { kind: 'unknown_error', message: '无法启动摄像头，请检查设备连接后重试。', guidance: '点“重新检测”再试一次；仍然不行请重启浏览器。', windowsPrivacy: false }
}

export class BrowserCameraAdapter implements CameraAdapter {
  private stream?: MediaStream

  constructor(private readonly onFallback?: (attempts: ReadonlyArray<CameraAttempt>) => void) {}
  lastStart: CameraStartInfo = { attempts: [] }

  async start(video: HTMLVideoElement): Promise<MediaStream> {
    this.stop()
    const attempts: CameraAttempt[] = []
    this.lastStart = { attempts }
    if (!navigator.mediaDevices?.getUserMedia) throw new CameraStartError('unsupported', 'NotSupportedError', 'navigator.mediaDevices.getUserMedia is unavailable', attempts)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: PREFERRED_CAMERA_CONSTRAINTS, audio: false })
      attempts.push({ request: 'preferred', ok: true })
    } catch (preferredError) {
      attempts.push(attemptOf('preferred', preferredError))
      if (!RETRY_WITH_BASIC.has(errorName(preferredError))) throw new CameraStartError('getUserMedia', errorName(preferredError), errorMessage(preferredError), attempts)
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        attempts.push({ request: 'basic', ok: true })
      } catch (basicError) {
        attempts.push(attemptOf('basic', basicError))
        throw new CameraStartError('getUserMedia', errorName(basicError), errorMessage(basicError), attempts)
      }
    }
    this.stream = stream
    const settings = stream.getVideoTracks()[0]?.getSettings?.()
    if (settings) this.lastStart.settings = { width: settings.width, height: settings.height, frameRate: settings.frameRate }
    if (attempts.length > 1) this.onFallback?.(attempts)
    video.srcObject = stream
    try {
      await video.play()
    } catch (playError) {
      this.stop(video)
      throw new CameraStartError('play', errorName(playError), errorMessage(playError), attempts)
    }
    return stream
  }

  stop(video?: HTMLVideoElement): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = undefined
    if (video) video.srcObject = null
  }
}
