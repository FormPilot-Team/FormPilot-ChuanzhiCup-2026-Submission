'use strict'

const path = require('node:path')
const { app, BrowserWindow, Menu, ipcMain, session, shell, systemPreferences } = require('electron')
const { createDiagnosticsLog } = require('./diagnosticsLog.cjs')
const { decidePermissionCheck, decidePermissionRequest, isAppOrigin } = require('./permissions.cjs')
const { startStaticServer } = require('./staticServer.cjs')
const { readWindowsCameraPrivacy, summarizeCameraPrivacy } = require('./windowsCameraPrivacy.cjs')

app.setName('AI电子教练评审版')
app.setPath('userData', path.join(app.getPath('appData'), 'AI电子教练评审版'))
// 示范视频统一用内置 FFmpeg 软解，避开各机显卡驱动硬解的差异
app.commandLine.appendSwitch('disable-accelerated-video-decode')

const hasSingleInstanceLock = app.requestSingleInstanceLock()
let mainWindow = null
let localServer = null
let appOrigin = null
let diagnostics = null
let lastGpuSummary = null

const LOG_KIND = /^[a-z][a-z-]{1,39}$/

function isAllowedUrl(rawUrl) {
  if (!appOrigin) return false
  try {
    const target = new URL(rawUrl)
    return target.origin === appOrigin && (target.protocol === 'http:' || target.protocol === 'https:')
  } catch {
    return false
  }
}

function closeServer() {
  if (!localServer) return Promise.resolve()
  const server = localServer
  localServer = null
  return new Promise((resolve) => server.close(() => resolve()))
}

/** 打包后网页资源位于 app.asar.unpacked */
function appDistRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'app-dist')
    : path.join(__dirname, '..', 'app-dist')
}

function hex(value) {
  return typeof value === 'number' ? `0x${value.toString(16).padStart(4, '0')}` : null
}

/** 'complete' 时包含 WebGL 渲染器（姿态模型所用 GPU），页面加载后查询一次 */
async function gpuSummary(level = 'basic') {
  const status = app.getGPUFeatureStatus()
  const summary = { videoDecode: status.video_decode ?? null, webgl: status.webgl ?? null, gpuCompositing: status.gpu_compositing ?? null, renderer: null, devices: [] }
  try {
    const info = await app.getGPUInfo(level)
    summary.renderer = info?.auxAttributes?.glRenderer ?? null
    summary.devices = (info?.gpuDevice ?? []).map((device) => ({ vendorId: hex(device.vendorId), deviceId: hex(device.deviceId), active: Boolean(device.active), driverVersion: device.driverVersion ?? null }))
  } catch {
    // GPU 信息仅作参考
  }
  if (level === 'complete') lastGpuSummary = summary
  return summary
}

async function desktopInfo() {
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    os: `Windows ${process.getSystemVersion()} ${process.arch}`,
    logPath: diagnostics.path,
    videoDecoding: 'software',
    gpu: lastGpuSummary ?? await gpuSummary(),
  }
}

async function cameraAccess() {
  let electronStatus = 'unknown'
  try {
    electronStatus = systemPreferences.getMediaAccessStatus('camera')
  } catch {
    // 当前平台不支持
  }
  const windows = await readWindowsCameraPrivacy()
  return { electronStatus, windows, ...summarizeCameraPrivacy(windows, electronStatus) }
}

function fromAppPage(event) {
  return isAllowedUrl(event.senderFrame?.url ?? '')
}

function registerDesktopBridge() {
  ipcMain.handle('formpilot:diagnostics-info', (event) => (fromAppPage(event) ? desktopInfo() : null))
  ipcMain.handle('formpilot:camera-access', (event) => (fromAppPage(event) ? cameraAccess() : null))
  ipcMain.handle('formpilot:open-camera-settings', async (event) => {
    if (!fromAppPage(event) || process.platform !== 'win32') return false
    await shell.openExternal('ms-settings:privacy-webcam')
    return true
  })
  ipcMain.on('formpilot:diagnostics-log', (event, kind, entry) => {
    if (!fromAppPage(event) || typeof kind !== 'string' || !LOG_KIND.test(kind)) return
    const fields = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}
    void diagnostics.append(kind, { ...fields, source: 'page' })
  })
}

function registerPermissionPolicy() {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const granted = decidePermissionCheck(permission, requestingOrigin, details, appOrigin)
    if (!granted && permission === 'media') {
      void diagnostics.append('permission', {
        type: 'check',
        permission,
        mediaType: details?.mediaType ?? null,
        // 空 origin 或 about: 表示页面尚未加载
        requestingOrigin: String(requestingOrigin || details?.securityOrigin || '').slice(0, 80),
        appOrigin: isAppOrigin(requestingOrigin, appOrigin),
        granted,
      })
    }
    return granted
  })
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const granted = decidePermissionRequest(permission, details, webContents.getURL(), appOrigin)
    if (permission === 'media' || !granted) {
      void diagnostics.append('permission', {
        type: 'request',
        permission,
        mediaTypes: Array.isArray(details?.mediaTypes) ? details.mediaTypes : [],
        appOrigin: isAppOrigin(details?.securityOrigin || details?.requestingUrl || webContents.getURL(), appOrigin),
        granted,
      })
    }
    callback(granted)
  })
}

// 窗口图标与 EXE 一致，未打包运行时也显式设置
const windowIcon = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'icon.ico')
  : path.join(__dirname, '..', 'build', 'icon.ico')

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'AI 电子教练',
    icon: windowIcon,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault()
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    void diagnostics.append('process-gone', { type: 'renderer', reason: details.reason, exitCode: details.exitCode })
  })
  window.webContents.once('did-finish-load', () => {
    // GPU 进程启动后状态才稳定，每次启动记录一次
    setTimeout(() => { void gpuSummary('complete').then((gpu) => diagnostics.append('gpu', gpu)) }, 3000)
  })
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.loadURL(`${appOrigin}/`)
  return window
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  diagnostics = createDiagnosticsLog({
    directory: path.join(app.getPath('userData'), 'logs'),
    baseFields: () => ({ appVersion: app.getVersion() }),
  })

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    void diagnostics.append('process-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode, name: details.name ?? null })
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    void diagnostics.append('app-start', {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      os: `Windows ${process.getSystemVersion()} ${process.arch}`,
      packaged: app.isPackaged,
      videoDecoding: 'software',
    })
    const started = await startStaticServer(appDistRoot(), {
      onError: (details) => { void diagnostics.append('server-error', details) },
    })
    localServer = started.server
    appOrigin = started.origin

    registerPermissionPolicy()
    registerDesktopBridge()
    mainWindow = createWindow()
  }).catch((error) => {
    console.error('Reviewer app failed to start:', error)
    void diagnostics.append('app-start-failed', { message: String(error?.message ?? error), code: error?.code ?? null }).finally(() => app.quit())
  })

  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    if (localServer) localServer.close()
    localServer = null
  })
}

module.exports = { closeServer }
