// Pose inference off the main thread. The page posts one camera frame at a time (an ImageBitmap,
// transferred, never queued); this worker runs the same PoseDetector and posts the landmarks back. While
// it is busy the page keeps only the newest camera frame, so a slow inference never builds a backlog and
// never blocks game rendering.
//
// Delegate 'AUTO' (default): CPU first. On the integrated GPU the game renders on, a GPU-delegate model
// competes with the game's own frames (measured: render p95 12–17 ms with GPU inference vs 4–12 ms with
// CPU inference, both at ~30 inference fps). If this machine's CPU turns out too slow (median inference
// over `AUTO.switchMs` after `AUTO.sampleFrames` frames), the worker switches itself to the GPU delegate.
import { PoseDetector, PoseModelError } from './vendor/PoseDetector'
import type { PoseLandmark } from './vendor/poseTypes'

export type WorkerDelegate = 'GPU' | 'CPU' | 'AUTO'

export const AUTO = Object.freeze({ sampleFrames: 45, switchMs: 40 })

export type PoseWorkerRequest =
  | { type: 'init'; wasmRoot: string; modelUrl: string; minConfidence: number; delegate: WorkerDelegate }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number; frameTime: number }
  | { type: 'close' }

export type PoseWorkerResponse =
  | { type: 'ready'; delegate: string; gpuError: string | null }
  | { type: 'error'; stage: string; message: string }
  | { type: 'result'; timestamp: number; frameTime: number; landmarks: ReadonlyArray<PoseLandmark> | null; inferenceMs: number; skipped?: boolean }
  /** AUTO switched delegate (diagnostics) */
  | { type: 'delegate'; delegate: string; reason: string }

interface WorkerScope {
  onmessage: ((event: MessageEvent<PoseWorkerRequest>) => void) | null
  postMessage(message: PoseWorkerResponse): void
  close(): void
}

const scope = self as unknown as WorkerScope

// MediaPipe loads its WASM loader with import() inside a module worker (via `self.import` when present).
// An ES module evaluates only once and MediaPipe clears the global ModuleFactory after each landmarker is
// created, so a second landmarker in this worker (AUTO's switch to GPU) would find none: re-provide it.
;(self as unknown as { import?: (url: string) => Promise<void> }).import = async (url: string) => {
  const loader = (await import(/* @vite-ignore */ url)) as { default: unknown }
  ;(globalThis as Record<string, unknown>).ModuleFactory = loader.default
}

let detector: PoseDetector | null = null
let init: Extract<PoseWorkerRequest, { type: 'init' }> | null = null
let auto = false
let switching = false
const timings: number[] = []

const create = (delegate: 'GPU' | 'CPU') => new PoseDetector({
  wasmRoot: init!.wasmRoot,
  wasmModule: true,
  modelAssetPath: init!.modelUrl,
  minConfidence: init!.minConfidence,
  delegate,
})

/** AUTO: after enough frames, a slow CPU hands inference to the GPU delegate (once). */
function checkAuto(ms: number): void {
  if (!auto || switching) return
  timings.push(ms)
  if (timings.length < AUTO.sampleFrames) return
  auto = false
  const median = [...timings].sort((a, b) => a - b)[Math.floor(timings.length / 2)]
  if (median <= AUTO.switchMs) return
  switching = true
  const next = create('GPU')
  next.initialize().then(() => {
    detector?.close()
    detector = next
    switching = false
    scope.postMessage({ type: 'delegate', delegate: next.delegate ?? 'GPU', reason: `CPU median ${median.toFixed(1)} ms` })
  }, () => {
    switching = false // keep the CPU detector
  })
}

scope.onmessage = (event) => {
  const message = event.data
  if (message.type === 'init') {
    init = message
    auto = message.delegate === 'AUTO'
    detector = create(message.delegate === 'GPU' ? 'GPU' : 'CPU')
    const started = detector.initialize().catch((error: unknown) => {
      // AUTO: a CPU delegate that cannot start falls back to the GPU delegate
      if (!auto) throw error
      auto = false
      detector = create('GPU')
      return detector.initialize()
    })
    started.then(
      () => scope.postMessage({ type: 'ready', delegate: detector?.delegate ?? 'unknown', gpuError: detector?.gpuError ?? null }),
      (error: unknown) => scope.postMessage({
        type: 'error',
        stage: error instanceof PoseModelError ? error.details.stage : 'init',
        message: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : String(error).slice(0, 300),
      }),
    )
    return
  }
  if (message.type === 'frame') {
    let landmarks: ReadonlyArray<PoseLandmark> | null = null
    try {
      landmarks = detector?.detect(message.bitmap, message.timestamp)?.landmarks ?? null
    } finally {
      message.bitmap.close()
    }
    const inferenceMs = detector?.lastInferenceMs ?? 0
    scope.postMessage({ type: 'result', timestamp: message.timestamp, frameTime: message.frameTime, landmarks, inferenceMs })
    checkAuto(inferenceMs)
    return
  }
  detector?.close()
  detector = null
  scope.close()
}
