// Hidden URL switches for development and automated tests. None of them appear in the normal UI.
//   ?debug=1            developer panel + playfield skeleton / body outline / landmarks / hit points
//   ?source=synthetic   replace the camera with the scripted synthetic player (replay tests)
//   ?duration=40        round length in seconds (tests)
//   ?seed=5             deterministic layout (apples, lanterns)
//   ?missEvery=6        synthetic player is imperfect on purpose every Nth target / stroke / shot
//   ?stroke=down        Boating scheme B (downward stroke) instead of the default outward sweep
//   ?delegate=cpu       force the MediaPipe CPU delegate (performance comparison); default GPU→CPU
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
  delegate: params.get('delegate') === 'cpu' ? ('CPU' as const) : params.get('delegate') === 'gpu' ? ('GPU' as const) : null,
  strokeScheme: params.get('stroke') === 'down' ? ('down' as const) : ('sweep' as const),
  game: game === 'apple' || game === 'boating' || game === 'archery' ? game : null,
})
