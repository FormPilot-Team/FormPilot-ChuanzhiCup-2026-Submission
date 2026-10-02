// Apple Picking play screen: the shared GamePlay shell + Apple's round, controller and scene.
import { useCallback } from 'react'
import { defaultCalibration } from '../../motion/calibration'
import { FLAGS } from '../../shared/flags'
import { createPhaserHost } from '../../shared/phaserHost'
import { GamePlay } from '../../ui/GamePlay'
import type { PlayProps } from '../types'
import { AppleController } from './controller'
import { ReachModel } from './reach'
import { AppleRound } from './round'
import { AppleScene } from './AppleScene'

export function ApplePlay({ session, profile, settings, durationMs, onEnd, onRestart, onExit, onController }: PlayProps) {
  const mount = useCallback((host: HTMLDivElement) => {
    const round = new AppleRound({
      difficulty: settings.difficulty,
      durationMs,
      reach: new ReachModel(profile ?? defaultCalibration()),
      seed: FLAGS.seed ?? undefined,
    })
    const controller = new AppleController(session.adapter, round, { restReminderMs: settings.restReminderSeconds * 1000 })
    const phaser = createPhaserHost(host, 'apple', AppleScene, { controller, dpr: Math.min(2, window.devicePixelRatio || 1), debug: FLAGS.debug })
    return { controller, phaser }
  }, [session, profile, settings, durationMs])

  return (
    <GamePlay
      gameId="apple"
      session={session}
      settings={settings}
      durationMs={durationMs}
      mount={mount}
      comboLabel={(n) => `连摘 ×${n}`}
      onEnd={onEnd}
      onRestart={onRestart}
      onExit={onExit}
      onController={onController}
    />
  )
}
