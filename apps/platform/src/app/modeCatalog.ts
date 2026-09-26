import { BookOpen, Dumbbell, History, Leaf, type LucideIcon, Mountain, Orbit, PawPrint, Wrench } from 'lucide-react'
import { ROUTINE_PROGRAMS } from '../features/routines/programs'
import type { RoutineId } from '../features/routines/types'
import { HISTORY_PATH, SMART_TRAINING_PATH, routinePath } from './routes'

export type ModeStatus = 'available' | 'coming_soon'

/**
 * One Mode Hub entry. Integrating a mode means giving it a `route` and switching `status` to 'available'; a
 * coming-soon entry is rendered without any link or button, so it can never open an empty page.
 */
export interface ModeHubEntry {
  id: string
  title: string
  description: string
  status: ModeStatus
  route?: string
  cta?: string
  highlights?: readonly string[]
  icon: LucideIcon
}

export const MODE_STATUS_LABEL: Readonly<Record<ModeStatus, string>> = Object.freeze({
  available: '可使用',
  coming_soon: '即将整合',
})

/** The primary training mode: first on the Mode Hub and the largest card. */
export const PRIMARY_TRAINING_MODE: ModeHubEntry = Object.freeze({
  id: 'smart-training',
  title: '智能训练',
  description: '实时识别你的动作，训练中给出纠错提示和语音指导，结束后生成训练报告。',
  status: 'available',
  route: SMART_TRAINING_PATH,
  cta: '进入训练',
  highlights: ['实时姿态识别', 'AI 纠错', '语音指导', '训练报告'],
  icon: Dumbbell,
} satisfies ModeHubEntry)

const ROUTINE_ICONS: Readonly<Record<RoutineId, LucideIcon>> = {
  baduanjin: Leaf,
  taijiquan: Orbit,
  wuqinxi: PawPrint,
  yijinjing: Mountain,
}

/** Follow-along routines, integrated from the teammate version; each opens its own entry page. */
export const ROUTINE_MODES: readonly ModeHubEntry[] = Object.freeze(ROUTINE_PROGRAMS.map((program) => ({
  id: program.id,
  title: program.title,
  description: `${program.subtitle}，跟随标准视频练习，实时比对动作与节奏。`,
  status: 'available' as const,
  route: routinePath(program.id),
  cta: '开始跟练',
  icon: ROUTINE_ICONS[program.id],
})))

/** First tier: training modes. The first entry is the primary product entry. */
export const TRAINING_MODES: readonly ModeHubEntry[] = Object.freeze([PRIMARY_TRAINING_MODE, ...ROUTINE_MODES])

/** Second tier: tools and records. "使用说明" is local help, so the Home page adds it next to these. */
export const TOOL_ENTRIES: readonly ModeHubEntry[] = Object.freeze([
  {
    id: 'motion-workshop',
    title: '动作工坊',
    description: '创建动作、设置识别要求并测试，保存成自己的训练。',
    status: 'coming_soon',
    icon: Wrench,
  },
  {
    id: 'history',
    title: '训练记录',
    description: '查看每次训练报告和近期进步。',
    status: 'available',
    route: HISTORY_PATH,
    icon: History,
  },
] satisfies ModeHubEntry[])

export const GUIDE_ENTRY = Object.freeze({
  title: '使用说明',
  description: '开始、暂停手势和入镜要求。',
  icon: BookOpen,
})

/** A link target only for available entries; everything else stays a static card. */
export function modeEntryRoute(entry: ModeHubEntry): string | undefined {
  return entry.status === 'available' ? entry.route : undefined
}
