import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyVideoFailure,
  probeVideoSource,
  videoDiagnosticsLog,
  videoDiagnosticsRows,
  type VideoDiagnosticsReport,
  type VideoElementSnapshot,
  type VideoSourceProbe,
} from '../src/features/diagnostics/videoDiagnostics'

const SIZE = 35_321_928

/** A fake of the reviewer's static server: 200 for plain requests, 206 + Content-Range for single byte ranges. */
function server({ status = 200, type = 'video/mp4', rangeStatus = 206, fail = false }: { status?: number; type?: string; rangeStatus?: number; fail?: boolean } = {}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (fail) throw new TypeError('Failed to fetch')
    const range = new Headers(init?.headers).get('range')
    if (status !== 200) return new Response('Not Found', { status, headers: { 'Content-Type': 'text/plain' } })
    if (!range) return new Response(init?.method === 'HEAD' ? null : 'x', { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(SIZE), 'Accept-Ranges': 'bytes' } })
    const [start, end] = /bytes=(\d+)-(\d*)/.exec(range)!.slice(1).map((value, index) => (value === '' && index === 1 ? SIZE - 1 : Number(value)))
    if (rangeStatus !== 206) return new Response('File could not be read', { status: rangeStatus })
    const small = end - start + 1 <= 16
    return new Response(small ? new Uint8Array(end - start + 1) : 'partial', {
      status: 206,
      headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${SIZE}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' },
    })
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('video source probe', () => {
  it('accepts 200 without a range and 206 with a valid Content-Range for the head, open and tail ranges', async () => {
    const fetch = server()
    vi.stubGlobal('fetch', fetch)
    const probe = await probeVideoSource('/assets/routines/baduanjin-standard.mp4')
    expect(probe.verdict).toBe('ok')
    expect(probe.size).toBe(SIZE)
    expect(probe.plain).toMatchObject({ request: 'HEAD', status: 200, contentType: 'video/mp4', acceptRanges: 'bytes', contentLength: SIZE })
    expect(probe.rangeHead).toMatchObject({ status: 206, contentRange: `bytes 0-1/${SIZE}`, bytes: 2 })
    expect(probe.rangeOpen).toMatchObject({ request: 'GET Range: bytes=0-', status: 206, contentRange: `bytes 0-${SIZE - 1}/${SIZE}` })
    expect(probe.rangeTail).toMatchObject({ status: 206, contentRange: `bytes ${SIZE - 2}-${SIZE - 1}/${SIZE}`, bytes: 2 })
    expect(fetch.mock.calls.every(([, init]) => init?.cache === 'no-store')).toBe(true)
  })

  it('tells a missing file, a broken range answer, a wrong type and an unreachable server apart', async () => {
    vi.stubGlobal('fetch', server({ status: 404 }))
    expect((await probeVideoSource('/v.mp4')).verdict).toBe('http-error')
    vi.stubGlobal('fetch', server({ rangeStatus: 500 }))
    expect((await probeVideoSource('/v.mp4')).verdict).toBe('range-broken')
    vi.stubGlobal('fetch', server({ type: 'text/html; charset=utf-8' }))
    expect((await probeVideoSource('/v.mp4')).verdict).toBe('wrong-type')
    vi.stubGlobal('fetch', server({ fail: true }))
    const unreachable = await probeVideoSource('/v.mp4')
    expect(unreachable.verdict).toBe('unreachable')
    expect(unreachable.plain.error).toContain('Failed to fetch')
  })
})

const element = (errorCode: number | null): VideoElementSnapshot => ({
  errorCode,
  errorName: errorCode === null ? null : ['', 'MEDIA_ERR_ABORTED', 'MEDIA_ERR_NETWORK', 'MEDIA_ERR_DECODE', 'MEDIA_ERR_SRC_NOT_SUPPORTED'][errorCode],
  errorMessage: errorCode === 3 ? 'PIPELINE_ERROR_DECODE: VDA Error 4' : null,
  networkState: 1,
  readyState: 0,
  currentSrc: '/assets/routines/baduanjin-standard.mp4',
  duration: null,
  currentTime: 0,
  videoWidth: 0,
  videoHeight: 0,
})

