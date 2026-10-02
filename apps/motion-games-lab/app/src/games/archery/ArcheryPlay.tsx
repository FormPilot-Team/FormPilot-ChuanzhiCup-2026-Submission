// Archery play screen: the shared GamePlay shell + Archery's round, controller and scene, plus the
// step strip (准备 → 拉弓 → 稳住 → 放箭) that makes the state machine visible to the player.
import { useCallback } from 'react'
import { DEFAULT_REACH } from '../../motion/calibration'
import { FLAGS } from '../../shared/flags'
import { createPhaserHost } from '../../shared/phaserHost'
import { GamePlay } from '../../ui/GamePlay'
import type { PlayProps } from '../types'
import { STAGES } from './config'
import { ArcheryController, type ArcheryPhase } from './controller'
import { ArcheryRound } from './round'
import { ArcheryScene } from './ArcheryScene'

const STEPS: { label: string; phases: ArcheryPhase[] }[] = [
  { label: '准备', phases: ['READY', 'RESET'] },
  { label: '拉弓', phases: ['DRAW'] },
  { label: '稳住', phases: ['HOLD'] },
  { label: '放箭', phases: ['RELEASE', 'HIT'] },
]

export function ArcheryPlay({ session, profile, settings, durationMs, onEnd, onRestart, onExit, onController }: PlayProps) {
  const mount = useCallback((host: HTMLDivElement) => {
    const round = new ArcheryRound({ difficulty: settings.difficulty, durationMs })
    const reach = profile?.reach ?? DEFAULT_REACH
    const armLength = (reach.left.armLength + reach.right.armLength) / 2
    const controller = new ArcheryController(session.adapter, round, { restReminderMs: settings.restReminderSeconds * 1000, drawSide: settings.drawSide, armLength })
    const phaser = createPhaserHost(host, 'archery', ArcheryScene, { controller, dpr: Math.min(2, window.devicePixelRatio || 1), debug: FLAGS.debug })
    return { controller, phaser }
  }, [session, profile, settings, durationMs])

  return (
    <GamePlay
      gameId="archery"
      session={session}
      settings={settings}
      durationMs={durationMs}
      mount={mount}
      comboLabel={(n) => `连中 ×${n}`}
      hud={(c: ArcheryController) => (
        <div className="hud-card" aria-label={`第 ${c.round.shots.length + 1} 箭，${STAGES[c.round.stage].name}`}>
          <span className="hud-label">{STAGES[c.round.stage].name}</span>
          <span className="hud-value" data-testid="hud-shots">{c.round.hits()}<small> / {c.round.shots.length} 中</small></span>
        </div>
      )}
      instruction={(c: ArcheryController) => {
        const phase = c.phase()
        const text = c.instruction()
        return (
          <>
            <span className="steps" aria-hidden="true">
              {STEPS.map((s) => <i key={s.label} className={s.phases.includes(phase) ? 'on' : ''}>{s.label}</i>)}
            </span>
            {text && <b data-phase={phase}>{text}</b>}
          </>
        )
      }}
      onEnd={onEnd}
      onRestart={onRestart}
      onExit={onExit}
      onController={onController}
    />
  )
}
