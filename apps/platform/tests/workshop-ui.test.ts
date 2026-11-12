import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { customTrainingPath, parseWorkshopRoute, workshopActionPath } from '../src/app/routes'
import { createDraftAction } from '../src/features/workshop/definition'
import { standingPose } from '../src/features/workshop/fixture'
import { MemoryCustomActionRepository } from '../src/features/workshop/store'
import type { CapturedPose, CustomActionDefinition } from '../src/features/workshop/types'
import { ActionEditorPage } from '../src/pages/Workshop/ActionEditorPage'
import { WorkshopHomePage } from '../src/pages/Workshop/WorkshopHomePage'

const NOW = new Date('2026-09-27T08:00:00.000Z')

function capture(degrees: number): CapturedPose {
  return { landmarks: standingPose(degrees).map(({ x, y, z, visibility }) => ({ x, y, z, visibility })), aspect: 16 / 9, frames: 12, capturedAt: NOW.toISOString() }
}

function action(id: string, patch: Partial<CustomActionDefinition> = {}): CustomActionDefinition {
  return {
    ...createDraftAction(NOW, id),
    name: '侧平举练习',
    description: '双臂侧平举到肩高再放下',
    startPose: { description: '双臂下垂', capture: capture(8) },
    finishPose: { description: '双臂抬到肩高', capture: capture(90) },
    test: { status: 'passed', repsDetected: 3, repsPassed: 3 },
    ...patch,
  }
}

describe('workshop routes', () => {
  it('parses the library, a new action, editing and training one', () => {
    expect(parseWorkshopRoute('/workshop')).toEqual({ kind: 'home' })
    expect(parseWorkshopRoute('/workshop/')).toEqual({ kind: 'home' })
    expect(parseWorkshopRoute('/workshop/new')).toEqual({ kind: 'new' })
    expect(parseWorkshopRoute('/workshop/custom-abc')).toEqual({ kind: 'edit', actionId: 'custom-abc' })
    expect(parseWorkshopRoute('/workshop/custom-abc/train')).toEqual({ kind: 'train', actionId: 'custom-abc' })
    expect(parseWorkshopRoute('/workshop/a/b/c')).toBeUndefined()
    expect(parseWorkshopRoute('/workshop/%E0%A4%A')).toBeUndefined()
    expect(parseWorkshopRoute('/workshops')).toBeUndefined()
    expect(workshopActionPath('custom-a b')).toBe('/workshop/custom-a%20b')
    expect(customTrainingPath('custom-1')).toBe('/workshop/custom-1/train')
  })
})

describe('workshop library page', () => {
  it('shows the product flow and a compact empty state', () => {
    const html = renderToStaticMarkup(createElement(WorkshopHomePage, { repository: new MemoryCustomActionRepository() }))
    expect(html).toContain('<h1')
    expect(html).toContain('动作工坊')
    expect(html).toContain('把自己的动作变成可训练的项目')
    expect(html).toContain('正式训练仍需摄像头')
    for (const step of ['创建动作', '设置识别要求', '测试', '保存', '开始训练']) expect(html).toContain(step)
    expect(html).toContain('data-testid="workshop-empty"')
    expect(html).toContain('还没有自定义动作')
    expect(html).toContain('href="/workshop/new"')
    expect(html).not.toMatch(/landmark|JSON schema|state id|joint vector/i)
  })

  it('lists saved actions with their status, goal and actions', () => {
    const repository = new MemoryCustomActionRepository([
      action('custom-a'),
      action('custom-b', { name: '深蹲', bodyArea: 'lower', goal: { type: 'duration', seconds: 30 }, test: { status: 'not-tested' }, source: { kind: 'legacy-library', legacyId: 'x' } }),
    ])
    const html = renderToStaticMarkup(createElement(WorkshopHomePage, { repository }))
    expect(html).toContain('data-testid="workshop-action-custom-a"')
    expect(html).toContain('测试通过')
    expect(html).toContain('上肢 · 目标 10 次 · 按示范姿势识别')
    expect(html).toContain('下肢 · 目标 保持 30 秒')
    expect(html).toContain('未测试')
    expect(html).toContain('来自旧版动作库')
    expect(html).toContain('aria-label="编辑 侧平举练习"')
    expect(html).toContain('href="/workshop/custom-a"')
    expect(html).toContain('开始姿势与完成姿势对比示意')
  })

  it('warns and stays read only when the stored library comes from a newer version', () => {
    const html = renderToStaticMarkup(createElement(WorkshopHomePage, { repository: new MemoryCustomActionRepository([], true) }))
    expect(html).toContain('本页暂时只读')
  })
})

describe('action editor', () => {
  it('starts a new action on 创建动作 with labelled fields and four steps', () => {
    const html = renderToStaticMarkup(createElement(ActionEditorPage, { repository: new MemoryCustomActionRepository() }))
    expect(html).toContain('创建动作')
    expect(html).toContain('aria-label="创建步骤"')
    expect(html).toContain('aria-current="step"')
    expect(html).toMatch(/<label[^>]*for="action-name"/)
    expect(html).toContain('id="action-name"')
    expect(html).toContain('训练部位')
    expect(html).toContain('计数方式')
    for (const label of ['设置识别要求', '测试', '保存']) expect(html).toContain(label)
  })

  it('opens an existing action for editing and explains a missing one', () => {
    const repository = new MemoryCustomActionRepository([action('custom-a')])
    const edit = renderToStaticMarkup(createElement(ActionEditorPage, { actionId: 'custom-a', repository }))
    expect(edit).toContain('编辑动作')
    expect(edit).toContain('正在编辑「侧平举练习」')
    expect(edit).toContain('value="侧平举练习"')
    const missing = renderToStaticMarkup(createElement(ActionEditorPage, { actionId: 'custom-gone', repository }))
    expect(missing).toContain('data-testid="workshop-action-not-found"')
    expect(missing).toContain('没有找到这个动作')
  })
})
