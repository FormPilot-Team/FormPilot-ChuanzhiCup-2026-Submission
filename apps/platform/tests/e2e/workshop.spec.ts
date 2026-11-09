import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { CUSTOM_ACTION_STORAGE_KEY, LEGACY_ACTION_LIBRARY_KEY, type CustomActionDefinition } from '../../src/features/workshop/types'
import { markOnboardingSeen } from './support/onboarding'

const storedActions = (page: Page) => page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? '{"actions":[]}') as { actions: CustomActionDefinition[] }).actions, CUSTOM_ACTION_STORAGE_KEY)

/** Creates a lateral-raise action through the whole editor with the synthetic camera (DEV fixture). */
async function createAction(page: Page, name: string, target = 5, saveButton: 'editor-save' | 'editor-save-train' = 'editor-save') {
  await page.goto('/workshop/new?fixture=synthetic')
  await expect(page.getByRole('heading', { level: 1, name: '创建动作' })).toBeVisible()
  await page.getByLabel('动作名称').fill(name)
  await page.getByLabel('简单描述').fill('双臂侧平举到肩高再放下')
  await page.getByLabel('目标次数').fill(String(target))
  await page.getByTestId('editor-next').click()
  await expect(page.getByTestId('editor-step')).toHaveAttribute('data-step', 'requirements')
  await expect(page.getByRole('heading', { name: '2 · 设置识别要求' })).toBeFocused()
  await page.getByLabel('怎么做（给自己看的提示）').first().fill('站直，双臂自然下垂')
  await page.getByTestId('record-start').click()
  await expect(page.getByTestId('pose-card-start')).toHaveAttribute('data-recorded', 'true', { timeout: 8_000 })
  await page.getByTestId('record-finish').click()
  await expect(page.getByTestId('pose-card-finish')).toHaveAttribute('data-recorded', 'true', { timeout: 8_000 })
  await expect(page.getByTestId('calibration-summary')).toContainText('FormPilot 学会了这个动作')
  await expect(page.getByTestId('active-joints')).toContainText('左手腕')
  await page.getByTestId('editor-next').click()
  await expect(page.getByTestId('editor-step')).toHaveAttribute('data-step', 'test')
  await page.getByTestId('test-start').click()
  await expect(page.getByTestId('test-passed')).toBeVisible({ timeout: 25_000 })
  expect(Number(await page.getByTestId('test-readout').getAttribute('data-reps'))).toBeGreaterThanOrEqual(3)
  await expect(page.getByTestId('requirement-results').locator('[data-passed="true"]').first()).toBeVisible()
  await page.getByTestId('editor-next').click()
  await expect(page.getByTestId('save-summary')).toContainText(name)
  await expect(page.getByTestId('save-summary')).toContainText('已通过')
  await page.getByTestId(saveButton).click()
  if (saveButton === 'editor-save') await expect(page).toHaveURL(/\/workshop\?saved=custom-/)
}

test.beforeEach(async ({ page }) => { await markOnboardingSeen(page) })

