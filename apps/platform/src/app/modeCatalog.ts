import { BookOpen, Dumbbell, History, Leaf, type LucideIcon, Orbit, Wrench } from 'lucide-react'
import { HISTORY_PATH, SMART_TRAINING_PATH } from './routes'

export type ModeStatus = 'available' | 'coming_soon'

/**
 * One Mode Hub entry. Integrating a mode later only means giving it a `route` and switching `status` to
 * 'available'; a coming-soon entry is rendered without any link or button, so it can never open an empty page.
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

/** First tier: training modes. The first entry is the current primary product entry. */
export const TRAINING_MODES: readonly ModeHubEntry[] = Object.freeze([
  {
    id: 'smart-training',
    title: '智能训练',
    description: '实时识别你的动作，训练中给出纠错提示和语音指导，结束后生成训练报告。',
    status: 'available',
    route: SMART_TRAINING_PATH,
    cta: '进入训练',
    highlights: ['实时姿态识别', 'AI 纠错', '语音指导', '训练报告'],
    icon: Dumbbell,
  },
  {
    id: 'baduanjin',
    title: '八段锦',
    description: '跟随示范完成八段锦练习，并获得姿态指导。',
    status: 'coming_soon',
    icon: Leaf,
  },
  {
    id: 'taichi',
    title: '太极拳',
    description: '跟随示范练习太极拳动作，并获得姿态指导。',
    status: 'coming_soon',
    icon: Orbit,
  },
] satisfies ModeHubEntry[])

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