describe('video failure classification', () => {
  const okProbe = { verdict: 'ok' } as VideoSourceProbe
  it('maps the media error codes to resource, decode and format problems', () => {
    expect(classifyVideoFailure(element(2), okProbe, 'error')).toBe('resource')
    expect(classifyVideoFailure(element(3), okProbe, 'error')).toBe('decode')
    expect(classifyVideoFailure(element(4), okProbe, 'error')).toBe('format')
    expect(classifyVideoFailure(element(1), okProbe, 'error')).toBe('aborted')
    expect(classifyVideoFailure(element(null), okProbe, 'slow')).toBe('slow')
  })

  it('blames the resource whenever the local server did not answer correctly, whatever the player reported', () => {
    for (const verdict of ['unreachable', 'http-error', 'wrong-type', 'range-broken'] as const) {
      expect(classifyVideoFailure(element(4), { verdict } as VideoSourceProbe, 'error')).toBe('resource')
      expect(classifyVideoFailure(element(3), { verdict } as VideoSourceProbe, 'error')).toBe('resource')
    }
  })
})

describe('video diagnostics presentation', () => {
  it('lists the error type, codec support, HTTP / Range answers and the app version, and logs flat fields', async () => {
    vi.stubGlobal('fetch', server())
    const probe = await probeVideoSource('/assets/routines/baduanjin-standard.mp4')
    const report: VideoDiagnosticsReport = {
      reason: 'error',
      category: 'decode',
      collectedAt: '2026-09-27T08:00:00.000Z',
      route: '/routines/baduanjin/train',
      expected: { src: '/assets/routines/baduanjin-standard.mp4', codecs: 'avc1.64001E, mp4a.40.2', width: 640, height: 360, durationSeconds: 728.3 },
      element: element(3),
      probe,
      codec: { type: 'video/mp4; codecs="avc1.64001E, mp4a.40.2"', canPlayType: 'probably', mediaSource: true },
      app: 'FormPilot 评审版 1.0.6（Electron 44.3.0 / Chromium 1）',
      videoDecoding: 'software',
      logPath: 'C:\\Users\\me\\AppData\\Roaming\\AI电子教练评审版\\logs\\media-diagnostics.log',
    }
    const rows = Object.fromEntries(videoDiagnosticsRows(report).map((row) => [row.label, row.value]))
    expect(rows['问题类型']).toBe('解码问题 · MEDIA_ERR_DECODE（代码 3）')
    expect(rows['播放器信息']).toContain('PIPELINE_ERROR_DECODE')
    expect(rows['视频格式']).toContain('avc1.64001E, mp4a.40.2')
    expect(rows['格式支持']).toContain('probably')
    expect(rows.HTTP).toContain('HEAD → 200 · video/mp4 · 33.7 MB · Accept-Ranges: bytes')
    expect(rows.Range).toContain(`GET Range: bytes=0- → 206 · bytes 0-${SIZE - 1}/${SIZE}`)
    expect(rows['资源检查']).toBe('正常（200 / 206）')
    expect(rows['视频解码']).toContain('软件解码')
    expect(rows['应用版本']).toContain('1.0.6')
    expect(rows['诊断日志']).toContain('media-diagnostics.log')
    const log = videoDiagnosticsLog(report)
    expect(log).toMatchObject({ category: 'decode', errorCode: 3, errorName: 'MEDIA_ERR_DECODE', httpStatus: 200, acceptRanges: 'bytes', rangeVerdict: 'ok', canPlayType: 'probably' })
    expect(JSON.parse(JSON.stringify(log))).toEqual(log)
  })
})