test('Workshop A: create → record poses → test → save, then reload and edit', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/workshop')
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '我的', exact: true })).toHaveAttribute('aria-current', 'page') // Web V1: 动作工坊 sits under 我的
  await expect(page.getByTestId('workshop-empty')).toContainText('还没有自定义动作')
  await expect(page.getByTestId('workshop-create')).toHaveAttribute('href', '/workshop/new')

  await createAction(page, '侧平举练习')
  await expect(page.getByTestId('workshop-notice')).toContainText('已保存「侧平举练习」')
  const [saved] = await storedActions(page)
  expect(saved).toMatchObject({ name: '侧平举练习', bodyArea: 'upper', goal: { type: 'reps', target: 5 }, test: { status: 'passed' }, recognition: { source: 'pose-match' } })
  expect(saved.startPose.capture?.landmarks).toHaveLength(33)
  expect(saved.finishPose.capture?.landmarks).toHaveLength(33)
  expect(saved.startPose.description).toBe('站直，双臂自然下垂')
  // Only landmarks are stored, never an image.
  expect(JSON.stringify(saved)).not.toMatch(/data:image|base64/)
  const card = page.getByTestId(`workshop-action-${saved.id}`)
  await expect(card).toContainText('测试通过')
  await expect(card).toContainText('上肢 · 目标 5 次 · 按示范姿势识别')

  await page.reload()
  await expect(page.getByTestId(`workshop-action-${saved.id}`)).toBeVisible()

  await page.getByRole('link', { name: '编辑 侧平举练习' }).click()
  await expect(page).toHaveURL(new RegExp(`/workshop/${saved.id}$`))
  await expect(page.getByLabel('动作名称')).toHaveValue('侧平举练习')
  await page.getByLabel('动作名称').fill('侧平举（慢速）')
  await expect(page.getByTestId('editor-dirty')).toBeVisible()
  await page.getByTestId('editor-step-save').click()
  await expect(page.getByTestId('save-summary')).toContainText('侧平举（慢速）')
  await page.getByTestId('editor-save').click()
  await expect(page.getByTestId('workshop-notice')).toContainText('已保存「侧平举（慢速）」')
  const after = await storedActions(page)
  expect(after).toHaveLength(1)
  expect(after[0]).toMatchObject({ id: saved.id, name: '侧平举（慢速）', test: { status: 'passed' } })
})

test('Workshop B: the editor explains what is missing instead of failing silently', async ({ page }) => {
  await page.goto('/workshop/new?fixture=synthetic')
  await page.getByTestId('editor-next').click()
  const name = page.getByLabel('动作名称')
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(name).toBeFocused()
  await expect(page.getByText('请填写动作名称')).toBeVisible()
  await name.fill('深蹲')
  await page.getByTestId('editor-next').click()
  // Without recorded poses the test step is not reachable, and the reason is said in words.
  await page.getByTestId('editor-step-test').click()
  await expect(page.getByTestId('editor-step')).toHaveAttribute('data-step', 'requirements')
  await expect(page.getByRole('alert')).toContainText('请先记录开始姿势和完成姿势')
  await page.getByTestId('editor-step-save').click()
  await expect(page.getByTestId('editor-step')).toHaveAttribute('data-step', 'requirements')
  // Advanced parameters stay folded away until asked for.
  const advanced = page.getByTestId('workshop-advanced')
  await expect(advanced.getByLabel('识别方式')).toBeHidden()
  await advanced.locator('summary').click()
  await expect(advanced.getByLabel('识别方式')).toBeVisible()
  await expect(advanced).toContainText('阶段阈值')
  await expect(advanced).toContainText('导出这个动作（JSON 文件）')
  await expect(page.getByTestId('requirement-options').getByLabel(/完成一次完整往返/)).toBeDisabled()
})

test('Workshop C: JSON export and import never overwrite an existing action', async ({ page }) => {
  test.setTimeout(90_000)
  await createAction(page, '划船练习', 3)
  const [downloadEvent] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出全部' }).click()])
  expect(downloadEvent.suggestedFilename()).toMatch(/^formpilot-我的动作-\d{8}\.json$/)
  const file = JSON.parse(await readFile(await downloadEvent.path(), 'utf8')) as { format: string; actions: CustomActionDefinition[] }
  expect(file).toMatchObject({ format: 'formpilot-custom-actions', schemaVersion: 1 })
  expect(file.actions).toHaveLength(1)

  await page.getByTestId('workshop-import-input').setInputFiles({ name: 'actions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
  await expect(page.getByTestId('workshop-notice')).toContainText('已导入 1 个动作，1 个与现有动作同名编号，已作为副本导入')
  const actions = await storedActions(page)
  expect(actions).toHaveLength(2)
  expect(new Set(actions.map((item) => item.id)).size).toBe(2)
  expect(actions.map((item) => item.name)).toEqual(['划船练习', '划船练习'])

  await page.getByTestId('workshop-import-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{oops') })
  await expect(page.getByRole('alert')).toContainText('JSON 格式不正确')
  expect(await storedActions(page)).toHaveLength(2)
})

