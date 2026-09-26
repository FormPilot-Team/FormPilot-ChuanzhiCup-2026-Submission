/**
 * Pose time series extracted offline from a routine's standard video (scripts/extract-video-reference.mjs).
 *
 * Stored compactly (schema 2): every frame is `[t, confidence%, x0‰, y0‰, visibility0%, x1‰, …]` for all 33
 * MediaPipe landmarks, in the video's own image coordinates; a frame without a detected pose is `[t, 0]`.
 * Only 2D position and visibility are kept: depth is never used for follow-along comparison.
 */
export const REFERENCE_TRACK_SCHEMA_VERSION = 2
export const REFERENCE_LANDMARK_COUNT = 33

export interface ReferencePoint {
  x: number
  y: number
  visibility: number
}

export interface ReferenceFrame {
  /** Seconds into the video. */
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

/** Validates and decodes a stored track; returns undefined for anything malformed or empty. */
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

/** Encodes one detected pose into the stored frame layout (used by the extraction script and tests). */
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

/** Loads and caches a track; any network or format failure resolves to undefined (follow-along comparison off). */
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
