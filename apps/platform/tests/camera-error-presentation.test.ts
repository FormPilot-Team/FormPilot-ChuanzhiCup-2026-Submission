import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserCameraAdapter, CameraStartError, PREFERRED_CAMERA_CONSTRAINTS, cameraErrorPresentation } from '../src/adapters/camera/BrowserCameraAdapter'
import { cameraFailureLog, cameraFailureRows, deviceCheckLines, initialCameraFailure, type CameraFailureReport } from '../src/features/camera/cameraDiagnostics'

const domError = (name: string, message = 'internal browser detail', extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { name, ...extra })

describe('camera error presentation', () => {
  it.each([
    ['NotAllowedError', 'permission_denied', '摄像头权限未开启'],
    ['NotFoundError', 'not_found', '未检测到可用摄像头，请确认设备已连接。'],
    ['NotReadableError', 'in_use', '摄像头当前无法读取，可能正在被其他应用占用。'],
    ['OverconstrainedError', 'constraint_failed', '当前摄像头不支持所需的视频参数'],
    ['SecurityError', 'security', '摄像头被安全设置阻止'],
    ['UnknownError', 'unknown_error', '无法启动摄像头'],
  ])('maps %s to user-facing Chinese', (name, kind, message) => {
    const presentation = cameraErrorPresentation({ name })
    expect(presentation.kind).toBe(kind)
    expect(presentation.message).toContain(message)
    expect(presentation.message).not.toContain(name)
    expect(presentation.guidance.length).toBeGreaterThan(10)
  })

  it('sends a refusal inside the desktop app (which always allows its own page) to the Windows privacy switch', () => {
    const desktop = cameraErrorPresentation({ name: 'NotAllowedError' }, { desktop: true })
    expect(desktop).toMatchObject({ kind: 'permission_denied', windowsPrivacy: true })
    expect(desktop.message).toBe('摄像头权限未开启。请在 Windows 设置中允许桌面应用访问摄像头，然后重新尝试。')
    expect(desktop.guidance).toContain('隐私和安全性')
    expect(desktop.guidance).toContain('允许桌面应用访问相机')
    // Chromium's own wording for an OS-level refusal, in a browser.
    expect(cameraErrorPresentation(domError('NotAllowedError', 'Permission denied by system'))).toMatchObject({ kind: 'permission_denied', windowsPrivacy: true })
    // A browser prompt the user refused is about the site permission, not Windows.
    expect(cameraErrorPresentation(domError('NotAllowedError', 'Permission denied'))).toMatchObject({ kind: 'permission_denied', windowsPrivacy: false })
    expect(cameraErrorPresentation(domError('NotAllowedError', 'Permission denied')).guidance).toContain('网站信息')
  })

  it('names Windows privacy whenever Windows reports the camera switched off, whatever the error name', () => {
    for (const name of ['NotReadableError', 'NotFoundError', 'AbortError']) {
      expect(cameraErrorPresentation({ name }, { systemBlocked: true })).toMatchObject({ kind: 'permission_denied', windowsPrivacy: true })
    }
  })

  it('does not read a video.play() refusal as a camera permission problem', () => {
    const error = new CameraStartError('play', 'NotAllowedError', 'play() failed because the user did not interact', [{ request: 'preferred', ok: true }])
    expect(cameraErrorPresentation(error, { desktop: true }).kind).toBe('unknown_error')
    expect(cameraErrorPresentation(new CameraStartError('unsupported', 'NotSupportedError', 'no mediaDevices', [])).kind).toBe('unsupported')
  })
})

