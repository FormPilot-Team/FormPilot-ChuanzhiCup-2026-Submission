import { randomBytes } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { createLabSyntheticFixture } from '../../src/features/coachAgent/lab/fixtures'
import { SESSION_STORAGE_KEY } from '../../src/features/training/LocalStorageTrainingSessionRepository'
import { startFakeCoachLab } from '../support/coach-agent-lab-fake-http'

const labUrl = process.env.COACH_LAB_BASE_URL ?? 'http://127.0.0.1:4173/coach-agent-lab.html'
const origin = new URL(labUrl).origin
const fixture = createLabSyntheticFixture()
const syntheticRecords = fixture.storage.getItem(SESSION_STORAGE_KEY)!
const currentId = (JSON.parse(syntheticRecords) as Array<{ id: string; startedAt: number }>).sort((a, b) => b.startedAt - a.startedAt)[0].id

async function open(page: Page) {
  await page.goto(labUrl)
  await expect(page.getByRole('heading', { name: '训练问答实验台' })).toBeVisible()
}

async function ask(page: Page, preset: string) {
  await page.getByRole('button', { name: preset, exact: true }).click()
  await page.getByRole('button', { name: '发送问题', exact: true }).click()
  await expect(page.getByTestId('lab-result')).toHaveAttribute('aria-busy', 'false')
}

async function configureRemote(page: Page, endpoint: string, bootstrapToken: string) {
  await page.getByRole('button', { name: 'Remote 远程规划', exact: true }).click()
  await page.getByRole('checkbox', { name: /^同意发送最小规划字段/u }).check()
  await page.getByRole('checkbox', { name: /^启用可能产生费用的调用/u }).check()
  await page.getByLabel('本机代理地址', { exact: true }).fill(endpoint)
  await page.getByLabel('本机一次性 bootstrap token', { exact: true }).fill(bootstrapToken)
  await page.getByRole('button', { name: '建立本机会话', exact: true }).click()
  await expect(page.getByLabel('本机一次性 bootstrap token', { exact: true })).toHaveValue('')
  // Configuration collapses its details; expand them to inspect the revoked/configured controls.
  const details = page.locator('details.lab-remote')
  if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) {
    await page.getByText('配置本机 Remote 代理', { exact: true }).click()
  }
  await expect(page.getByRole('button', { name: '建立本机会话', exact: true })).toBeDisabled()
}

