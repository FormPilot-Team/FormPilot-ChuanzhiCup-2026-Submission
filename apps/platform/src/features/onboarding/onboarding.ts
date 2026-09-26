import { DEFAULT_GESTURE_HOLD_CONFIG } from '../gesture/GestureHoldController'

/** First-run guide state. Separate from training sessions; it is never written by the session repository. */
export const ONBOARDING_STORAGE_KEY = 'formpilot.onboarding:v1'

export type OnboardingOutcome = 'completed' | 'dismissed'

export interface OnboardingRecord {
  version: 1
  outcome: OnboardingOutcome
  at: number
}

type OnboardingStorage = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): OnboardingStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function isOnboardingRecord(value: unknown): value is OnboardingRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<OnboardingRecord>
  return record.version === 1
    && (record.outcome === 'completed' || record.outcome === 'dismissed')
    && typeof record.at === 'number' && Number.isFinite(record.at)
}

export function readOnboardingRecord(storage: OnboardingStorage | undefined = browserStorage()): OnboardingRecord | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(ONBOARDING_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isOnboardingRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The guide opens by itself only until it has been finished or closed once. */
export function shouldAutoOpenOnboarding(storage: OnboardingStorage | undefined = browserStorage()): boolean {
  return readOnboardingRecord(storage) === null
}

/** A later dismissal of a reopened guide never downgrades an earlier completion. */
export function recordOnboarding(
  outcome: OnboardingOutcome,
  now = Date.now(),
  storage: OnboardingStorage | undefined = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    if (outcome === 'dismissed' && readOnboardingRecord(storage)?.outcome === 'completed') return true
    const record: OnboardingRecord = { version: 1, outcome, at: now }
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)
}

/** Derived from the runtime hold time so the guide can never drift from the real gesture behaviour. */
export const GESTURE_HOLD_TEXT = `约 ${formatSeconds(DEFAULT_GESTURE_HOLD_CONFIG.holdDurationMs)} 秒`

export type OnboardingStepId = 'welcome' | 'start-gesture' | 'pause-gesture' | 'framing'

export interface OnboardingStep {
  id: OnboardingStepId
  title: string
  lead: string
  points: readonly string[]
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = Object.freeze([
  {
    id: 'welcome',
    title: '欢迎使用 FormPilot',
    lead: '站在摄像头前，跟着提示完成训练。',
    points: ['摄像头实时识别动作', '训练中实时纠错', '语音指导', '训练结束后自动生成报告'],
  },
  {
    id: 'start-gesture',
    title: '开始 / 继续训练',
    lead: `双手在胸前合拢并保持${GESTURE_HOLD_TEXT}，即可开始或继续训练。`,
    points: ['准备阶段：身体完整入镜后，合拢双手开始训练', '暂停时：合拢双手继续训练', '只在准备阶段和暂停时有效'],
  },
  {
    id: 'pause-gesture',
    title: '暂停训练',
    lead: `双臂在胸前交叉成 X 并保持${GESTURE_HOLD_TEXT}，即可暂停训练。`,
    points: ['训练进行中有效', '暂停后，双手在胸前合拢即可继续'],
  },
  {
    id: 'framing',
    title: '保持完整入镜',
    lead: '开始前站到合适的位置，让摄像头看清你的动作。',
    points: ['训练时确保身体关键部位进入摄像头画面', '系统会在准备阶段提示调整位置', '必要时可以使用页面按钮控制训练'],
  },
] satisfies OnboardingStep[])
