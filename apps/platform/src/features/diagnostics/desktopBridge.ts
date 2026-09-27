/**
 * The desktop wrapper's bridge (reviewer_exe/src/preload.cjs). Present only in the packaged Windows app; in a browser
 * every call degrades to "unknown" and diagnostics stay on the page.
 */

export interface DesktopGpuSummary {
  videoDecode: string | null
  webgl: string | null
  gpuCompositing: string | null
  renderer: string | null
  devices: ReadonlyArray<{ vendorId: string | null; deviceId: string | null; active: boolean; driverVersion: string | null }>
}

export interface DesktopInfo {
  appVersion: string
  electron: string
  chrome: string
  os: string
  /** %APPDATA%\AI电子教练评审版\logs\media-diagnostics.log */
  logPath: string
  /** 'software' once the wrapper pins video decoding to the bundled FFmpeg. */
  videoDecoding: 'software' | null
  gpu: DesktopGpuSummary
}

export type WindowsConsent = 'allow' | 'deny' | 'unset' | 'unknown'

export interface SystemCameraAccess {
  /** Electron's systemPreferences.getMediaAccessStatus('camera'): Windows' desktop-app camera consent. */
  electronStatus: string
  windows: { device: WindowsConsent; apps: WindowsConsent; desktopApps: WindowsConsent; policy: string } | null
  verdict: 'allowed' | 'blocked' | 'unknown'
  blockedBy: ReadonlyArray<'policy' | 'device' | 'apps' | 'desktopApps' | 'system'>
}

interface DesktopBridge {
  info(): Promise<DesktopInfo | null>
  log(kind: string, entry: Record<string, unknown>): void
  cameraAccess(): Promise<SystemCameraAccess | null>
  openCameraSettings(): Promise<boolean>
}

type BridgeWindow = typeof window & { formpilotDesktop?: DesktopBridge; __formpilotDiagnostics?: DiagnosticsLogEntry[] }

export interface DiagnosticsLogEntry {
  kind: string
  at: string
  entry: Record<string, unknown>
}

function bridge(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as BridgeWindow).formpilotDesktop
}

export function isDesktopApp(): boolean {
  return Boolean(bridge())
}

let infoPromise: Promise<DesktopInfo | null> | undefined

/** Cached for the page's lifetime; null in a browser or if the wrapper does not answer. */
export function desktopInfo(): Promise<DesktopInfo | null> {
  const desktop = bridge()
  if (!desktop) return Promise.resolve(null)
  infoPromise ??= desktop.info().catch(() => null)
  return infoPromise
}

export async function systemCameraAccess(): Promise<SystemCameraAccess | null> {
  const desktop = bridge()
  if (!desktop) return null
  try {
    return await desktop.cameraAccess()
  } catch {
    return null
  }
}

/** Opens Windows Settings → 隐私和安全性 → 相机. False outside the desktop app. */
export async function openCameraPrivacySettings(): Promise<boolean> {
  const desktop = bridge()
  if (!desktop) return false
  try {
    return await desktop.openCameraSettings()
  } catch {
    return false
  }
}

const RECENT_LIMIT = 30
const recent: DiagnosticsLogEntry[] = []

/**
 * Records a diagnostics event: written to logs/media-diagnostics.log by the desktop app, and kept in memory for the
 * page (DEV builds expose it as window.__formpilotDiagnostics). Never holds camera pictures or pose frames.
 */
export function logDiagnostics(kind: string, entry: Record<string, unknown>): void {
  const record: DiagnosticsLogEntry = { kind, at: new Date().toISOString(), entry }
  recent.push(record)
  if (recent.length > RECENT_LIMIT) recent.shift()
  if (import.meta.env.DEV && typeof window !== 'undefined') (window as BridgeWindow).__formpilotDiagnostics = recent
  try {
    bridge()?.log(kind, entry)
  } catch {
    // The log is best effort.
  }
}

export function recentDiagnostics(): ReadonlyArray<DiagnosticsLogEntry> {
  return recent
}

/** "FormPilot 评审版 1.0.6 · Electron 44.3.0 / Chromium …" in the desktop app, "浏览器版" elsewhere. */
export function appVersionLabel(info: DesktopInfo | null): string {
  return info ? `FormPilot 评审版 ${info.appVersion}（Electron ${info.electron} / Chromium ${info.chrome}）` : `浏览器版（${import.meta.env.MODE}）`
}
