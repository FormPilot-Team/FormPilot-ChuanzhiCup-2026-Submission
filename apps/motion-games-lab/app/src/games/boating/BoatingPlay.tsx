// Boating play screen: the shared GamePlay shell + Boating's round, controller and scene.
import { useCallback } from 'react'
import { FLAGS } from '../../shared/flags'
import { createPhaserHost } from '../../shared/phaserHost'
import { GamePlay } from '../../ui/GamePlay'
import type { PlayProps } from '../types'
import { BoatController } from './controller'
import { BoatRound } from './round'
import { BoatScene } from './BoatScene'

export function BoatingPlay({ session, settings, durationMs, onEnd, onRestart, onExit, onController }: PlayProps) {
  const mount = useCallback((host: HTMLDivElement) => {
    const round = new BoatRound({ difficulty: settings.difficulty, durationMs, seed: FLAGS.seed ?? undefined })
    const controller = new BoatController(session.adapter, round, { restReminderMs: settings.restReminderSeconds * 1000, scheme: FLAGS.strokeScheme })
    const phaser = createPhaserHost(host, 'boating', BoatScene, { controller, dpr: Math.min(2, window.devicePixelRatio || 1), debug: FLAGS.debug })
    return { controller, phaser }
  }, [session, settings, durationMs])

  return (
    <GamePlay
      gameId="boating"
      session={session}
      settings={settings}
      durationMs={durationMs}
      mount={mount}
      comboLabel={(n) => `连划 ×${n}`}
      hud={(c: BoatController) => (
        <>
          <div className="hud-card" aria-label={`已划 ${Math.round(c.round.distance)} 米`}>
            <span className="hud-label">已划</span>
            <span className="hud-value" data-testid="hud-distance">{Math.round(c.round.distance)}<small> 米</small></span>
          </div>
          {c.round.flow && <div className="flow-chip">顺流</div>}
        </>
      )}
      onEnd={onEnd}
      onRestart={onRestart}
      onExit={onExit}
      onController={onController}
    />
  )
}
