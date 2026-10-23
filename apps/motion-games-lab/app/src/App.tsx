import { useCallback, useState } from 'react'
import { FLAGS } from './shared/flags'
import type { GameId } from './shared/metrics'
import { loadSettings, saveSettings, type Settings } from './shared/settings'
import { GameFlow } from './ui/GameFlow'
import { Hub } from './ui/Hub'

export function App() {
  const [game, setGame] = useState<GameId | null>(FLAGS.game)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const updateSettings = useCallback((next: Settings) => {
    setSettings(next)
    saveSettings(next)
  }, [])
  if (game) return <GameFlow key={game} gameId={game} settings={settings} onSettings={updateSettings} onHub={() => setGame(null)} />
  return <Hub settings={settings} onSettings={updateSettings} onStart={setGame} />
}
