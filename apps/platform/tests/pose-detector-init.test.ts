import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createFromOptions = vi.fn()
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async (root: string) => ({ wasmLoaderPath: `${root}/vision_wasm_internal.js` })) },
  PoseLandmarker: { createFromOptions: (...args: unknown[]) => createFromOptions(...args) },
}))

const { PoseDetector, PoseModelError } = await import('../src/features/pose/PoseDetector')
const { recentDiagnostics } = await import('../src/features/diagnostics/desktopBridge')

const CONFIG = { wasmRoot: '/wasm', modelAssetPath: '/models/pose_landmarker_lite.task', minConfidence: 0.5 }
const landmarker = { close: vi.fn(), detectForVideo: vi.fn() }

describe('pose detector start-up', () => {
  beforeEach(() => {
    createFromOptions.mockReset()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('runs on the GPU delegate when it starts, with the model bytes it fetched itself', async () => {
    createFromOptions.mockResolvedValueOnce(landmarker)
    const detector = new PoseDetector(CONFIG)
    await detector.initialize()
    expect(detector.delegate).toBe('GPU')
    expect(detector.gpuError).toBeUndefined()
    expect(createFromOptions).toHaveBeenCalledTimes(1)
    const options = createFromOptions.mock.calls[0][1] as { baseOptions: { delegate: string; modelAssetBuffer: Uint8Array } }
    expect(options.baseOptions.delegate).toBe('GPU')
    expect([...options.baseOptions.modelAssetBuffer]).toEqual([1, 2, 3])
  })

  it('falls back to the CPU delegate when this machine cannot start the GPU one, and records why', async () => {
    createFromOptions.mockRejectedValueOnce(new Error('Failed to compile shader')).mockResolvedValueOnce(landmarker)
    const detector = new PoseDetector(CONFIG)
    await detector.initialize()
    expect(detector.delegate).toBe('CPU')
    expect(detector.gpuError).toContain('Failed to compile shader')
    expect((createFromOptions.mock.calls[1][1] as { baseOptions: { delegate: string } }).baseOptions.delegate).toBe('CPU')
    expect(recentDiagnostics().at(-1)).toMatchObject({ kind: 'model-fallback', entry: { gpuError: 'Error: Failed to compile shader' } })
  })

  it('fails with both delegates named when neither starts, and can be retried', async () => {
    createFromOptions.mockRejectedValueOnce(new Error('no WebGL')).mockRejectedValueOnce(new Error('out of memory'))
    const detector = new PoseDetector(CONFIG)
    const failure = await detector.initialize().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PoseModelError)
    expect((failure as InstanceType<typeof PoseModelError>).details).toMatchObject({ stage: 'landmarker', modelStatus: 200, modelBytes: 3, gpuError: 'Error: no WebGL', cpuError: 'Error: out of memory' })
    createFromOptions.mockResolvedValueOnce(landmarker)
    await detector.initialize()
    expect(detector.delegate).toBe('GPU')
    expect(detector.initializationCount).toBe(2)
  })

  it('reports a missing or unreachable model file with its status, before trying any delegate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not Found', { status: 404 })))
    const missing = await new PoseDetector(CONFIG).initialize().catch((error: unknown) => error)
    expect((missing as InstanceType<typeof PoseModelError>).details).toMatchObject({ stage: 'model-fetch', modelStatus: 404, modelAssetPath: CONFIG.modelAssetPath })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const unreachable = await new PoseDetector(CONFIG).initialize().catch((error: unknown) => error)
    expect((unreachable as InstanceType<typeof PoseModelError>).details).toMatchObject({ stage: 'model-fetch', modelStatus: null })
    expect(createFromOptions).not.toHaveBeenCalled()
  })
})
