/**
 * Extracts a routine's reference pose track from its standard video (origin: the teammate's 2026-09 standard-video
 * version; now writes FormPilot's compact schema 2, see src/features/routines/followAlong/referenceTrack.ts).
 *
 * Usage:
 *   1. Start the DEV server (the script loads the app's PoseDetector module from it):
 *      pnpm dev --host 127.0.0.1 --port 4173
 *   2. node scripts/extract-video-reference.mjs --video /assets/routines/baduanjin-standard.mp4 \
 *        --out public/assets/routines/baduanjin-standard.pose.json --fps 10
 *      (AI_COACH_BASE_URL overrides the base URL.)
 *
 * A dedicated instance of the app's PoseDetector (same model and options as the live camera) detects every sampled
 * frame. It must not be shared with a page that is itself detecting: MediaPipe tracks across calls, and the
 * training page's demo loop keeps detecting while paused (8E-1 resume gesture), which corrupts the reference.
 * Under Git Bash, prefix MSYS_NO_PATHCONV=1 so `/assets/...` is not rewritten into a Windows path.
 */
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const LANDMARK_COUNT = 33

function parseArgs(argv) {
  const args = { video: '', out: '', fps: 10 }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--video') args.video = argv[++index]
    else if (argv[index] === '--out') args.out = argv[++index]
    else if (argv[index] === '--fps') args.fps = Number(argv[++index])
  }
  if (!args.video || !args.out) throw new Error('--video and --out are required')
  if (!Number.isFinite(args.fps) || args.fps <= 0 || args.fps > 30) throw new Error('--fps must be between 1 and 30')
  return args
}

/** Same layout as encodeReferenceFrame(): [t, confidence%, x‰, y‰, visibility%, …]; [t, 0] when no pose. */
function encodeFrame(frame) {
  if (!frame || !(frame.confidence > 0) || frame.landmarks.length < LANDMARK_COUNT) return [Number(frame?.t.toFixed(2) ?? 0), 0]
  const values = [Number(frame.t.toFixed(2)), Math.round(frame.confidence * 100)]
  for (let index = 0; index < LANDMARK_COUNT; index += 1) {
    const point = frame.landmarks[index]
    values.push(Math.round(point.x * 1000), Math.round(point.y * 1000), Math.round((point.visibility ?? 0) * 100))
  }
  return values
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = process.env.AI_COACH_BASE_URL ?? 'http://127.0.0.1:4173'
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } })
    page.on('pageerror', (error) => process.stderr.write(`[browser-error] ${error.message}\n`))
    // A page without its own pose loop; the detector below is private to this script.
    await page.goto(`${baseUrl}/routines`)

    const extracted = await page.evaluate(async ({ videoSrc, fps }) => {
      const { PoseDetector } = await import('/src/features/pose/PoseDetector.ts')
      const detector = new PoseDetector()
      await detector.initialize()
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.preload = 'auto'
      video.src = videoSrc
      await new Promise((resolve, reject) => {
        video.addEventListener('loadedmetadata', resolve, { once: true })
        video.addEventListener('error', () => reject(new Error(`Failed to load video ${videoSrc}`)), { once: true })
      })
      const seekTo = (time) => new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(`seek timeout at ${time}s`)), 15_000)
        video.addEventListener('seeked', () => {
          window.clearTimeout(timer)
          window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
        }, { once: true })
        video.currentTime = time
      })
      const frames = []
      const sampleCount = Math.max(1, Math.ceil(video.duration * fps))
      let detectTimestamp = performance.now()
      for (let index = 0; index < sampleCount; index += 1) {
        const t = Math.min(index / fps, Math.max(0, video.duration - 0.05))
        await seekTo(t)
        detectTimestamp = Math.max(performance.now(), detectTimestamp + 16)
        const frame = detector.detect(video, detectTimestamp)
        frames.push(frame ? { t, confidence: frame.confidence, landmarks: frame.landmarks.map((point) => ({ x: point.x, y: point.y, visibility: point.visibility ?? 0 })) } : { t, confidence: 0, landmarks: [] })
        if (index % (fps * 30) === 0) console.log(`reference extraction ${index}/${sampleCount}`)
      }
      detector.close()
      return { duration: video.duration, width: video.videoWidth, height: video.videoHeight, frames }
    }, { videoSrc: args.video, fps: args.fps })

    const frames = extracted.frames.map(encodeFrame)
    const posed = frames.filter((frame) => frame.length > 2).length
    const payload = {
      schemaVersion: 2,
      asset: args.video,
      duration: Number(extracted.duration.toFixed(3)),
      fps: args.fps,
      width: extracted.width,
      height: extracted.height,
      detector: 'MediaPipe Pose Landmarker Lite',
      capturedAt: new Date().toISOString().slice(0, 10),
      landmarkCount: LANDMARK_COUNT,
      encoding: 'frame = [t, confidence%, x0‰, y0‰, visibility0%, …] for 33 MediaPipe landmarks; [t, 0] = no pose',
      frames,
    }
    await mkdir(path.dirname(args.out), { recursive: true })
    await writeFile(args.out, `${JSON.stringify(payload)}\n`, 'utf8')
    console.log(JSON.stringify({ out: args.out, duration: payload.duration, frames: frames.length, coverage: Number((posed / frames.length).toFixed(3)) }))
    if (posed / frames.length < 0.6) console.warn('Less than 60% of sampled frames contain a pose: check that the video shows one person, head to toe.')
  } finally {
    await browser.close()
  }
}

await main()
