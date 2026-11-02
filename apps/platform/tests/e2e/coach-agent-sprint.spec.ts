import { mkdir } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import { createLabSyntheticFixture } from '../../src/features/coachAgent/lab/fixtures'
import { SESSION_STORAGE_KEY } from '../../src/features/training/LocalStorageTrainingSessionRepository'
import { ROUTINE_SESSION_STORAGE_KEY } from '../../src/features/routines/session/RoutineSessionRepository'

const sprintUrl = process.env.COACH_SPRINT_BASE_URL ?? 'http://127.0.0.1:4173/coach-agent-sprint.html'
const sprintOrigin = new URL(sprintUrl).origin
const evidenceDirectory = process.env.COACH_SPRINT_EVIDENCE_DIR ?? 'test-results/coach-agent-sprint'
const historyKeys = [SESSION_STORAGE_KEY, ROUTINE_SESSION_STORAGE_KEY]
interface BrowserAudit { reads: string[]; writes: string[] }
const checks = new WeakMap<Page, { requests: string[]; errors: string[] }>()
// Cold Vite module loading and Edge context teardown share the Windows test budget.
test.setTimeout(60_000)

async function storageAudit(page: Page): Promise<BrowserAudit> {
  return page.evaluate(() => (window as unknown as { sprintStorageAudit: BrowserAudit }).sprintStorageAudit)
}

async function openSprint(page: Page) {
  await page.goto(sprintUrl)
  await expect(page.getByRole('heading', { name: '从了解你开始。', exact: true })).toBeVisible()
}

async function completeProfile(page: Page, acknowledge = true) {
  await page.getByRole('checkbox', { name: '肩颈活动练习', exact: true }).check()
  await page.getByRole('checkbox', { name: '肩部僵硬', exact: true }).check()
  await page.getByRole('checkbox', { name: '肩部', exact: true }).check()
  if (acknowledge) await page.getByRole('checkbox', { name: /^我已了解：/u }).check()
}

async function generate(page: Page) {
  await page.getByRole('button', { name: /^(生成|更新)我的推荐/u }).click()
}

async function capture(page: Page, name: string) {
  await mkdir(evidenceDirectory, { recursive: true })
  await page.screenshot({ path: `${evidenceDirectory}/${name}.png`, fullPage: true })
}

test.beforeEach(async ({ page }) => {
  const requests: string[] = [], errors: string[] = []
  checks.set(page, { requests, errors })
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (['fetch', 'xhr'].includes(request.resourceType())) requests.push(request.url())
  })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== sprintOrigin) {
      requests.push(route.request().url())
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await page.addInitScript(() => {
    const audit = { reads: [] as string[], writes: [] as string[] }
    Object.assign(window, { sprintStorageAudit: audit })
    const originalGet = Storage.prototype.getItem
    const originalSet = Storage.prototype.setItem
    const originalRemove = Storage.prototype.removeItem
    const originalClear = Storage.prototype.clear
    Storage.prototype.getItem = function (key: string) {
      audit.reads.push(key)
      return originalGet.call(this, key)
    }
    Storage.prototype.setItem = function (key: string, value: string) {
      audit.writes.push(`set:${key}`)
      return originalSet.call(this, key, value)
    }
    Storage.prototype.removeItem = function (key: string) {
      audit.writes.push(`remove:${key}`)
      return originalRemove.call(this, key)
    }
    Storage.prototype.clear = function () {
      audit.writes.push('clear')
      return originalClear.call(this)
    }
  })
})

test.afterEach(async ({ page }) => {
  expect(checks.get(page)?.requests, 'The recommendation page must not fetch/upload data or invoke a model').toEqual([])
  expect(checks.get(page)?.errors).toEqual([])
})

