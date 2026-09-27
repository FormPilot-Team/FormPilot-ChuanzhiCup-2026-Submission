import { logDiagnostics } from '../../features/diagnostics/desktopBridge'

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

/** What FormPilot asks for first. A camera that cannot deliver it gets a second, plain request. */
export const PREFERRED_CAMERA_CONSTRAINTS: MediaTrackConstraints = Object.freeze({
  facingMode: 'user',
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, min: 20 },
})

/**
 * Failures a plainer request can get past: the camera exists and may be used, but refused the preferred mode
 * (resolution, 20 fps minimum) or failed to start in it. Permission and missing-device errors are final.
 */
const RETRY_WITH_BASIC: ReadonlySet<string> = new Set(['OverconstrainedError', 'NotReadableError', 'AbortError', 'TypeError'])

export interface CameraAttempt {
  request: 'preferred' | 'basic'
  ok: boolean
  errorName?: string
  errorMessage?: string
  /** OverconstrainedError: the constraint the camera could not meet. */
  constraint?: string
}

export interface CameraStartInfo {
  attempts: CameraAttempt[]
  /** What the camera delivers once it runs. */
  settings?: { width?: number; height?: number; frameRate?: number }
}

/** A failed start with where it failed and every request tried. */
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
  /** The packaged desktop app, which always lets its own page use the camera: a refusal there comes from Windows. */
  desktop?: boolean
  /** Windows camera privacy is off (reported by the desktop app). */
  systemBlocked?: boolean
}

export interface CameraErrorPresentation {
  kind: Exclude<CameraFailureKind, 'model_error'>
  /** One sentence: what is wrong. */
  message: string
  /** What the reviewer can do about it. */
  guidance: string
  /** Fixed in Windows Settings → 隐私和安全性 → 相机 (the desktop app offers a shortcut). */
  windowsPrivacy: boolean
}

const WINDOWS_PRIVACY_STEPS = '打开 Windows 设置 → 隐私和安全性 → 相机（摄像头），开启“相机访问”和“允许桌面应用访问相机”，然后点“重新检测”。'

export function cameraErrorPresentation(error: unknown, context: CameraErrorContext = {}): CameraErrorPresentation {
  const name = errorName(error)
  const stage = error instanceof CameraStartError ? error.stage : 'getUserMedia'
  if (stage === 'unsupported') {
    return { kind: 'unsupported', message: '当前环境不支持摄像头访问。', guidance: '请使用 FormPilot 桌面版，或在 Edge / Chrome 中打开。', windowsPrivacy: false }
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
      return { kind: 'security', message: '摄像头被安全设置阻止，当前页面不能使用摄像头。', guidance: '请从 FormPilot 应用内打开训练页面；仍然不行时点“查看诊断信息”并发给我们。', windowsPrivacy: false }
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return { kind: 'not_found', message: '未检测到可用摄像头，请确认设备已连接。', guidance: '外接摄像头请重新插拔；笔记本请确认摄像头开关或快捷键已打开，然后点“重新检测”。', windowsPrivacy: false }
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return { kind: 'in_use', message: '摄像头当前无法读取，可能正在被其他应用占用。', guidance: '关闭视频会议、录屏或浏览器里正在使用摄像头的页面后，点“重新检测”。', windowsPrivacy: false }
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return { kind: 'constraint_failed', message: '当前摄像头不支持所需的视频参数，FormPilot 已尝试兼容设置，仍无法打开。', guidance: '请重新连接摄像头后点“重新检测”；仍然不行时点“查看诊断信息”并发给我们。', windowsPrivacy: false }
    }
  }
  return { kind: 'unknown_error', message: '无法启动摄像头，请检查设备连接后重试。', guidance: '点“重新检测”再试一次；仍然不行时点“查看诊断信息”，把内容发给我们。', windowsPrivacy: false }
}

export class BrowserCameraAdapter implements CameraAdapter {
  private stream?: MediaStream
  /** The requests of the latest start, successful or not (diagnostics). */
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
    if (attempts.length > 1) logDiagnostics('camera-fallback', { attempts, settings: this.lastStart.settings ?? null })
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