describe('camera request fallback', () => {
  afterEach(() => vi.unstubAllGlobals())

  const fakeStream = () => {
    const track = { stop: vi.fn(), getSettings: () => ({ width: 640, height: 480, frameRate: 15 }) }
    return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  }
  const fakeVideo = () => ({ srcObject: null as MediaStream | null, play: vi.fn(async () => undefined) }) as unknown as HTMLVideoElement

  it('asks for the preferred mode first and falls back to a plain request when the camera cannot deliver it', async () => {
    const stream = fakeStream()
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(domError('OverconstrainedError', '', { constraint: 'frameRate' }))
      .mockResolvedValueOnce(stream)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const adapter = new BrowserCameraAdapter()
    const video = fakeVideo()
    await expect(adapter.start(video)).resolves.toBe(stream)
    expect(getUserMedia.mock.calls.map(([request]) => request)).toEqual([{ video: PREFERRED_CAMERA_CONSTRAINTS, audio: false }, { video: true, audio: false }])
    expect(adapter.lastStart.attempts).toEqual([
      { request: 'preferred', ok: false, errorName: 'OverconstrainedError', errorMessage: '', constraint: 'frameRate' },
      { request: 'basic', ok: true },
    ])
    expect(adapter.lastStart.settings).toEqual({ width: 640, height: 480, frameRate: 15 })
    expect(video.srcObject).toBe(stream)
  })

  it('also retries a camera that would not start in the preferred mode, and reports both requests if both fail', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(domError('NotReadableError', 'Could not start video source'))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const failure = await new BrowserCameraAdapter().start(fakeVideo()).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CameraStartError)
    expect(failure).toMatchObject({ stage: 'getUserMedia', errorName: 'NotReadableError', errorMessage: 'Could not start video source' })
    expect((failure as CameraStartError).attempts.map((attempt) => `${attempt.request}:${attempt.errorName}`)).toEqual(['preferred:NotReadableError', 'basic:NotReadableError'])
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('never retries a refusal or a missing camera', async () => {
    for (const name of ['NotAllowedError', 'NotFoundError', 'SecurityError']) {
      const getUserMedia = vi.fn().mockRejectedValue(domError(name))
      vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
      await expect(new BrowserCameraAdapter().start(fakeVideo())).rejects.toMatchObject({ errorName: name, stage: 'getUserMedia' })
      expect(getUserMedia).toHaveBeenCalledTimes(1)
    }
  })

  it('tells a picture that will not play apart from a camera that will not open', async () => {
    const stream = fakeStream()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
    const video = fakeVideo()
    ;(video.play as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(domError('AbortError', 'The play() request was interrupted'))
    await expect(new BrowserCameraAdapter().start(video)).rejects.toMatchObject({ stage: 'play', errorName: 'AbortError' })
    expect(stream.getTracks()[0].stop).toHaveBeenCalled()
    expect(video.srcObject).toBeNull()
  })

  it('reports an environment without mediaDevices as unsupported', async () => {
    vi.stubGlobal('navigator', {})
    await expect(new BrowserCameraAdapter().start(fakeVideo())).rejects.toMatchObject({ stage: 'unsupported' })
  })
})

describe('camera failure report', () => {
  const complete = (overrides: Partial<CameraFailureReport> = {}): CameraFailureReport => ({
    ...initialCameraFailure(new CameraStartError('getUserMedia', 'NotReadableError', 'Could not start video source', [
      { request: 'preferred', ok: false, errorName: 'NotReadableError', errorMessage: 'Could not start video source' },
      { request: 'basic', ok: false, errorName: 'NotReadableError', errorMessage: 'Could not start video source' },
    ]), 'camera'),
    complete: true,
    check: { videoInputs: 1, labelsAvailable: true, permission: 'granted', system: { electronStatus: 'granted', windows: { device: 'allow', apps: 'allow', desktopApps: 'allow', policy: 'unset' }, verdict: 'allowed', blockedBy: [] }, error: null },
    app: 'FormPilot 评审版 1.0.6（Electron 44.3.0 / Chromium 152）',
    logPath: 'C:\\Users\\me\\AppData\\Roaming\\AI电子教练评审版\\logs\\media-diagnostics.log',
    ...overrides,
  })

  it('shows the device check as 摄像头 / 权限 / 视频输入 (+ Windows in the desktop app)', () => {
    const lines = deviceCheckLines(complete().check!)
    expect(lines).toEqual([
      { label: '摄像头', value: '已检测' },
      { label: '权限', value: '允许' },
      { label: '视频输入', value: '1 个' },
      { label: 'Windows 相机权限', value: '已开启' },
    ])
    const none = deviceCheckLines({ videoInputs: 0, labelsAvailable: false, permission: 'denied', system: { electronStatus: 'denied', windows: { device: 'allow', apps: 'allow', desktopApps: 'deny', policy: 'unset' }, verdict: 'blocked', blockedBy: ['desktopApps', 'system'] }, error: null })
    expect(Object.fromEntries(none.map((row) => [row.label, row.value]))).toEqual({
      摄像头: '未检测', 权限: '拒绝', 视频输入: '0 个', 'Windows 相机权限': '已关闭（“允许桌面应用访问相机”已关闭；Windows 拒绝桌面应用使用相机）',
    })
  })

  it('lists both requests, the device check and the app in the diagnostics, and logs no device names', () => {
    const rows = Object.fromEntries(cameraFailureRows(complete()).map((row) => [row.label, row.value]))
    expect(rows['问题类型']).toBe('设备被占用或无法读取 · NotReadableError')
    expect(rows['摄像头请求']).toContain('首选参数（1280×720 · 30 fps，至少 20 fps） → NotReadableError')
    expect(rows['摄像头请求']).toContain('兼容参数（video: true） → NotReadableError')
    expect(rows['视频输入']).toBe('1 个')
    expect(rows['设备名称']).toBe('可读取（已授权）')
    expect(rows['应用版本']).toContain('1.0.6')
    const log = cameraFailureLog(complete())
    expect(log).toMatchObject({ failure: 'in_use', errorName: 'NotReadableError', videoInputs: 1, labelsAvailable: true, permission: 'granted' })
    expect(JSON.stringify(log)).not.toMatch(/deviceId|groupId|"label"/)
  })
})
