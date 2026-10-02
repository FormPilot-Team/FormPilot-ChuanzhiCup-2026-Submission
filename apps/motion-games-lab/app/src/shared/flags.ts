// Hidden URL switches for development and automated tests. None of them appear in the normal UI.
//   ?debug=1            developer panel + playfield skeleton / body outline / landmarks / hit points
//   ?source=synthetic   replace the camera with the scripted synthetic player (replay tests)
//   ?duration=40        round length in seconds (tests)
//   ?seed=5             deterministic layout (apples, lanterns)
//   ?missEvery=6        synthetic player is imperfect on purpose every Nth target / stroke / shot
//   ?stroke=down        Boating scheme B (downward stroke) instead of the default outward sweep
//   ?delegate=cpu|gpu   force the MediaPipe delegate (performance comparison). Default: in the worker
//                       CPU first, GPU if the CPU is too slow; on the main-thread fallback GPU→CPU
//   ?inference=main     run pose inference on the main thread (pre-fix path, performance comparison);
//                       default = a Worker, with the main thread only as an automatic fallback
//   ?fpsLimit=60        cap Phaser rendering (performance comparison); default uncapped
//   ?game=boating       open a game directly (tests / perf scripts)
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '')
const num = (key: string): number | null => {
  const value = params.get(key)
  return value !== null && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null
}
const game = params.get('game')

export const FLAGS = Object.freeze({
  debug: params.get('debug') === '1',
  synthetic: params.get('source') === 'synthetic',
  durationSeconds: num('duration'),
  seed: num('seed'),
  missEvery: num('missEvery'),
  fpsLimit: num('fpsLimit'),
  inference: params.get('inference') === 'main' ? ('main' as const) : ('auto' as const),
  delegate: params.get('delegate') === 'cpu' ? ('CPU' as const) : params.get('delegate') === 'gpu' ? ('GPU' as const) : null,
  strokeScheme: params.get('stroke') === 'down' ? ('down' as const) : ('sweep' as const),
  game: game === 'apple' || game === 'boating' || game === 'archery' ? game : null,
})
