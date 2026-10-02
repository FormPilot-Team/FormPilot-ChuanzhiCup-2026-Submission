import { useEffect, useRef, useState } from 'react'
import { COPY, GAMES, type GameCard } from '../data/games'
import type { GameId } from '../shared/metrics'
import type { Settings } from '../shared/settings'
import { SettingsDialog } from './SettingsDialog'

function CardArt({ game }: { game: GameCard }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(canvas.clientWidth * dpr) || 640
    canvas.height = Math.round(canvas.clientHeight * dpr) || 400
    const ctx = canvas.getContext('2d')
    if (ctx) game.paint(ctx, canvas.width, canvas.height)
  }, [game])
  return <canvas ref={ref} aria-hidden="true" />
}

export function Hub({ onStart, settings, onSettings }: { onStart: (id: GameId) => void; settings: Settings; onSettings: (s: Settings) => void }) {
  const [showSettings, setShowSettings] = useState(false)
  return (
    <main className="hub">
      <header className="hub-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="38" height="38" viewBox="0 0 64 64"><circle cx="32" cy="38" r="20" fill="#e5483b" /><ellipse cx="25" cy="31" rx="5" ry="7" fill="#ffb3a1" /><path d="M32 18c2-6 8-10 15-9-2 7-8 10-15 9z" fill="#c4e78e" /></svg>
          </div>
          <div>
            <h1>{COPY.productName}</h1>
            <p>{COPY.tagline}</p>
          </div>
        </div>
        <button className="btn btn-secondary btn-small" onClick={() => setShowSettings(true)}>⚙ 设置</button>
      </header>
      <section className="cards" aria-label="游戏选择">
        {GAMES.map((game) => (
          <article key={game.id} className={`card${game.available ? '' : ' card-locked'}`} data-testid={`card-${game.id}`}>
            <div className="card-art">
              <CardArt game={game} />
              {!game.available && <span className="card-badge">{COPY.comingSoon}</span>}
            </div>
            <div className="card-body">
              <h2>{game.name}</h2>
              <span className="card-move">● 主要动作：{game.movement}</span>
              <p>{game.description}</p>
              {game.available ? (
                <button className="btn btn-primary" onClick={() => onStart(game.id)}>开始</button>
              ) : (
                <button className="btn btn-secondary" disabled aria-disabled="true">{COPY.comingSoon}</button>
              )}
            </div>
          </article>
        ))}
      </section>
      <footer className="hub-footer">
        <span className="safety">⚠ {COPY.safety}</span>
        <span>{GAMES[0].english} · {GAMES[1].english} · {GAMES[2].english}</span>
      </footer>
      {showSettings && <SettingsDialog settings={settings} onChange={onSettings} onClose={() => setShowSettings(false)} />}
    </main>
  )
}
