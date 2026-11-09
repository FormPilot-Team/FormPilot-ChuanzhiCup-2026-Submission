import type { ExerciseId } from '../features/exercises/types'
import type { TrainingScope } from '../features/training/trainingScope'

export const HOME_PATH = '/'
/** Home's "开始训练" section: the five training modes and the user's own actions. */
export const START_TRAINING_ANCHOR = 'start-training'
export const START_TRAINING_PATH = `${HOME_PATH}#${START_TRAINING_ANCHOR}`
/** 热身训练 entry (internal name: smart training): full course or one exercise, chosen before the camera starts. */
export const SMART_TRAINING_PATH = '/smart-training'
/** The one training page. Without `exercise` it runs the standard six-step course. */
export const TRAINING_PATH = '/train'
export const HISTORY_PATH = '/history'
/** Follow-along routines (八段锦, 太极拳, 五禽戏, 易筋经): index, one entry page per routine, and its training page. */
export const ROUTINES_PATH = '/routines'

/**
 * Web V1 six-board information architecture (design: docs/design/chuanzhi-web/formpilot-web, PR #52).
 * 首页 `/` · 训练中心 `/training` · 功法训练 `/routines` · 游戏中心 `/games` · AI Coach `/coach` · 我的 `/me`.
 */
export const TRAINING_CENTER_PATH = '/training'
export const GAMES_PATH = '/games'
export const COACH_PATH = '/coach'
export const ME_PATH = '/me'
export const ME_SETTINGS_PATH = '/me/settings'

export type WebBoard = 'home' | 'training' | 'routines' | 'games' | 'coach' | 'me'

/** Which first-level board a path belongs to; undefined for paths outside the product (e.g. lab pages). */
export function webBoardOf(pathname: string, search = ''): WebBoard | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (path === TRAINING_CENTER_PATH || path === SMART_TRAINING_PATH || isTrainingRoute(path, search)) return 'training'
  if (path === ROUTINES_PATH || path.startsWith(`${ROUTINES_PATH}/`)) return 'routines'
  if (path === GAMES_PATH) return 'games'
  if (path === COACH_PATH) return 'coach'
  const workshop = parseWorkshopRoute(path)
  if (workshop) return workshop.kind === 'train' ? 'training' : 'me'
  if (path === ME_PATH || path.startsWith(`${ME_PATH}/`) || path === HISTORY_PATH || path.startsWith('/report/')) return 'me'
  return path === HOME_PATH ? 'home' : undefined
}

export function reportPath(sessionId: string): string {
  return `/report/${encodeURIComponent(sessionId)}`
}

export function routinePath(routineId: string): string {
  return `${ROUTINES_PATH}/${encodeURIComponent(routineId)}`
}

/** A routine's training page: the whole routine, or one numbered form (`?form=<chapterId>`). */
export function routineTrainingPath(routineId: string, chapterId?: string): string {
  return `${routinePath(routineId)}/train${chapterId ? `?form=${encodeURIComponent(chapterId)}` : ''}`
}

export type RoutineRoute =
  | { kind: 'index' }
  | { kind: 'entry'; routineId: string }
  | { kind: 'train'; routineId: string }

export function parseRoutineRoute(pathname: string): RoutineRoute | undefined {
  if (pathname === ROUTINES_PATH || pathname === `${ROUTINES_PATH}/`) return { kind: 'index' }
  const match = /^\/routines\/([^/]+)(\/train)?\/?$/.exec(pathname)
  if (!match) return undefined
  let routineId: string
  try {
    routineId = decodeURIComponent(match[1])
  } catch {
    return undefined
  }
  return match[2] ? { kind: 'train', routineId } : { kind: 'entry', routineId }
}

/** 动作工坊: the user's own actions (list), creating one, editing one, and training one. */
export const WORKSHOP_PATH = '/workshop'
export const WORKSHOP_NEW_PATH = `${WORKSHOP_PATH}/new`

export function workshopActionPath(actionId: string): string {
  return `${WORKSHOP_PATH}/${encodeURIComponent(actionId)}`
}

export function customTrainingPath(actionId: string): string {
  return `${workshopActionPath(actionId)}/train`
}

export type WorkshopRoute =
  | { kind: 'home' }
  | { kind: 'new' }
  | { kind: 'edit'; actionId: string }
  | { kind: 'train'; actionId: string }

export function parseWorkshopRoute(pathname: string): WorkshopRoute | undefined {
  if (pathname === WORKSHOP_PATH || pathname === `${WORKSHOP_PATH}/`) return { kind: 'home' }
  if (pathname === WORKSHOP_NEW_PATH || pathname === `${WORKSHOP_NEW_PATH}/`) return { kind: 'new' }
  const match = /^\/workshop\/([^/]+)(\/train)?\/?$/.exec(pathname)
  if (!match) return undefined
  let actionId: string
  try {
    actionId = decodeURIComponent(match[1])
  } catch {
    return undefined
  }
  return match[2] ? { kind: 'train', actionId } : { kind: 'edit', actionId }
}

/** Product free-training entry. Never carries `fast`, which stays a DEV-only test switch. */
export function freeTrainingPath(exerciseId: ExerciseId): string {
  return `${TRAINING_PATH}?exercise=${encodeURIComponent(exerciseId)}`
}

/** Where "train again" leads for a saved session: the same exercise for free training, otherwise the full course. */
export function trainingEntryPath(scope: TrainingScope): string {
  return scope.kind === 'free_training' ? freeTrainingPath(scope.exerciseId) : TRAINING_PATH
}

const LEGACY_TRAINING_PARAMS = ['demo', 'course', 'debug', 'fast', 'exercise', 'fixture', 'coachFixture']

/** `/train`, plus the pre-`/train` diagnostic URLs that still open the training page from `/?demo=1…`. */
export function isTrainingRoute(pathname: string, search: string): boolean {
  if (pathname === TRAINING_PATH) return true
  if (pathname !== HOME_PATH) return false
  const params = new URLSearchParams(search)
  return LEGACY_TRAINING_PARAMS.some((key) => params.has(key))
}
