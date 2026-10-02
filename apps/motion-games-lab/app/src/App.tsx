import { useCallback, useState } from 'react'
import type { GameId } from './shared/metrics'
import { loadSettings, saveSettings, type Settings } from './shared/settings'
import { GameFlow } from './ui/GameFlow'
import { Hub } from './ui/Hub'

export function App() {
  const [game, setGame] = useState<GameId | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const updateSettings = useCallback((next: Settings) => {
    setSettings(next)
    saveSettings(next)
  }, [])
  if (game === 'apple') return <GameFlow settings={settings} onSettings={updateSettings} onHub={() => setGame(null)} />
  return <Hub settings={settings} onSettings={updateSettings} onStart={setGame} />
}
