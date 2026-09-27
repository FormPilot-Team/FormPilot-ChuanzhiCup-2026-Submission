import { CameraStartError, cameraErrorPresentation, type CameraAttempt, type CameraFailureKind } from '../../adapters/camera/BrowserCameraAdapter'
import { appVersionLabel, desktopInfo, isDesktopApp, systemCameraAccess, type DesktopInfo, type SystemCameraAccess } from '../diagnostics/desktopBridge'
import { errorText, formatBytes, type DiagnosticsRow } from '../diagnostics/diagnosticsReport'
import { PoseModelError, type PoseModelFailure } from '../pose/PoseDetector'

/** 检查设备: what this PC offers FormPilot. Device names and ids are never kept, only whether names are readable. */
export interface CameraDeviceCheck {
  videoInputs: number | null
  labelsAvailable: boolean | null
  permission: 'granted' | 'denied' | 'prompt' | 'unknown'
  system: SystemCameraAccess | null
  error: string | null
}

export async function checkCameraDevices(): Promise<CameraDeviceCheck> {
  let videoInputs: number | null = null
  let labelsAvailable: boolean | null = null
  let error: string | null = null
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const inputs = devices.filter((device) => device.kind === 'videoinput')
    videoInputs = inputs.length
    labelsAvailable = inputs.some((device) => device.label !== '')
  } catch (caught) {
    error = errorText(caught)
  }
  let permission: CameraDeviceCheck['permission'] = 'unknown'
  try {
    permission = (await navigator.permissions.query({ name: 'camera' as PermissionName })).state
  } catch {
    // Not every browser can query camera permission.
  }
  return { videoInputs, labelsAvailable, permission, system: await systemCameraAccess(), error }
}

const PERMISSION_TEXT: Readonly<Record<CameraDeviceCheck['permission'], string>> = { granted: '允许', denied: '拒绝', prompt: '尚未授权', unknown: '未知' }
const BLOCKER_TEXT: Readonly<Record<SystemCameraAccess['blockedBy'][number], string>> = {
  policy: '组策略禁止',
  device: '“相机访问”已关闭',
  apps: '“允许应用访问相机”已关闭',
  desktopApps: '“允许桌面应用访问相机”已关闭',
  system: 'Windows 拒绝桌面应用使用相机',
}

/** The three lines of 检查设备, plus the Windows line in the desktop app. */
export function deviceCheckLines(check: CameraDeviceCheck): DiagnosticsRow[] {
  const rows: DiagnosticsRow[] = [
    { label: '摄像头', value: check.videoInputs === null ? '未知' : check.videoInputs > 0 ? '已检测' : '未检测' },
    { label: '权限', value: PERMISSION_TEXT[check.permission] },
    { label: '视频输入', value: check.videoInputs === null ? '未知' : `${check.videoInputs} 个` },
  ]
  if (check.system) {
    rows.push({
      label: 'Windows 相机权限',
      value: check.system.verdict === 'blocked' ? `已关闭（${check.system.blockedBy.map((item) => BLOCKER_TEXT[item]).join('；')}）` : check.system.verdict === 'allowed' ? '已开启' : '未知',
    })
  }
  return rows
}

interface WebglInfo {
  webgl2: boolean
  renderer: string | null
}

function webglInfo(): WebglInfo {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return { webgl2: false, renderer: null }
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return { webgl2: true, renderer }
  } catch {
    return { webgl2: false, renderer: null }
  }
}

async function wasmStatus(): Promise<string> {
  try {
    const response = await fetch('/wasm/vision_wasm_internal.wasm', { method: 'HEAD', cache: 'no-store' })
    return `${response.status} · ${formatBytes(Number(response.headers.get('content-length')))}`
  } catch (error) {
    return `请求失败（${errorText(error)}）`
  }
}

export interface CameraFailureReport {
  stage: 'camera' | 'model'
  kind: CameraFailureKind
  message: string
  guidance: string
  windowsPrivacy: boolean
  /** The detailed half: filled in a moment after the failure (device check, Windows status, app version). */
  complete: boolean
  errorName: string | null
  errorMessage: string | null
  attempts: ReadonlyArray<CameraAttempt>
  cameraStage: CameraStartError['stage'] | null
  check: CameraDeviceCheck | null
  model: (PoseModelFailure & { webgl: WebglInfo; wasm: string }) | null
  app: string | null
  logPath: string | null
  origin: string
  secureContext: boolean
}

const MODEL_FAILURE = {
  message: '姿态识别模型加载失败，请重试。',
  guidance: '点“重新尝试”；仍然不行时点“查看诊断信息”，把内容发给我们。',
}

function baseReport(error: unknown, stage: 'camera' | 'model', systemBlocked?: boolean): CameraFailureReport {
  const cameraError = error instanceof CameraStartError ? error : null
  const presentation = stage === 'camera' ? cameraErrorPresentation(error, { desktop: isDesktopApp(), systemBlocked }) : null
  const named = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : null
  return {
    stage,
    kind: presentation?.kind ?? 'model_error',
    message: presentation?.message ?? MODEL_FAILURE.message,
    guidance: presentation?.guidance ?? MODEL_FAILURE.guidance,
    windowsPrivacy: presentation?.windowsPrivacy ?? false,
    complete: false,
    errorName: cameraError?.errorName ?? named,
    errorMessage: cameraError?.errorMessage ?? (error instanceof Error ? error.message.slice(0, 300) : null),
    attempts: cameraError?.attempts ?? [],
    cameraStage: cameraError?.stage ?? null,
    check: null,
    model: null,
    app: null,
    logPath: null,
    origin: typeof window === 'undefined' ? '' : window.location.origin,
    secureContext: typeof window === 'undefined' ? false : window.isSecureContext,
  }
}