test('does not access storage before an explicit authorized read and never writes history', async ({ page }) => {
  await openSprint(page)
  expect(await storageAudit(page)).toEqual({ reads: [], writes: [] })
  await completeProfile(page)
  await generate(page)
  await expect(page.getByTestId('coach-sprint-recommendations')).toBeVisible()
  expect(await storageAudit(page)).toEqual({ reads: [], writes: [] })
  await page.getByLabel('数据范围', { exact: true }).selectOption('local')
  await expect(page.getByRole('button', { name: '读取授权记录', exact: true })).toBeDisabled()
  expect(await storageAudit(page)).toEqual({ reads: [], writes: [] })
  await page.getByRole('checkbox', { name: /^允许读取此浏览器/u }).check()
  expect(await storageAudit(page)).toEqual({ reads: [], writes: [] })
  await page.getByRole('button', { name: '读取授权记录', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('读取结束')
  const audit = await storageAudit(page)
  expect([...new Set(audit.reads)].sort()).toEqual([...historyKeys].sort())
  expect(audit.writes).toEqual([])
  await page.getByRole('button', { name: '最近主要问题是什么？', exact: true }).click()
  await expect(page.getByTestId('coach-sprint-answer')).toContainText('证据不足')
})

test('requires complete profile and risk acknowledgement before giving all three recommendation types', async ({ page }) => {
  await openSprint(page)
  await generate(page)
  await expect(page.getByRole('alert')).toContainText('请完整填写')
  await expect(page.getByTestId('coach-sprint-recommendations')).toHaveCount(0)
  await completeProfile(page, false)
  await generate(page)
  await expect(page.getByRole('alert')).toContainText('确认风险提示')
  await expect(page.getByTestId('coach-sprint-recommendations')).toHaveCount(0)
  await page.getByRole('checkbox', { name: /^我已了解：/u }).check()
  await generate(page)
  for (const name of ['功法方向', '从这一章开始', '换一种方式练习']) {
    const section = page.getByRole('region', { name, exact: true })
    await expect(section).toBeVisible()
    expect(await section.getByRole('article').count()).toBeGreaterThan(0)
    await expect(section.getByRole('article').first()).toContainText('画像规则')
  }
  const links = page.getByRole('region', { name: '从这一章开始', exact: true }).getByRole('link', { name: '查看此章节' })
  expect(await links.count()).toBeGreaterThan(0)
  for (const link of await links.all()) {
    const url = new URL((await link.getAttribute('href'))!, sprintOrigin)
    expect(url.origin).toBe(sprintOrigin)
    expect(url.pathname).toMatch(/^\/routines\/(baduanjin|taijiquan|wuqinxi|yijinjing)\/train$/u)
    expect(url.searchParams.get('form')).toMatch(/^(bdj|tjq|wqx|yjj)-\d+$/u)
  }
  await capture(page, 'desktop-profile-recommendations')
})

test('answers all five question types while distinguishing missing reports and model outputs', async ({ page }) => {
  await openSprint(page)
  await completeProfile(page)
  await generate(page)
  const answer = page.getByTestId('coach-sprint-answer')
  await expect(answer).toContainText('画像规则建议')
  await page.getByRole('button', { name: '先玩哪个游戏？', exact: true }).click()
  await expect(answer).toContainText('可先了解')
  await expect(answer).toContainText('独立应用')
  await page.getByRole('button', { name: '最近主要问题是什么？', exact: true }).click()
  await expect(answer).toContainText('证据不足')
  await expect(answer).toContainText('自述')
  await page.getByRole('button', { name: '为什么这样推荐？', exact: true }).click()
  await expect(answer).toContainText('画像规则')
  await expect(answer).toContainText('知识来源')
  await page.getByRole('button', { name: '下一阶段练什么？', exact: true }).click()
  await expect(answer).toContainText('下一阶段可关注')
  await expect(answer).toContainText('StartLux 尚无可用输出')
  await page.getByRole('button', { name: '我适合练什么？', exact: true }).click()
  await expect(answer).toContainText('不是医学处方')
  expect(await storageAudit(page)).toEqual({ reads: [], writes: [] })
})

test('hides stale recommendations immediately on profile change and blocks acute pain for every question', async ({ page }) => {
  await openSprint(page)
  await completeProfile(page)
  await generate(page)
  await expect(page.getByTestId('coach-sprint-recommendations')).toBeVisible()
  await page.getByLabel('当前风险情况', { exact: true }).selectOption('acute_pain')
  await expect(page.getByTestId('coach-sprint-recommendations')).toHaveCount(0)
  await generate(page)
  const answer = page.getByTestId('coach-sprint-answer')
  await expect(answer).toContainText('暂停推荐')
  for (const label of ['我适合练什么？', '先玩哪个游戏？', '最近主要问题是什么？', '为什么这样推荐？', '下一阶段练什么？']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(answer).toContainText('先咨询医生')
    await expect(page.getByTestId('coach-sprint-recommendations')).toHaveCount(0)
  }
  await page.getByLabel('当前风险情况', { exact: true }).selectOption('none')
  await expect(page.getByTestId('coach-sprint-recommendations')).toHaveCount(0)
  await generate(page)
  await expect(page.getByTestId('coach-sprint-recommendations')).toBeVisible()
})

test('labels every synthetic evidence item, explains the report as a sample, and clears samples on source change', async ({ page }) => {
  await openSprint(page)
  await completeProfile(page)
  await page.getByLabel('数据范围', { exact: true }).selectOption('demo')
  await page.getByRole('button', { name: '加载合成样例', exact: true }).click()
  await generate(page)
  const evidence = page.getByRole('region', { name: '依据与证据边界', exact: true })
  const items = evidence.locator('ol > li')
  await expect(items).toHaveCount(4)
  for (const item of await items.all()) {
    await expect(item.locator('.cs-tag')).toHaveText('合成样例')
    await item.getByText('追溯记录', { exact: true }).click()
    await expect(item).toContainText('synthetic:')
    await expect(item).toContainText('fixture:competition-ai-coach/')
    await expect(item).not.toContainText('授权本机记录')
  }
  await expect(page.getByTestId('coach-sprint-recommendations')).toContainText('合成样例 + 规则建议')
  await page.getByRole('button', { name: '最近主要问题是什么？', exact: true }).click()
  await expect(page.getByTestId('coach-sprint-answer')).toContainText('合成报告样例（不代表你的表现）')
  await expect(page.getByTestId('coach-sprint-answer')).not.toContainText('最近本机报告分项')
  await page.getByRole('button', { name: '下一阶段练什么？', exact: true }).click()
  await expect(page.getByTestId('coach-sprint-answer')).toContainText('安全规则继续优先')
  await capture(page, 'desktop-synthetic-evidence')
  await page.getByLabel('数据范围', { exact: true }).selectOption('none')
  await expect(items).toHaveCount(0)
  await expect(evidence).toContainText('尚无历史证据')
  await expect(page.getByTestId('coach-sprint-recommendations')).not.toContainText('synthetic:')
  expect(await storageAudit(page)).toEqual({ reads: [], writes: [] })
})

test('revoking local consent clears accepted evidence without changing stored record bytes', async ({ page }) => {
  // Browser-only generated fixture: source=live exercises the trusted-reader path, not a claim of human data.
  const fixture = createLabSyntheticFixture()
  const entries = historyKeys.map(key => [key, JSON.stringify((JSON.parse(fixture.storage.getItem(key)!) as Array<Record<string, unknown>>)
    .map(record => ({ ...record, source: 'live' })))] as const)
  await openSprint(page)
  await page.evaluate(values => {
    for (const [key, raw] of values) localStorage.setItem(key, raw)
    const audit = (window as unknown as { sprintStorageAudit: BrowserAudit }).sprintStorageAudit
    audit.reads.length = 0
    audit.writes.length = 0
  }, entries)
  await completeProfile(page)
  await generate(page)
  await page.getByLabel('数据范围', { exact: true }).selectOption('local')
  await page.getByRole('checkbox', { name: /^允许读取此浏览器/u }).check()
  await page.getByRole('button', { name: '读取授权记录', exact: true }).click()
  const evidence = page.getByRole('region', { name: '依据与证据边界', exact: true })
  expect(await evidence.locator('ol > li').count()).toBeGreaterThan(0)
  await expect(evidence).toContainText('授权本机记录')
  await page.getByRole('checkbox', { name: /^允许读取此浏览器/u }).uncheck()
  await expect(evidence.locator('ol > li')).toHaveCount(0)
  await expect(evidence).not.toContainText('授权本机记录')
  await expect(page.getByTestId('coach-sprint-recommendations')).not.toContainText('history:')
  await expect(page.getByRole('button', { name: '读取授权记录', exact: true })).toBeDisabled()
  expect((await storageAudit(page)).writes).toEqual([])
  const stored = await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), historyKeys)
  expect(stored).toEqual(entries.map(([, raw]) => raw))
})

test('375px layout remains within viewport with recommendations and expanded knowledge/evidence', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await openSprint(page)
  await completeProfile(page)
  await page.getByLabel('数据范围', { exact: true }).selectOption('demo')
  await page.getByRole('button', { name: '加载合成样例', exact: true }).click()
  await generate(page)
  await page.getByText(/^推荐知识目录 ·/u).click()
  const evidence = page.getByRole('region', { name: '依据与证据边界', exact: true })
  for (const detail of await evidence.locator('ol > li > details').all()) await detail.locator('summary').click()
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }))
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.width + 1)
  await expect(page.getByTestId('coach-sprint-recommendations')).toBeVisible()
  await capture(page, 'mobile-375-synthetic-recommendations')
  await page.setViewportSize({ width: 390, height: 844 })
  await capture(page, 'mobile-390-synthetic-recommendations')
})