test('Workshop D: actions from the teammate workbench library can be imported, read only', async ({ page }) => {
  const library = {
    schemaVersion: 1,
    items: [
      { id: 'overhead_raise', kind: 'registered', exerciseId: 'overhead_raise', runtimeStatus: 'registered', displayName: '双臂上举', subtitle: '', teachingGoal: '', teachingSteps: [], cautions: [] },
      { id: 'ref-arm-raise', kind: 'imported', runtimeStatus: 'sandbox-only', sandboxProfile: 'upper-body', sandboxFeatureProfile: 'arm-raise', displayName: '直臂上举', subtitle: '参考视频', teachingGoal: '双臂伸直上举', teachingSteps: ['双臂自然下垂', '双臂举过头顶'], cautions: [] },
    ],
  }
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value) }, { key: LEGACY_ACTION_LIBRARY_KEY, value: JSON.stringify(library) })
  await page.goto('/workshop')
  const banner = page.getByTestId('workshop-legacy-banner')
  await expect(banner).toContainText('发现旧版动作库中有 1 个带识别规则的动作')
  await banner.getByRole('button', { name: '导入旧版动作' }).click()
  await expect(page.getByTestId('workshop-notice')).toContainText('已导入 1 个动作')
  await expect(banner).toHaveCount(0)
  const [action] = await storedActions(page)
  expect(action).toMatchObject({ name: '直臂上举', recognition: { source: 'arm-raise', profile: 'upper-body' }, source: { kind: 'legacy-library', legacyId: 'ref-arm-raise' }, test: { status: 'not-tested' } })
  await expect(page.getByTestId(`workshop-action-${action.id}`)).toContainText('来自旧版动作库')
  expect(await page.evaluate((key) => localStorage.getItem(key), LEGACY_ACTION_LIBRARY_KEY)).toBe(JSON.stringify(library))
  await page.reload()
  await expect(page.getByTestId('workshop-legacy-banner')).toHaveCount(0)
})