test.describe('independent Coach Lab browser interaction', () => {
  test('defaults to offline Mock, labels synthetic data and answers squat with immutable scoring evidence', async ({ page }) => {
    const remoteRequests: string[] = []
    page.on('request', request => { if (request.url().includes('/v1/coach/')) remoteRequests.push(request.url()) })
    await open(page)
    await expect(page.getByText('DEVELOPMENT LAB', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mock 规则演示', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('数据来源', { exact: true })).toHaveValue('synthetic')
    await expect(page.getByText('合成记录只存在内存中，用于验证问答流程，不代表真人训练效果。', { exact: true })).toBeVisible()
    await ask(page, '深蹲评分为什么不高？')
    const result = page.getByTestId('lab-result')
    await expect(result).toContainText('MOCK · 确定性规则')
    await expect(result).toContainText('Mock 规则演示')
    await expect(result.locator('.lab-answer-text')).toContainText('67')
    await expect(page.getByTestId('lab-evidence')).toContainText('warmup-standard')
    await expect(page.getByTestId('lab-evidence')).toContainText('exercise-rules-v1.0')
    await expect(page.getByTestId('lab-evidence')).toContainText('evidenceId')
    await expect(page.getByTestId('lab-evidence')).toContainText(currentId)
    await expect(page.getByTestId('lab-evidence')).toContainText('synthetic')
    expect(remoteRequests).toEqual([])
    expect(await page.evaluate(key => localStorage.getItem(key), SESSION_STORAGE_KEY)).toBeNull()
  })

  test('history question displays the original provenance gate and never claims synthetic progress', async ({ page }) => {
    await open(page)
    await ask(page, '最近深蹲有进步吗？')
    await expect(page.getByTestId('lab-result')).toContainText('证据不足')
    await expect(page.getByTestId('lab-result').locator('.lab-answer-text')).toContainText('历史不可比较')
    await expect(page.getByTestId('lab-comparison')).toContainText('gate = NONE')
    await expect(page.getByTestId('lab-comparison')).toContainText('CURRENT_PROVENANCE_NOT_VERIFIED_LIVE_NORMAL')
    await expect(page.getByTestId('lab-result').locator('.lab-answer-text')).not.toContainText('已经进步')
  })

  test('routine question selects the routine fixture and shows similarity rather than standardized score', async ({ page }) => {
    await open(page)
    await ask(page, '八段锦跟练表现如何？')
    await expect(page.getByLabel('训练类型', { exact: true })).toHaveValue('routine')
    await expect(page.getByTestId('lab-evidence')).toContainText('follow-along-similarity')
    await expect(page.getByTestId('lab-evidence')).toContainText('follow-along-v1')
    await expect(page.getByTestId('lab-evidence')).toContainText('0.8')
    await expect(page.getByTestId('lab-result').locator('.lab-answer-text')).toContainText('相似度不能证明动作规范')
  })

  test('requires local consent, load and Session selection while preserving synthetic browser fixture bytes', async ({ page }) => {
    // Isolated browser context only: these records remain source=synthetic throughout.
    await page.addInitScript(({ key, raw }) => {
      localStorage.setItem(key, raw)
      const reads: string[] = []
      const original = Storage.prototype.getItem
      Object.assign(window, { coachLabFixtureReads: reads })
      Storage.prototype.getItem = function (name: string) {
        if (name === key) reads.push(name)
        return original.call(this, name)
      }
    }, { key: SESSION_STORAGE_KEY, raw: syntheticRecords })
    await open(page)
    await page.getByLabel('数据来源', { exact: true }).selectOption('local')
    await expect(page.getByRole('button', { name: '加载本机记录', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => (window as unknown as { coachLabFixtureReads: string[] }).coachLabFixtureReads)).toEqual([])
    await page.getByRole('checkbox', { name: /^允许读取本机记录/u }).check()
    expect(await page.evaluate(() => (window as unknown as { coachLabFixtureReads: string[] }).coachLabFixtureReads)).toEqual([])
    await page.getByRole('button', { name: '加载本机记录', exact: true }).click()
    await expect(page.getByLabel('当前 Session', { exact: true })).toHaveValue('')
    await page.getByRole('button', { name: '发送问题', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('INVALID_SESSION')
    await page.getByLabel('当前 Session', { exact: true }).selectOption(currentId)
    await expect(page.getByRole('checkbox', { name: `允许读取 ${currentId}`, exact: true })).toBeChecked()
    await page.getByRole('button', { name: '发送问题', exact: true }).click()
    await expect(page.getByTestId('lab-evidence')).toContainText(currentId)
    await expect(page.getByTestId('lab-evidence')).toContainText('synthetic')
    expect(await page.evaluate(key => localStorage.getItem(key), SESSION_STORAGE_KEY)).toBe(syntheticRecords)
    await page.getByRole('checkbox', { name: /^允许读取本机记录/u }).uncheck()
    await expect(page.getByTestId('lab-evidence')).toHaveCount(0)
    await expect(page.getByLabel('当前 Session', { exact: true })).toBeDisabled()
    expect(await page.evaluate(key => localStorage.getItem(key), SESSION_STORAGE_KEY)).toBe(syntheticRecords)
  })

  for (const [label, raw, code] of [['empty', '[]', 'EMPTY_HISTORY'], ['broken', '{broken', 'CORRUPT']] as const) {
    test(`shows ${label} browser history without inventing records or repairing storage`, async ({ page }) => {
      await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: SESSION_STORAGE_KEY, value: raw })
      await open(page)
      await page.getByLabel('数据来源', { exact: true }).selectOption('local')
      await page.getByRole('checkbox', { name: /^允许读取本机记录/u }).check()
      await page.getByRole('button', { name: '加载本机记录', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText(code)
      await expect(page.getByLabel('当前 Session', { exact: true })).toBeDisabled()
      await expect(page.getByTestId('lab-evidence')).toHaveCount(0)
      expect(await page.evaluate(key => localStorage.getItem(key), SESSION_STORAGE_KEY)).toBe(raw)
    })
  }

  test('keeps Remote disabled until disclosure, possible cost and configuration are explicit', async ({ page }) => {
    const requests: string[] = []
    page.on('request', request => { if (request.url().includes('/v1/coach/')) requests.push(request.url()) })
    await open(page)
    await page.getByRole('button', { name: 'Remote 远程规划', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: /^同意发送最小规划字段/u })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: /^启用可能产生费用的调用/u })).not.toBeChecked()
    await expect(page.getByRole('button', { name: '建立本机会话', exact: true })).toBeDisabled()
    await expect(page.getByText('LIVE_API_TEST NOT RUN', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '发送问题', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('REMOTE_DISABLED')
    await page.getByRole('checkbox', { name: /^同意发送最小规划字段/u }).check()
    await page.getByRole('button', { name: '发送问题', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('REMOTE_DISABLED')
    await page.getByRole('checkbox', { name: /^同意发送最小规划字段/u }).uncheck()
    expect(requests).toEqual([])
    await expect(page.getByTestId('lab-evidence')).toHaveCount(0)
  })

  test('uses Fake HTTP through the unchanged local safety proxy for all three questions and never sends training facts', async ({ page }) => {
    const bootstrapToken = randomBytes(32).toString('base64url')
    const fake = await startFakeCoachLab({ bootstrapToken, origin, port: 0 })
    try {
      await open(page)
      await configureRemote(page, fake.endpoint, bootstrapToken)
      expect(fake.getModelRequests()).toBe(0)
      await page.getByLabel('训练问题', { exact: true }).fill('为什么我这次深蹲评分不高？私密姓名13800000000，视频video，关键点landmarks。')
      await page.getByRole('button', { name: '发送问题', exact: true }).click()
      await expect(page.getByTestId('lab-result')).toContainText('远端规划已完成并校验')
      await expect(page.getByTestId('lab-evidence')).toContainText('67')
      expect(fake.getModelRequests()).toBe(2)
      await ask(page, '最近深蹲有进步吗？')
      await expect(page.getByTestId('lab-result')).toContainText('远端规划已完成并校验')
      await expect(page.getByTestId('lab-comparison')).toContainText('gate = NONE')
      expect(fake.getModelRequests()).toBe(4)
      await page.getByRole('button', { name: '八段锦跟练表现如何？', exact: true }).click()
      // A changed training scope invalidates the old capability. A fresh local bootstrap is required.
      await expect(page.getByRole('checkbox', { name: /^同意发送最小规划字段/u })).not.toBeChecked()
      await expect(page.getByRole('button', { name: '建立本机会话', exact: true })).toBeDisabled()
      const warmupWire = JSON.stringify(fake.getContexts())
      expect(warmupWire).not.toMatch(/私密姓名|13800000000|landmarks|video|repetitions|recordPaths|scoringVersion|"score":/u)
      expect(warmupWire).not.toContain(currentId)
      expect(warmupWire).not.toContain(bootstrapToken)
      const routineBootstrap = randomBytes(32).toString('base64url')
      const routineFake = await startFakeCoachLab({ bootstrapToken: routineBootstrap, origin, port: 0 })
      try {
        await configureRemote(page, routineFake.endpoint, routineBootstrap)
        await page.getByRole('button', { name: '发送问题', exact: true }).click()
        await expect(page.getByTestId('lab-result')).toContainText('远端规划已完成并校验')
        await expect(page.getByTestId('lab-evidence')).toContainText('follow-along-similarity')
        await expect(page.getByTestId('lab-evidence')).toContainText('0.8')
        expect(routineFake.getModelRequests()).toBe(2)
        const wire = JSON.stringify(routineFake.getContexts())
        expect(wire).not.toMatch(/landmarks|video|repetitions|recordPaths|scoringVersion|"score":/u)
        expect(wire).not.toContain(routineBootstrap)
      } finally { await routineFake.stop() }
      await page.getByRole('checkbox', { name: /^同意发送最小规划字段/u }).uncheck()
      await expect(page.getByTestId('lab-evidence')).toHaveCount(0)
      await expect(page.getByLabel('本机一次性 bootstrap token', { exact: true })).toHaveValue('')
      expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }))).not.toContain(bootstrapToken)
    } finally { await fake.stop() }
  })

  test('cancelled and late HTTP responses cannot replace a new history answer', async ({ page }) => {
    const bootstrapToken = randomBytes(32).toString('base64url')
    const fake = await startFakeCoachLab({ bootstrapToken, origin, port: 0 })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let delivered!: () => void
    const delivery = new Promise<void>(resolve => { delivered = resolve })
    let intercepted = false
    await page.route(`${fake.endpoint}`, async route => {
      if (intercepted) { await route.continue(); return }
      intercepted = true
      await gate
      await route.fulfill({ json: { type: 'answer', mode: 'explain', evidenceRefs: [] } }).catch(() => undefined)
      delivered()
    })
    try {
      await open(page)
      await configureRemote(page, fake.endpoint, bootstrapToken)
      await page.getByRole('button', { name: '发送问题', exact: true }).click()
      await expect.poll(() => intercepted).toBe(true)
      await expect(page.getByRole('button', { name: '取消任务', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: '取消任务', exact: true }).click()
      await expect(page.getByTestId('lab-result')).toContainText('CANCELLED')
      await ask(page, '最近深蹲有进步吗？')
      await expect(page.getByTestId('lab-comparison')).toContainText('gate = NONE')
      const current = await page.getByTestId('lab-result').textContent()
      release()
      await delivery
      await page.evaluate(() => new Promise(requestAnimationFrame))
      await expect(page.getByTestId('lab-result')).toHaveText(current!)
      const wire = JSON.stringify(fake.getContexts())
      expect(wire).not.toMatch(/landmarks|video|repetitions|recordPaths|scoringVersion|"score":/u)
      expect(wire).not.toContain(currentId)
      expect(wire).not.toContain(bootstrapToken)
    } finally { release(); await fake.stop() }
  })

  test('shows a deadline failure and cancels the pending HTTP plan without inventing an answer', async ({ page }) => {
    const bootstrapToken = randomBytes(32).toString('base64url')
    const fake = await startFakeCoachLab({ bootstrapToken, origin, port: 0 })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let intercepted = false
    await page.clock.install()
    await page.route(fake.endpoint, async route => {
      intercepted = true
      await gate
      await route.fulfill({ json: { type: 'answer', mode: 'explain', evidenceRefs: [] } }).catch(() => undefined)
    })
    try {
      await open(page)
      await configureRemote(page, fake.endpoint, bootstrapToken)
      await page.getByRole('button', { name: '发送问题', exact: true }).click()
      await expect.poll(() => intercepted).toBe(true)
      await page.clock.runFor(10_001)
      await expect(page.getByRole('alert')).toContainText('TIMEOUT')
      await expect(page.getByTestId('lab-result')).toContainText('已超时')
      await expect(page.getByTestId('lab-result')).toContainText('远端规划未完成')
      await expect(page.getByTestId('lab-evidence')).toContainText('0 条本地引用')
      await expect(page.getByRole('button', { name: '取消任务', exact: true })).toBeDisabled()
      expect(fake.getModelRequests()).toBe(0)
    } finally { release(); await fake.stop() }
  })

  test('fits the mobile viewport and keeps controls and scoring evidence available', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page)
    await ask(page, '深蹲评分为什么不高？')
    await expect(page.getByTestId('lab-evidence')).toContainText('warmup-standard')
    const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.width)
    await expect(page.getByRole('button', { name: '发送问题', exact: true })).toBeVisible()
  })
})
