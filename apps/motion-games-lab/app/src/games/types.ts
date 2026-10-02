// What every game's play component receives from the shared flow (GameFlow).
import type { CalibrationProfile } from '../motion/contracts'
import type { MotionSession } from '../motion/session'
import type { GameResult } from '../shared/metrics'
import type { Settings } from '../shared/settings'
import type { AnyController } from '../ui/GamePlay'

export interface PlayProps {
  session: MotionSession
  profile: CalibrationProfile | null
  settings: Settings
  durationMs: number
  onEnd: (result: GameResult) => void
  onRestart: () => void
  onExit: () => void
  onController?: (controller: AnyController | null) => void
}