/** Shown at once: the classification from the error alone. */
export function initialCameraFailure(error: unknown, stage: 'camera' | 'model'): CameraFailureReport {
  return baseReport(error, stage)
}

/** A moment later: device check, Windows camera privacy (which can re-classify the error), model and app details. */
export async function completeCameraFailure(error: unknown, stage: 'camera' | 'model'): Promise<CameraFailureReport> {
  const [check, info] = await Promise.all([checkCameraDevices(), desktopInfo()])
  const report = baseReport(error, stage, stage === 'camera' && check.system?.verdict === 'blocked')
  let model: CameraFailureReport['model'] = null
  if (stage === 'model') {
    const details: PoseModelFailure = error instanceof PoseModelError
      ? error.details
      : { stage: 'landmarker', modelAssetPath: '', modelStatus: null, modelBytes: null, gpuError: null, cpuError: errorText(error) }
    model = { ...details, webgl: webglInfo(), wasm: await wasmStatus() }
  }
  return withApp({ ...report, complete: true, check, model }, info)
}

function withApp(report: CameraFailureReport, info: DesktopInfo | null): CameraFailureReport {
  return { ...report, app: appVersionLabel(info), logPath: info?.logPath ?? null }
}

const KIND_LABEL: Readonly<Record<CameraFailureKind, string>> = {
  permission_denied: '权限被拒绝',
  not_found: '没有可用设备',
  in_use: '设备被占用或无法读取',
  constraint_failed: '视频参数不兼容',
  security: '安全限制',
  unsupported: '环境不支持摄像头',
  unknown_error: '其他错误',
  model_error: '姿态识别模型加载失败',
}

function attemptText(attempt: CameraAttempt): string {
  const request = attempt.request === 'preferred' ? '首选参数（1280×720 · 30 fps，至少 20 fps）' : '兼容参数（video: true）'
  if (attempt.ok) return `${request} → 成功`
  return `${request} → ${attempt.errorName || '失败'}${attempt.constraint ? `（${attempt.constraint}）` : ''}${attempt.errorMessage ? `：${attempt.errorMessage}` : ''}`
}

export function cameraFailureRows(report: CameraFailureReport): DiagnosticsRow[] {
  const rows: DiagnosticsRow[] = [{ label: '问题类型', value: `${KIND_LABEL[report.kind]}${report.errorName ? ` · ${report.errorName}` : ''}` }]
  if (report.errorMessage) rows.push({ label: '错误信息', value: report.errorMessage })
  if (report.cameraStage === 'play') rows.push({ label: '失败环节', value: '摄像头已打开，画面无法开始播放（video.play）' })
  if (report.attempts.length > 0) rows.push({ label: '摄像头请求', value: report.attempts.map(attemptText).join('；') })
  if (report.check) {
    for (const row of deviceCheckLines(report.check)) rows.push(row)
    if (report.check.labelsAvailable !== null) rows.push({ label: '设备名称', value: report.check.labelsAvailable ? '可读取（已授权）' : '不可读取（尚未授权）' })
    if (report.check.error) rows.push({ label: '设备枚举', value: report.check.error })
  }
  if (report.model) {
    const { model } = report
    rows.push({ label: '模型文件', value: `${model.modelAssetPath || '未知'} → ${model.modelStatus ?? '请求失败'}${model.modelBytes ? ` · ${formatBytes(model.modelBytes)}` : ''}` })
    rows.push({ label: 'WASM', value: `/wasm/vision_wasm_internal.wasm → ${model.wasm}` })
    rows.push({ label: 'WebGL2', value: model.webgl.webgl2 ? `可用 · ${model.webgl.renderer ?? '未知显卡'}` : '不可用' })
    if (model.gpuError) rows.push({ label: 'GPU 推理', value: model.gpuError })
    if (model.cpuError) rows.push({ label: 'CPU 推理', value: model.cpuError })
  }
  rows.push({ label: '页面', value: `${report.origin}${report.secureContext ? ' · 安全上下文' : ' · 非安全上下文'}` })
  if (report.app) rows.push({ label: '应用版本', value: report.app })
  if (report.logPath) rows.push({ label: '诊断日志', value: report.logPath })
  return rows
}

/** The diagnostics-log entry: no pictures, no pose frames, no device names or ids. */
export function cameraFailureLog(report: CameraFailureReport): Record<string, unknown> {
  return {
    route: typeof window === 'undefined' ? '' : window.location.pathname,
    failure: report.kind,
    errorName: report.errorName,
    errorMessage: report.errorMessage,
    cameraStage: report.cameraStage,
    attempts: report.attempts,
    videoInputs: report.check?.videoInputs ?? null,
    labelsAvailable: report.check?.labelsAvailable ?? null,
    permission: report.check?.permission ?? null,
    windowsCamera: report.check?.system ? { verdict: report.check.system.verdict, blockedBy: report.check.system.blockedBy, electronStatus: report.check.system.electronStatus, switches: report.check.system.windows } : null,
    model: report.model,
    origin: report.origin,
    secureContext: report.secureContext,
  }
}
