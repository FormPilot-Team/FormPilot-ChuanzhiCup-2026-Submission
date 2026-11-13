import { BookOpen, Flame, Leaf, type LucideIcon, Mountain, Orbit, PawPrint, WandSparkles } from 'lucide-react'
import { ROUTINE_PROGRAMS } from '../features/routines/programs'
import { formatClock, formCount } from '../features/routines/scope'
import type { RoutineId } from '../features/routines/types'
import { SMART_TRAINING_PATH, WORKSHOP_PATH, routinePath } from './routes'

export type ModeStatus = 'available' | 'coming_soon'

/** Decorative motion motif of a mode card: one visual system, a different movement signature per mode. */
export type ModeMotif = 'pulse' | 'lift' | 'orbit' | 'leap' | 'stretch'

/**
 * Accent family: a low-saturation card tint, the silhouette and the motion trail only. Actions, focus rings and links
 * stay FormPilot blue. 热身训练 blue, 八段锦 warm orange, 太极拳 lavender, 五禽戏 mint, 易筋经 rose.
 */
export type ModeAccent = 'brand' | 'orange' | 'violet' | 'emerald' | 'rose'

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
  /** A few words of character for the card (the full description stays available to screen readers). */
  summary?: string
  /** Light emphasis only (e.g. 推荐); never a larger card, never a different button. */
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
 * The one entry wording on every Home training card: the five modes are equal entries, and the route (not the button)
 * decides whether a warm-up or a follow-along course opens.
 */
export const MODE_CARD_CTA = '开始训练'

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
  cta: MODE_CARD_CTA,
  meta: '6 个动作 · 完整或单项练习',
  summary: '实时纠正 · 全程语音指导',
  badge: '推荐',
  icon: Flame,
  motif: 'pulse',
  accent: 'brand',
} satisfies ModeHubEntry)

/** Card look of each follow-along course; the summaries are taken from the programs' own descriptions and cues. */
const ROUTINE_LOOK: Readonly<Record<RoutineId, { icon: LucideIcon; motif: ModeMotif; summary: string }>> = {
  baduanjin: { icon: Leaf, motif: 'lift', summary: '动作舒缓 · 视频含呼吸口令' },
  taijiquan: { icon: Orbit, motif: 'orbit', summary: '起势到收势 · 连贯演练' },
  wuqinxi: { icon: PawPrint, motif: 'leap', summary: '仿虎鹿熊猿鸟 · 含呼吸口令' },
  yijinjing: { icon: Mountain, motif: 'stretch', summary: '动作舒展 · 拔伸筋骨' },
}

/** Follow-along courses (internally: routines); each opens its own entry page. */
export const ROUTINE_MODES: readonly ModeHubEntry[] = Object.freeze(ROUTINE_PROGRAMS.map((program) => ({
  id: program.id,
  title: program.title,
  description: `${program.subtitle}，跟随标准视频练习，实时比对动作与节奏。`,
  status: 'available' as const,
  route: routinePath(program.id),
  cta: MODE_CARD_CTA,
  meta: `全套 ${formatClock(program.video.durationSeconds)} · ${formCount(program)} ${program.formUnit}`,
  summary: ROUTINE_LOOK[program.id].summary,
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
  description: '教 FormPilot 学会你的动作：示范采集、识别测试并保存，之后就能直接训练。',
  status: 'available',
  route: WORKSHOP_PATH,
  cta: '进入动作工坊',
  icon: WandSparkles,
  motif: 'pulse',
  accent: 'brand',
} satisfies ModeHubEntry)

/** The workshop's user flow, in user language. */
export const WORKSHOP_FLOW = ['动作信息', '示范采集', '识别测试', '保存并训练'] as const

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
