import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OnboardingDialog } from '../src/components/onboarding/OnboardingDialog'
import { DEFAULT_GESTURE_HOLD_CONFIG } from '../src/features/gesture/GestureHoldController'
import {
  GESTURE_HOLD_TEXT, ONBOARDING_STEPS, ONBOARDING_STORAGE_KEY, readOnboardingRecord, recordOnboarding, shouldAutoOpenOnboarding,
} from '../src/features/onboarding/onboarding'
import { SESSION_STORAGE_KEY } from '../src/features/training/LocalStorageTrainingSessionRepository'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

const throwingStorage = {
  getItem: () => { throw new Error('storage disabled') },
  setItem: () => { throw new Error('storage disabled') },
}

const stepText = (id: string) => {
  const step = ONBOARDING_STEPS.find((item) => item.id === id)
  if (!step) throw new Error(`missing step ${id}`)
  return [step.title, step.lead, ...step.points].join('\n')
}

describe('onboarding persistence', () => {
  it('uses its own versioned key, separate from the training session repository', () => {
    expect(ONBOARDING_STORAGE_KEY).toBe('formpilot.onboarding:v1')
    expect(ONBOARDING_STORAGE_KEY).not.toBe(SESSION_STORAGE_KEY)
  })

  it('opens by itself only until the guide was completed or closed once', () => {
    const completed = memoryStorage()
    expect(shouldAutoOpenOnboarding(completed)).toBe(true)
    expect(recordOnboarding('completed', 1_000, completed)).toBe(true)
    expect(shouldAutoOpenOnboarding(completed)).toBe(false)
    expect(JSON.parse(completed.values.get(ONBOARDING_STORAGE_KEY) ?? 'null')).toEqual({ version: 1, outcome: 'completed', at: 1_000 })

    const dismissed = memoryStorage()
    recordOnboarding('dismissed', 2_000, dismissed)
    expect(shouldAutoOpenOnboarding(dismissed)).toBe(false)
    expect(readOnboardingRecord(dismissed)).toEqual({ version: 1, outcome: 'dismissed', at: 2_000 })
  })

  it('never downgrades a completed guide when it is reopened and closed later', () => {
    const storage = memoryStorage()
    recordOnboarding('completed', 1_000, storage)
    recordOnboarding('dismissed', 5_000, storage)
    expect(readOnboardingRecord(storage)).toEqual({ version: 1, outcome: 'completed', at: 1_000 })
    recordOnboarding('completed', 9_000, storage)
    expect(readOnboardingRecord(storage)?.at).toBe(9_000)
  })

  it('treats a corrupt or foreign value as unseen instead of crashing', () => {
    for (const raw of ['{', '"completed"', '{"version":2,"outcome":"completed","at":1}', '{"version":1,"outcome":"maybe","at":1}', '{"version":1,"outcome":"completed"}']) {
      expect(shouldAutoOpenOnboarding(memoryStorage({ [ONBOARDING_STORAGE_KEY]: raw }))).toBe(true)
    }
  })

  it('survives unavailable storage: the guide still opens and recording reports failure', () => {
    expect(shouldAutoOpenOnboarding(throwingStorage)).toBe(true)
    expect(recordOnboarding('completed', 1, throwingStorage)).toBe(false)
    expect(shouldAutoOpenOnboarding(undefined)).toBe(true)
    expect(recordOnboarding('completed', 1, undefined)).toBe(false)
  })
})

describe('onboarding content and gesture tutorial copy', () => {
  it('stays short: four pages in welcome, start, pause, framing order', () => {
    expect(ONBOARDING_STEPS.map((step) => step.id)).toEqual(['welcome', 'start-gesture', 'pause-gesture', 'framing'])
    expect(ONBOARDING_STEPS.length).toBeLessThanOrEqual(4)
    expect(stepText('welcome')).toContain('欢迎使用 FormPilot')
    for (const point of ['摄像头实时识别动作', '训练中实时纠错', '语音指导', '训练结束后自动生成报告']) expect(stepText('welcome')).toContain(point)
  })

  it('derives the hold time from the runtime gesture config', () => {
    expect(DEFAULT_GESTURE_HOLD_CONFIG.holdDurationMs).toBe(1200)
    expect(GESTURE_HOLD_TEXT).toBe('约 1.2 秒')
  })

  it('teaches start / resume with both hands together in front of the chest, only in ready or paused states', () => {
    const text = stepText('start-gesture')
    expect(text).toContain('开始 / 继续')
    expect(text).toContain('双手在胸前合拢')
    expect(text).toContain('约 1.2 秒')
    expect(text).toContain('即可开始或继续训练')
    expect(text).toContain('准备阶段')
    expect(text).toContain('暂停时')
    expect(text).toContain('只在准备阶段和暂停时有效')
  })

  it('teaches pause with forearms crossed into an X in front of the chest', () => {
    const text = stepText('pause-gesture')
    expect(text).toContain('暂停')
    expect(text).toContain('双臂在胸前交叉成 X')
    expect(text).toContain('约 1.2 秒')
    expect(text).toContain('训练进行中有效')
  })

  it('covers framing with the three required reminders', () => {
    const text = stepText('framing')
    expect(text).toContain('保持完整入镜')
    expect(text).toContain('训练时确保身体关键部位进入摄像头画面')
    expect(text).toContain('系统会在准备阶段提示调整位置')
    expect(text).toContain('必要时可以使用页面按钮控制训练')
  })

  it('never shows engineering names to the user', () => {
    const copy = ONBOARDING_STEPS.map((step) => stepText(step.id)).join('\n')
    const html = renderToStaticMarkup(createElement(OnboardingDialog, { open: true, onClose: () => undefined }))
    for (const text of [copy, html]) {
      expect(text).not.toMatch(/GestureHoldController|GestureRuntimeController|START_GESTURE|PAUSE_GESTURE|holdDurationMs|localStorage/)
    }
  })

  it('renders the first page with its navigation, and a closed dialog renders no page content', () => {
    const open = renderToStaticMarkup(createElement(OnboardingDialog, { open: true, onClose: () => undefined }))
    expect(open).toContain('data-testid="onboarding-dialog"')
    expect(open).toContain('data-step="welcome"')
    expect(open).toContain('欢迎使用 FormPilot')
    expect(open).toContain('跳过')
    expect(open).toContain('下一步')
    expect(open).toContain('aria-label="关闭使用说明"')
    expect(open).toContain('aria-labelledby="onboarding-title"')
    const closed = renderToStaticMarkup(createElement(OnboardingDialog, { open: false, onClose: () => undefined }))
    expect(closed).not.toContain('欢迎使用 FormPilot')
  })

  it('can open directly on the gesture page', () => {
    const html = renderToStaticMarkup(createElement(OnboardingDialog, { open: true, onClose: () => undefined, initialStepId: 'start-gesture' }))
    expect(html).toContain('data-step="start-gesture"')
    expect(html).toContain('双手在胸前合拢并保持约 1.2 秒，即可开始或继续训练。')
    expect(html).toContain('上一步')
    expect(html).toContain('aria-label="示意图：双手在胸前合拢"')
  })
})
