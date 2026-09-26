import { BookOpen, Flame, Leaf, type LucideIcon, Mountain, Orbit, PawPrint, WandSparkles } from 'lucide-react'
import { ROUTINE_PROGRAMS } from '../features/routines/programs'
import { formatClock, formCount } from '../features/routines/scope'
import type { RoutineId } from '../features/routines/types'
import { SMART_TRAINING_PATH, routinePath } from './routes'

export type ModeStatus = 'available' | 'coming_soon'

/** Decorative motion motif of a mode card: one visual system, a different movement signature per mode. */
export type ModeMotif = 'pulse' | 'lift' | 'orbit' | 'leap' | 'stretch'

/** Accent family: tints and motif strokes only. Actions, focus rings and links stay FormPilot blue. */
export type ModeAccent = 'brand' | 'emerald' | 'indigo' | 'amber' | 'violet'

/**
 * One training mode or tool on Home. Integrating a mode means giving it a `route` and switching `status` to
 * 'available'; a coming-soon entry is rendered without any link or button, so it can never open an empty page.
 */
export interface ModeHubEntry {
  id: string
  title: string
  description: string
  status: ModeStatus
  route?: string
  cta?: string
  /** One short line of facts (length, number of forms …). */
  meta?: string
  /** Light emphasis only (e.g. 推荐); never a larger card. */
  badge?: string
  icon: LucideIcon
  motif: ModeMotif
  accent: ModeAccent
}

export const MODE_STATUS_LABEL: Readonly<Record<ModeStatus, string>> = Object.freeze({
  available: '可使用',
  coming_soon: '即将开放',
})

/**
 * 热身训练: the six-exercise course with realtime correction. Internally still "smart training" (route, session
 * store, analysis-v1); only the product name changed.
 */
export const WARM_UP_MODE: ModeHubEntry = Object.freeze({
  id: 'smart-training',
  title: '热身训练',
  description: '6 个热身动作，实时识别并纠正动作，全程语音指导，结束生成训练报告。',
  status: 'available',
  route: SMART_TRAINING_PATH,
  cta: '开始训练',
  meta: '6 个动作 · 完整或单项练习',
  badge: '推荐',
  icon: Flame,
  motif: 'pulse',
  accent: 'brand',
} satisfies ModeHubEntry)

const ROUTINE_LOOK: Readonly<Record<RoutineId, { icon: LucideIcon; motif: ModeMotif }>> = {
  baduanjin: { icon: Leaf, motif: 'lift' },
  taijiquan: { icon: Orbit, motif: 'orbit' },
  wuqinxi: { icon: PawPrint, motif: 'leap' },
  yijinjing: { icon: Mountain, motif: 'stretch' },
}

/** Follow-along courses (internally: routines); each opens its own entry page. */
export const ROUTINE_MODES: readonly ModeHubEntry[] = Object.freeze(ROUTINE_PROGRAMS.map((program) => ({
  id: program.id,
  title: program.title,
  description: `${program.subtitle}，跟随标准视频练习，实时比对动作与节奏。`,
  status: 'available' as const,
  route: routinePath(program.id),
  cta: '开始跟练',
  meta: `全套 ${formatClock(program.video.durationSeconds)} · ${formCount(program)} ${program.formUnit}`,
  icon: ROUTINE_LOOK[program.id].icon,
  motif: ROUTINE_LOOK[program.id].motif,
  accent: program.accent,
})))

/** "开始训练": five official modes on one level. The warm-up is first and lightly emphasised, never bigger. */
export const TRAINING_MODES: readonly ModeHubEntry[] = Object.freeze([WARM_UP_MODE, ...ROUTINE_MODES])

/** 动作工坊: create, test and save your own actions. */
export const WORKSHOP_ENTRY: ModeHubEntry = Object.freeze({
  id: 'motion-workshop',
  title: '动作工坊',
  description: '教 FormPilot 学会你的动作：设置识别要求、测试并保存，之后就能直接训练。',
  status: 'coming_soon',
  icon: WandSparkles,
  motif: 'pulse',
  accent: 'brand',
} satisfies ModeHubEntry)

/** The workshop's user flow, in user language. */
export const WORKSHOP_FLOW = ['创建动作', '设置识别要求', '测试', '保存', '开始训练'] as const

/** 使用说明 is a utility, not a product area: a small entry next to the Home hero. */
export const GUIDE_ENTRY = Object.freeze({
  title: '使用说明',
  description: '开始、暂停手势和入镜要求。',
  icon: BookOpen,
})

/** A link target only for available entries; everything else stays a static card. */
export function modeEntryRoute(entry: ModeHubEntry): string | undefined {
  return entry.status === 'available' ? entry.route : undefined
}
