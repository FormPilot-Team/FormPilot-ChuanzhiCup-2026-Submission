/**
 * 游戏中心 (Web V1): the three Motion Games Lab games shown on the #52 design cards.
 *
 * The games are NOT re-implemented here. They run in the separate Motion Games Lab app
 * (apps/motion-games-lab/app, MediaPipe Pose + Phaser), which opens a game directly with `?game=<id>`.
 * The platform only checks that the app answers, opens it in its own window, and lets the user come back.
 * Game scores stay inside that app: they never enter formal training records, 完成度 or 五维能力.
 */
export type WebGameId = 'apple' | 'boating' | 'archery'

export interface WebGame {
  id: WebGameId
  title: string
  action: string
  description: string
  copy: string
  image: string
  alt: string
}

/** Card copy and art come verbatim from docs/design/chuanzhi-web/formpilot-web/game/index.html. */
export const WEB_GAMES: readonly WebGame[] = Object.freeze([
  { id: 'apple', title: '摘苹果', action: '向上、向侧面伸手', description: '果园里的苹果熟了。把手伸到苹果上停一下，苹果就会落进篮子里。', copy: '把手伸向屏幕里的苹果并短暂停留，练习舒展手臂。动作保持轻松，不要勉强伸展。', image: '/web-v1/game/apple-orchard.jpg', alt: '森林果园里长满红苹果，树下放着采摘篮' },
  { id: 'boating', title: '林间划船', action: '双臂交替向前划动', description: '坐上林间的小船，跟随节奏交替划桨，练习肩部活动和协调性。', copy: '跟随节奏交替划桨，练习肩部活动和身体协调。动作保持均匀，不要过度用力。', image: '/web-v1/game/forest-boating.jpg', alt: '森林湖面上的小船和清澈水面' },
  { id: 'archery', title: '林间射箭', action: '侧身伸展并保持稳定', description: '在林间瞄准目标，缓慢伸展手臂并保持片刻，练习稳定与专注。', copy: '缓慢伸展手臂并保持片刻，练习稳定与专注。保持呼吸自然，在舒适范围内完成动作。', image: '/web-v1/game/forest-archery.jpg', alt: '森林中拉弓瞄准靶心的射箭场景' },
])

export function findWebGame(id: string | null | undefined): WebGame | undefined {
  return WEB_GAMES.find((game) => game.id === id)
}

/** Motion Games Lab production preview (`pnpm --dir apps/motion-games-lab/app preview`). Override with VITE_MOTION_GAMES_URL. */
export const DEFAULT_MOTION_GAMES_URL = 'http://127.0.0.1:5181/'

export function motionGamesBaseUrl(env: { VITE_MOTION_GAMES_URL?: string } = import.meta.env as { VITE_MOTION_GAMES_URL?: string }): string {
  const configured = env.VITE_MOTION_GAMES_URL?.trim()
  return configured ? configured : DEFAULT_MOTION_GAMES_URL
}

export function motionGameUrl(id: WebGameId, base = motionGamesBaseUrl()): string {
  const url = new URL(base, typeof window === 'undefined' ? 'http://127.0.0.1/' : window.location.href)
  url.searchParams.set('game', id)
  return url.toString()
}

export type GameServiceStatus = 'checking' | 'available' | 'unavailable'

/**
 * Whether the Motion Games Lab app answers at all. A `no-cors` request succeeds (opaque response) when a server
 * is listening and rejects when nothing is. It says nothing about the camera; the game app checks that itself.
 */
export async function probeMotionGames(base = motionGamesBaseUrl(), timeoutMs = 2500, fetcher: typeof fetch = fetch): Promise<Exclude<GameServiceStatus, 'checking'>> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController()
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    await fetcher(base, { mode: 'no-cors', cache: 'no-store', signal: controller?.signal })
    return 'available'
  } catch {
    return 'unavailable'
  } finally {
    if (timer) clearTimeout(timer)
  }
}
