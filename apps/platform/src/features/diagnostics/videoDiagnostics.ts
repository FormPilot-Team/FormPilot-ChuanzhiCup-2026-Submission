import { appVersionLabel, desktopInfo } from './desktopBridge'
import { errorText, formatBytes, type DiagnosticsRow } from './diagnosticsReport'

/** HTMLMediaElement.error.code → the spec's name. */
export const MEDIA_ERROR_NAMES: Readonly<Record<number, string>> = Object.freeze({
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
})

const NETWORK_STATES = ['NETWORK_EMPTY', 'NETWORK_IDLE', 'NETWORK_LOADING', 'NETWORK_NO_SOURCE']
const READY_STATES = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA']

/**
 * What went wrong, in the three families that need different fixes: the file never arrived intact (resource), it
 * arrived but this machine cannot decode it (decode), or the player rejects the format outright (format).
 */
export type VideoFailureCategory = 'resource' | 'decode' | 'format' | 'aborted' | 'slow' | 'unknown'

export const VIDEO_FAILURE_TEXT: Readonly<Record<VideoFailureCategory, { reason: string; label: string }>> = Object.freeze({
  resource: { reason: '视频文件没有完整读取到。', label: '网络 / 资源读取问题' },
  decode: { reason: '这台电脑解码这段视频时出错。', label: '解码问题' },
  format: { reason: '当前播放环境不支持这段视频的格式。', label: '格式不支持' },
  aborted: { reason: '视频加载被中断。', label: '加载被中止' },
  slow: { reason: '视频加载时间过长。', label: '加载超时（尚无错误）' },
  unknown: { reason: '视频无法播放。', label: '原因未知' },
})

/** The standard video as the program describes it. */
export interface ExpectedVideo {
  src: string
  /** RFC 6381 codecs of the shipped file, e.g. `avc1.64001E, mp4a.40.2`. */
  codecs: string
  width: number
  height: number
  durationSeconds: number
}

export interface VideoElementSnapshot {
  errorCode: number | null
  errorName: string | null
  errorMessage: string | null
  networkState: number
  readyState: number
  currentSrc: string
  duration: number | null
  currentTime: number
  videoWidth: number
  videoHeight: number
}

export interface HttpCheck {
  request: string
  status: number | null
  contentType: string | null
  contentLength: number | null
  acceptRanges: string | null
  contentRange: string | null
  /** Body bytes actually read, for the small range checks. */
  bytes: number | null
  error: string | null
  ms: number
}

export interface VideoSourceProbe {
  plain: HttpCheck
  rangeHead: HttpCheck
  rangeOpen: HttpCheck
  rangeTail: HttpCheck | null
  size: number | null
  /** ok: 200 without a range, correct 206 answers with one. */
  verdict: 'ok' | 'unreachable' | 'http-error' | 'wrong-type' | 'range-broken'
}

export interface CodecSupport {
  type: string
  canPlayType: string
  mediaSource: boolean | null
}

export interface VideoDiagnosticsReport {
  reason: 'error' | 'slow'
  category: VideoFailureCategory
  collectedAt: string
  route: string
  expected: ExpectedVideo
  element: VideoElementSnapshot | null
  probe: VideoSourceProbe
  codec: CodecSupport
  app: string
  videoDecoding: string | null
  logPath: string | null
}

function pathOf(url: string): string {
  if (!url) return ''
  try {
    return new URL(url, typeof window === 'undefined' ? 'http://localhost/' : window.location.href).pathname
  } catch {
    return url
  }
}

export function snapshotVideoElement(video: HTMLVideoElement): VideoElementSnapshot {
  const code = video.error?.code ?? null
  return {
    errorCode: code,
    errorName: code === null ? null : MEDIA_ERROR_NAMES[code] ?? `code ${code}`,
    errorMessage: video.error?.message || null,
    networkState: video.networkState,
    readyState: video.readyState,
    currentSrc: pathOf(video.currentSrc || video.getAttribute('src') || ''),
    duration: Number.isFinite(video.duration) ? video.duration : null,
    currentTime: video.currentTime,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
  }
}