test('Workshop E: deleting asks first, and the empty state comes back', async ({ page }) => {
  test.setTimeout(90_000)
  await createAction(page, '临时动作', 3)
  await page.getByRole('button', { name: '删除 临时动作' }).click()
  const dialog = page.getByRole('alertdialog', { name: '删除「临时动作」？' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '取消' }).click()
  expect(await storedActions(page)).toHaveLength(1)
  await page.getByRole('button', { name: '删除 临时动作' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
  await expect(page.getByTestId('workshop-empty')).toBeVisible()
  expect(await storedActions(page)).toHaveLength(0)
})

test('Workshop F: workshop pages stay inside the target viewports', async ({ page }) => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const path of ['/workshop', '/workshop/new?fixture=synthetic']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} ${viewport.width}`).toBe(true)
    }
    await page.getByLabel('动作名称').fill('响应式检查')
    await page.getByTestId('editor-next').click()
    await expect(page.getByTestId('camera-panel')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `requirements ${viewport.width}`).toBe(true)
    await page.screenshot({ path: `test-results/workshop-requirements-${viewport.width}x${viewport.height}.png`, fullPage: true })
  }
})

test('Workshop G: the workshop records with its own full pose model while the warm-up keeps the lite model', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const models: string[] = []
  page.on('request', (request) => { if (request.url().includes('/models/')) models.push(new URL(request.url()).pathname) })
  // A person on screen through the real camera pipeline: getUserMedia answers with a video stream.
  await page.addInitScript((source) => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const video = document.createElement('video')
        video.src = source
        video.muted = true
        video.playsInline = true
        video.loop = true
        await video.play().catch(() => undefined)
        return (video as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream()
      },
    })
  }, '/assets/routines/baduanjin-standard.mp4')

  await page.goto('/workshop/new')
  await page.getByLabel('动作名称').fill('摄像头流水线')
  await page.getByTestId('editor-next').click()
  await page.getByTestId('record-start').click()
  await expect(page.getByText(/摄像头已连接/)).toBeVisible({ timeout: 45_000 })
  await expect(page.getByTestId('pose-card-start')).toHaveAttribute('data-recorded', 'true', { timeout: 45_000 })
  expect(models).toContain('/models/pose_landmarker_full.task')
  expect(models).not.toContain('/models/pose_landmarker_lite.task')

  models.length = 0
  await page.goto('/train?exercise=lateral_raise')
  await page.getByRole('button', { name: '启用摄像头' }).click()
  await expect(page.getByText(/摄像头已连接/)).toBeVisible({ timeout: 45_000 })
  expect(models).toContain('/models/pose_landmarker_lite.task')
  expect(models).not.toContain('/models/pose_landmarker_full.task')
  expect(errors).toEqual([])
})

test('Workshop H: the closed loop — create, test, save and start training, then it counts, reports and shows on Home', async ({ page }) => {
  test.setTimeout(150_000)
  await createAction(page, '闭环动作', 3, 'editor-save-train')
  await expect(page).toHaveURL(/\/workshop\/custom-[^/]+\/train$/)
  await expect(page.getByRole('heading', { level: 1, name: '闭环动作' })).toBeVisible()
  const [saved] = await storedActions(page)
  await page.goto(`/workshop/${saved.id}/train?fixture=synthetic&fast=1`)
  await expect(page.getByTestId('custom-complete-dialog')).toHaveAttribute('data-outcome', 'completed', { timeout: 60_000 })
  await page.getByRole('button', { name: '查看训练报告' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '闭环动作训练报告' })).toBeVisible()
  await expect(page.getByTestId('report-summary')).toContainText('本次完成了 3 / 3 次，其中 3 次识别重点都达标')
  // Web V1: the user's own actions are listed in 训练中心.
  await page.goto('/training')
  await expect(page.getByTestId('training-my-actions').getByRole('link', { name: '开始训练 · 闭环动作' })).toHaveAttribute('href', `/workshop/${saved.id}/train`)
})

test('Workshop I: the whole editor works from the keyboard alone', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/workshop')
  await page.getByTestId('workshop-create').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/workshop\/new$/)
  await page.goto('/workshop/new?fixture=synthetic')

  await page.getByLabel('动作名称').focus()
  await page.keyboard.type('键盘侧平举')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('简单描述')).toBeFocused()
  const upper = page.getByRole('radio', { name: /上肢/ })
  await upper.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: /下肢/ })).toBeChecked()
  await page.keyboard.press('ArrowLeft')
  await expect(upper).toBeChecked()
  await page.getByLabel('目标次数').focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('4')

  await page.getByTestId('editor-next').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '2 · 设置识别要求' })).toBeFocused()
  await page.getByTestId('record-start').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('pose-card-start')).toHaveAttribute('data-recorded', 'true', { timeout: 8_000 })
  await page.getByTestId('record-finish').focus()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('pose-card-finish')).toHaveAttribute('data-recorded', 'true', { timeout: 8_000 })
  const symmetric = page.getByRole('checkbox', { name: '左右两侧动作一致' })
  await symmetric.focus()
  await page.keyboard.press('Space')
  await expect(symmetric).toBeChecked()
  await page.keyboard.press('Space')
  await expect(symmetric).not.toBeChecked()
  // 高级设置 stays folded until the user opens it, and opens and closes from the keyboard.
  const advanced = page.getByTestId('workshop-advanced')
  await expect(page.getByLabel('识别方式')).toBeHidden()
  await advanced.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('识别方式')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('识别方式')).toBeHidden()

  await page.getByTestId('editor-next').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('editor-step')).toHaveAttribute('data-step', 'test')
  await page.getByTestId('test-start').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('test-passed')).toBeVisible({ timeout: 25_000 })
  await page.getByTestId('editor-next').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('save-summary')).toContainText('键盘侧平举')
  await page.getByTestId('editor-save').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/workshop\?saved=custom-/)
  await expect(page.getByTestId('workshop-notice')).toContainText('已保存「键盘侧平举」')
  const [saved] = await storedActions(page)
  expect(saved).toMatchObject({ name: '键盘侧平举', bodyArea: 'upper', goal: { type: 'reps', target: 4 }, test: { status: 'passed' } })
  await page.getByTestId(`workshop-train-${saved.id}`).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/workshop/${saved.id}/train$`))
})
