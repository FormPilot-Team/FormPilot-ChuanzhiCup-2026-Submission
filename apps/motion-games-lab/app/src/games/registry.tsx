// The three games as the shared flow sees them: play component, instruction art, difficulty wording.
import type { ComponentType } from 'react'
import type { BotKind } from '../motion/synthetic'
import type { GameId } from '../shared/metrics'
import type { Difficulty } from '../shared/settings'
import { HowBasket, HowBowDraw, HowBowReady, HowBowReturn, HowHold, HowLantern, HowPaddleReady, HowPaddleSweep, HowReach } from '../ui/Illustrations'
import { DIFFICULTIES } from './apple/config'
import { ApplePlay } from './apple/ApplePlay'
import { ARCHERY_DIFFICULTIES } from './archery/config'
import { ArcheryPlay } from './archery/ArcheryPlay'
import { BOAT_DIFFICULTIES } from './boating/config'
import { BoatingPlay } from './boating/BoatingPlay'
import type { PlayProps } from './types'

export interface GameDefinition {
  id: GameId
  bot: BotKind
  Play: ComponentType<PlayProps>
  howArt: ComponentType[]
  difficulty: Record<Difficulty, { label: string; description: string }>
  /** Archery: let the player choose which hand pulls the string */
  drawSideOption?: boolean
}

export const REGISTRY: Record<GameId, GameDefinition> = {
  apple: { id: 'apple', bot: 'apple', Play: ApplePlay, howArt: [HowReach, HowHold, HowBasket], difficulty: DIFFICULTIES },
  boating: { id: 'boating', bot: 'boating', Play: BoatingPlay, howArt: [HowPaddleReady, HowPaddleSweep, HowLantern], difficulty: BOAT_DIFFICULTIES },
  archery: { id: 'archery', bot: 'archery', Play: ArcheryPlay, howArt: [HowBowReady, HowBowDraw, HowBowReturn], difficulty: ARCHERY_DIFFICULTIES, drawSideOption: true },
}
