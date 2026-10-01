// 标准视频离线提取的姿态序列。每帧存为 [t, 置信度%, x0‰, y0‰, 可见度0%, x1‰, …]（33 个关键点，
// 视频自身坐标）；未检测到姿态的帧为 [t, 0]。只保留二维位置与可见度
export const REFERENCE_TRACK_SCHEMA_VERSION = 2
export const REFERENCE_LANDMARK_COUNT = 33

export interface ReferencePoint {
  x: number
  y: number
  visibility: number
}

export interface ReferenceFrame {
  /** 视频内秒数 */
  t: number
  confidence: number
  landmarks: ReadonlyArray<ReferencePoint>
}

export interface ReferenceTrack {
  asset: string
  duration: number
  fps: number
  width: number
  height: number
  frames: ReadonlyArray<ReferenceFrame>
}

interface StoredTrack {
  schemaVersion: number
  asset: string
  duration: number
  fps: number
  width: number
  height: number
  landmarkCount: number
  frames: unknown[]
}

function isStoredTrack(value: unknown): value is StoredTrack {
  if (!value || typeof value !== 'object') return false
  const track = value as Partial<StoredTrack>
  return track.schemaVersion === REFERENCE_TRACK_SCHEMA_VERSION
    && typeof track.asset === 'string'
    && Number.isFinite(track.duration) && (track.duration ?? 0) > 0
    && Number.isFinite(track.fps) && (track.fps ?? 0) > 0
    && Number.isFinite(track.width) && (track.width ?? 0) > 0
    && Number.isFinite(track.height) && (track.height ?? 0) > 0
    && track.landmarkCount === REFERENCE_LANDMARK_COUNT
    && Array.isArray(track.frames)
}

function decodeFrame(raw: unknown): ReferenceFrame | undefined {
  if (!Array.isArray(raw) || raw.length < 2) return undefined
  const [t, confidence] = raw as number[]
  if (!Number.isFinite(t) || !Number.isFinite(confidence)) return undefined
  if (confidence <= 0 || raw.length !== 2 + REFERENCE_LANDMARK_COUNT * 3) return { t, confidence: 0, landmarks: [] }
  const landmarks: ReferencePoint[] = []
  for (let index = 0; index < REFERENCE_LANDMARK_COUNT; index += 1) {
    const offset = 2 + index * 3
    const x = raw[offset] as number
    const y = raw[offset + 1] as number
    const visibility = raw[offset + 2] as number
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(visibility)) return { t, confidence: 0, landmarks: [] }
    landmarks.push({ x: x / 1000, y: y / 1000, visibility: visibility / 100 })
  }
  return { t, confidence: confidence / 100, landmarks }
}

/** 校验并解码；格式错误或为空时返回 undefined */
export function parseReferenceTrack(raw: unknown): ReferenceTrack | undefined {
  if (!isStoredTrack(raw)) return undefined
  const frames: ReferenceFrame[] = []
  for (const item of raw.frames) {
    const frame = decodeFrame(item)
    if (frame) frames.push(frame)
  }
  frames.sort((left, right) => left.t - right.t)
  if (!frames.some((frame) => frame.confidence > 0)) return undefined
  return { asset: raw.asset, duration: raw.duration, fps: raw.fps, width: raw.width, height: raw.height, frames }
}

export function encodeReferenceFrame(t: number, confidence: number, landmarks: ReadonlyArray<ReferencePoint>): number[] {
  if (confidence <= 0 || landmarks.length < REFERENCE_LANDMARK_COUNT) return [Number(t.toFixed(2)), 0]
  const values = [Number(t.toFixed(2)), Math.round(confidence * 100)]
  for (let index = 0; index < REFERENCE_LANDMARK_COUNT; index += 1) {
    const point = landmarks[index]
    values.push(Math.round(point.x * 1000), Math.round(point.y * 1000), Math.round(point.visibility * 100))
  }
  return values
}

const trackCache = new Map<string, Promise<ReferenceTrack | undefined>>()

/** 加载并缓存；任何失败都返回 undefined（关闭跟练比对） */
export function loadReferenceTrack(src: string, fetcher: typeof fetch = fetch): Promise<ReferenceTrack | undefined> {
  const cached = trackCache.get(src)
  if (cached) return cached
  const pending = fetcher(src)
    .then((response) => {
      if (!response.ok) throw new Error(`Reference track request failed: ${response.status}`)
      return response.json() as Promise<unknown>
    })
    .then(parseReferenceTrack)
    .catch(() => {
      trackCache.delete(src)
      return undefined
    })
  trackCache.set(src, pending)
  return pending
}
