// Player settings (per browser). Storage can be unavailable (private mode), so every access is guarded.
export type Difficulty = 'easy' | 'standard' | 'challenge'

export interface Settings {
  difficulty: Difficulty
  /** round length; the paper-inspired default is about three minutes */
  roundSeconds: number
  seated: boolean
  sound: boolean
  showMirror: boolean
  /** gentle mid-round "you can rest" reminder; 0 = off */
  restReminderSeconds: number
  /** total play per browser session before a rest break is suggested */
  sessionCapMinutes: number
  /** Archery: the hand that pulls the string (the other holds the bow) */
  drawSide: 'left' | 'right'
}

export const DEFAULT_SETTINGS: Settings = {
  difficulty: 'easy',
  roundSeconds: 180,
  seated: false,
  sound: true,
  showMirror: true,
  restReminderSeconds: 90,
  sessionCapMinutes: 15,
  drawSide: 'right',
}

export const ROUND_OPTIONS = [60, 120, 180, 240] as const
export const SESSION_CAP_OPTIONS = [10, 15, 20, 30] as const

const KEY = 'motion-games-lab.settings.v1'
const PLAYED_KEY = 'motion-games-lab.played-ms.v1'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    // storage unavailable: defaults
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // ignore
  }
}

/** Active play time in this browser session (sessionStorage, resets when the browser closes). */
export function playedThisSessionMs(): number {
  try {
    return Number(sessionStorage.getItem(PLAYED_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

export function addPlayedMs(ms: number): void {
  try {
    sessionStorage.setItem(PLAYED_KEY, String(playedThisSessionMs() + Math.max(0, ms)))
  } catch {
    // ignore
  }
}

export function resetPlayed(): void {
  try {
    sessionStorage.removeItem(PLAYED_KEY)
  } catch {
    // ignore
  }
}