async function httpCheck(url: string, method: 'HEAD' | 'GET', range: string | null, readBody: boolean): Promise<HttpCheck> {
  const request = `${method}${range ? ` Range: ${range}` : ''}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  const started = performance.now()
  try {
    const response = await fetch(url, { method, headers: range ? { Range: range } : undefined, cache: 'no-store', signal: controller.signal })
    const length = response.headers.get('content-length')
    let bytes: number | null = null
    // Small ranges are read to prove the server can really read the file; larger answers stop at the headers so a
    // diagnostic never downloads a whole video.
    if (readBody && method === 'GET') bytes = (await response.arrayBuffer()).byteLength
    else controller.abort()
    return {
      request,
      status: response.status,
      contentType: response.headers.get('content-type'),
      contentLength: length === null ? null : Number(length),
      acceptRanges: response.headers.get('accept-ranges'),
      contentRange: response.headers.get('content-range'),
      bytes,
      error: null,
      ms: Math.round(performance.now() - started),
    }
  } catch (error) {
    return { request, status: null, contentType: null, contentLength: null, acceptRanges: null, contentRange: null, bytes: null, error: errorText(error), ms: Math.round(performance.now() - started) }
  } finally {
    clearTimeout(timer)
  }
}

/** HTTP checks against the local server: 200 without Range, 206 with a valid Content-Range for the head, open and tail ranges. */
export async function probeVideoSource(src: string): Promise<VideoSourceProbe> {
  // In parallel: a server that never answers costs one timeout, not three.
  const [plain, rangeHead, rangeOpen] = await Promise.all([
    httpCheck(src, 'HEAD', null, false),
    httpCheck(src, 'GET', 'bytes=0-1', true),
    httpCheck(src, 'GET', 'bytes=0-', false),
  ])
  // The file size comes from a successful answer only (a 404 page has a length too).
  const size = plain.status === 200 && plain.contentLength !== null
    ? plain.contentLength
    : rangeHead.status === 206 ? Number(/\/(\d+)$/.exec(rangeHead.contentRange ?? '')?.[1] ?? Number.NaN) : Number.NaN
  const knownSize = Number.isFinite(size) && size > 2 ? size : null
  const rangeTail = knownSize === null ? null : await httpCheck(src, 'GET', `bytes=${knownSize - 2}-${knownSize - 1}`, true)
  let verdict: VideoSourceProbe['verdict'] = 'ok'
  if (plain.status === null && rangeHead.status === null) verdict = 'unreachable'
  else if (plain.status !== 200) verdict = 'http-error'
  else if (!(plain.contentType ?? '').startsWith('video/')) verdict = 'wrong-type'
  else {
    const rangeOk = (check: HttpCheck | null, expected: string, bytes: number | null) => check !== null && check.status === 206 && check.contentRange === expected && (bytes === null || check.bytes === bytes)
    const total = knownSize ?? 0
    if (!rangeOk(rangeHead, `bytes 0-1/${total}`, 2) || !rangeOk(rangeOpen, `bytes 0-${total - 1}/${total}`, null) || !rangeOk(rangeTail, `bytes ${total - 2}-${total - 1}/${total}`, 2)) verdict = 'range-broken'
  }
  return { plain, rangeHead, rangeOpen, rangeTail, size: knownSize, verdict }
}

export function codecSupport(codecs: string): CodecSupport {
  const type = `video/mp4; codecs="${codecs}"`
  const probe = document.createElement('video')
  return {
    type,
    canPlayType: probe.canPlayType(type),
    mediaSource: typeof MediaSource === 'undefined' ? null : MediaSource.isTypeSupported(type),
  }
}

export function classifyVideoFailure(element: VideoElementSnapshot | null, probe: VideoSourceProbe | null, reason: 'error' | 'slow'): VideoFailureCategory {
  if (probe && probe.verdict !== 'ok') return 'resource'
  const code = element?.errorCode ?? null
  if (code === null) return reason === 'slow' ? 'slow' : 'unknown'
  if (code === 1) return 'aborted'
  if (code === 2) return 'resource'
  if (code === 3) return 'decode'
  if (code === 4) return 'format'
  return 'unknown'
}

export async function collectVideoDiagnostics(video: HTMLVideoElement | null, expected: ExpectedVideo, reason: 'error' | 'slow'): Promise<VideoDiagnosticsReport> {
  const element = video ? snapshotVideoElement(video) : null
  const [probe, info] = await Promise.all([probeVideoSource(expected.src), desktopInfo()])
  return {
    reason,
    category: classifyVideoFailure(element, probe, reason),
    collectedAt: new Date().toISOString(),
    route: window.location.pathname + window.location.search,
    expected,
    element,
    probe,
    codec: codecSupport(expected.codecs),
    app: appVersionLabel(info),
    videoDecoding: info?.videoDecoding ?? null,
    logPath: info?.logPath ?? null,
  }
}

function describeCheck(check: HttpCheck | null): string {
  if (!check) return '未检查'
  if (check.status === null) return `${check.request} → 失败（${check.error ?? '无响应'}）`
  const parts = [`${check.request} → ${check.status}`]
  if (check.contentRange) parts.push(check.contentRange)
  if (check.bytes !== null) parts.push(`读到 ${check.bytes} 字节`)
  return parts.join(' · ')
}

export function videoDiagnosticsRows(report: VideoDiagnosticsReport): DiagnosticsRow[] {
  const { element, probe, codec, expected } = report
  const code = element?.errorCode ?? null
  const rows: DiagnosticsRow[] = [
    {
      label: '问题类型',
      value: code !== null ? `${VIDEO_FAILURE_TEXT[report.category].label} · ${element?.errorName}（代码 ${code}）` : VIDEO_FAILURE_TEXT[report.category].label,
    },
  ]
  if (element?.errorMessage) rows.push({ label: '播放器信息', value: element.errorMessage })
  if (element) {
    rows.push({ label: '播放状态', value: `readyState ${element.readyState} ${READY_STATES[element.readyState] ?? ''} · networkState ${element.networkState} ${NETWORK_STATES[element.networkState] ?? ''}` })
    rows.push({ label: '已读到的视频', value: element.duration === null ? '尚未读到时长和画面尺寸' : `${element.duration.toFixed(1)} 秒 · ${element.videoWidth}×${element.videoHeight}` })
  }
  rows.push({ label: '视频地址', value: element?.currentSrc || expected.src })
  rows.push({ label: '视频格式', value: `${expected.codecs} · ${expected.width}×${expected.height} · ${expected.durationSeconds.toFixed(1)} 秒` })
  rows.push({ label: '格式支持', value: `canPlayType：${codec.canPlayType || '不支持'} · MediaSource：${codec.mediaSource === null ? '不可用' : codec.mediaSource ? '支持' : '不支持'}` })
  rows.push({
    label: 'HTTP',
    value: probe.plain.status === null
      ? describeCheck(probe.plain)
      : `${probe.plain.request} → ${probe.plain.status} · ${probe.plain.contentType ?? '无 Content-Type'} · ${formatBytes(probe.plain.contentLength)} · Accept-Ranges: ${probe.plain.acceptRanges ?? '无'}`,
  })
  rows.push({ label: 'Range', value: [describeCheck(probe.rangeHead), describeCheck(probe.rangeOpen), describeCheck(probe.rangeTail)].join('；') })
  rows.push({ label: '资源检查', value: probe.verdict === 'ok' ? '正常（200 / 206）' : probe.verdict })
  if (report.videoDecoding) rows.push({ label: '视频解码', value: report.videoDecoding === 'software' ? '软件解码（桌面版固定）' : report.videoDecoding })
  rows.push({ label: '应用版本', value: report.app })
  if (report.logPath) rows.push({ label: '诊断日志', value: report.logPath })
  rows.push({ label: '页面', value: report.route })
  return rows
}

/** The diagnostics-log entry for a report: flat, no DOM objects, no pictures. */
export function videoDiagnosticsLog(report: VideoDiagnosticsReport): Record<string, unknown> {
  return {
    route: report.route,
    category: report.category,
    source: report.expected.src,
    errorCode: report.element?.errorCode ?? null,
    errorName: report.element?.errorName ?? null,
    errorMessage: report.element?.errorMessage ?? null,
    readyState: report.element?.readyState ?? null,
    networkState: report.element?.networkState ?? null,
    duration: report.element?.duration ?? null,
    videoSize: report.element ? `${report.element.videoWidth}x${report.element.videoHeight}` : null,
    httpStatus: report.probe.plain.status,
    contentType: report.probe.plain.contentType,
    contentLength: report.probe.plain.contentLength,
    acceptRanges: report.probe.plain.acceptRanges,
    range: [report.probe.rangeHead, report.probe.rangeOpen, report.probe.rangeTail].map((check) => (check ? `${check.request} ${check.status ?? check.error} ${check.contentRange ?? ''}`.trim() : null)),
    rangeVerdict: report.probe.verdict,
    codecs: report.expected.codecs,
    canPlayType: report.codec.canPlayType,
    mediaSource: report.codec.mediaSource,
  }
}
