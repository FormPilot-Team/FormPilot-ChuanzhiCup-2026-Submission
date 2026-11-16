import { expect, test, type Page } from '@playwright/test'
import { ONBOARDING_STORAGE_KEY } from '../../src/features/onboarding/onboarding'

// Runs against the real competition build (`competition:build` = `vite build --mode competition`, served by
// `competition:preview` on :4175): AI Coach is ACTIVE with the owner-approved experimental model. Profiles are typed in
// by the test (simulated user); the engine, weights and Guard are the shipped ones.

const LABEL = '实验性模型：AI 标注训练，项目负责人已审阅标签，尚未进行独立人工或专家标注'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ version: 1, outcome: 'completed', at: 1 })), { key: ONBOARDING_STORAGE_KEY })
})

async function fill(page: Page, labels: string[], options: { risk?: string; preference?: string } = {}) {
  const profile = page.getByTestId('coach-profile')
  for (const label of labels) await profile.locator('label.check-chip', { hasText: new RegExp(`^${label}$`) }).locator('input').check()
  if (options.risk) await page.locator('#coach-risk').selectOption(options.risk)
  if (options.preference) await page.locator('#coach-preference').selectOption(options.preference)
  await page.getByTestId('coach-ack').check()
  await page.getByTestId('coach-submit').click()
}

test('Competition A: profile P gets the trained model recommendation with identity, suitability and contributions (§9 item 3)', async ({ page }) => {
  const requests: string[] = []
  await page.goto('/coach')
  await expect(page.getByTestId('coach-orb-stage')).toBeVisible()
  await page.getByTestId('coach-enter').click()
  page.on('request', (request) => requests.push(request.url()))
  await fill(page, ['上肢动作练习', '肩部僵硬', '肩部', '上肢'])
  await expect(page.getByTestId('coach-origin')).toHaveText('训练模型推荐')
  const result = page.getByTestId('coach-result')
  await expect(result.locator('.fpw-rec h3')).toHaveText(['易筋经 · 韦驮献杵第一势', '八段锦 · 左右开弓似射雕', '易筋经 · 出爪亮翅势', '易筋经', '八段锦', '林间射箭', '林间划船'])
  await expect(page.getByTestId('coach-suitability-yjj-1')).toContainText(/适配度 \d+%/)
  await page.getByTestId('coach-explain-yjj-1').locator('summary').click()
  await expect(page.getByTestId('coach-explain-yjj-1')).toContainText('不是医学概率')
  const panel = page.getByTestId('coach-model-panel')
  await expect(panel).toContainText('fp-cdm-m2 v1.0.0 · 发布 fp-cdm-release/1.0.0')
  await expect(panel).toContainText(LABEL)
  await expect(panel).toContainText('权重、内容表与目录指纹校验通过')
  await expect(page.getByTestId('coach-model-state')).toHaveText('模型推荐')
  await expect(page.getByTestId('coach-shadow-panel')).toHaveCount(0)
  // Browsers may defer this page's favicon request until after collection starts.
  // Ignore only the two same-origin icon URLs; other business requests still fail.
  const localFavicons = new Set(['/favicon.svg', '/favicon.ico'].map((path) => new URL(path, page.url()).href))
  expect(requests.filter((url) => !localFavicons.has(url) && !/\.(js|css|png|jpg|webm|woff2?)(\?|$)/.test(url))).toEqual([])
  await page.getByTestId('coach-link-questions').click()
  await page.getByTestId('coach-ask-why').click()
  await expect(page.getByTestId('coach-answer-why')).toContainText('训练模型排序')
  await page.getByTestId('coach-link-result').click()
  await page.getByTestId('coach-start-first').click()
  await expect(page).toHaveURL(/\/routines\/yijinjing\/train\?form=yjj-1$/)
})

test('Competition B: a risk profile is paused and the model is not used', async ({ page }) => {
  await page.goto('/coach?view=profile')
  await fill(page, ['上肢动作练习', '肩部僵硬', '肩部', '上肢'], { risk: 'dizziness' })
  await expect(page.getByTestId('coach-safety-hold')).toContainText('暂停推荐')
  await expect(page.getByTestId('coach-result').locator('.fpw-rec')).toHaveCount(0)
  await expect(page.getByTestId('coach-model-state')).toHaveText('规则回退')
})

test('Matrix P1: M2 fixed answers provide a game route and a concrete next-stage chapter', async ({ page }) => {
  await page.goto('/coach?view=profile')
  await fill(page, ['日常锻炼', '暂无不适', '上肢'])
  await expect(page.getByTestId('coach-origin')).toHaveText('训练模型推荐')
  await expect(page.getByTestId('coach-next-step')).not.toContainText('下一阶段关注：—')
  await expect(page.getByTestId('coach-rec-racing')).toContainText('尚未接入游戏中心')
  await expect(page.getByTestId('coach-go-racing')).toHaveCount(0)
  await page.getByTestId('coach-link-questions').click()
  await page.getByTestId('coach-ask-first_game').click()
  const gameAnswer = page.getByTestId('coach-answer-first_game')
  await expect(gameAnswer).toContainText('林间划船')
  await expect(gameAnswer).not.toContainText('未配置启动地址')
  await expect(gameAnswer).not.toContainText('服务已连接')
  await expect(gameAnswer.getByRole('link', { name: '去游戏中心 →' })).toHaveAttribute('href', '/games?game=boating')
  await page.getByTestId('coach-ask-next_focus').click()
  const nextAnswer = page.getByTestId('coach-answer-next_focus')
  await expect(nextAnswer).toContainText('太极拳 · 云手')
  await expect(nextAnswer).not.toContainText(/下一阶段可关注：。|StartLux/)
  await expect(nextAnswer.getByRole('link', { name: '开始训练 →' })).toHaveAttribute('href', '/routines/taijiquan/train?form=tjq-10')
})

test('Competition C: an out-of-distribution profile abstains and shows the rule recommendation (§9 item 6)', async ({ page }) => {
  await page.goto('/coach?view=profile')
  await fill(page, ['肩颈活动练习', '暂无不适', '肩部', '颈部', '上肢', '下肢'], { preference: 'routine' })
  await expect(page.getByTestId('coach-origin')).toHaveText('规则推荐 · 模型已回退')
  await expect(page.getByTestId('coach-abstained')).toContainText('已弃权并使用规则推荐')
  await expect(page.getByTestId('coach-model-abstain')).toContainText('输入超出训练范围')
})

test('Competition D: URL parameters cannot change the build mode', async ({ page }) => {
  await page.goto('/coach?view=profile&coachMode=shadow&allowExperimentalModel=false')
  await fill(page, ['上肢动作练习', '肩部僵硬', '肩部', '上肢'])
  await expect(page.getByTestId('coach-origin')).toHaveText('训练模型推荐')
  await expect(page.getByTestId('coach-shadow-panel')).toHaveCount(0)
})

test('Competition E: the orb plays as a transparent video, stops under reduced motion, and keeps its poster when the video fails', async ({ page, browser }) => {
  await page.goto('/coach')
  await expect(page.getByTestId('coach-orb-stage')).toHaveAttribute('data-orb-state', 'video', { timeout: 15_000 })
  expect(await page.getByTestId('coach-orb-stage').locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true)

  const reduced = await browser.newContext({ reducedMotion: 'reduce', baseURL: test.info().project.use.baseURL })
  const still = await reduced.newPage()
  await still.goto('/coach')
  await expect(still.getByTestId('coach-orb-stage')).toHaveAttribute('data-orb-state', 'reduced-motion')
  // Reduced motion: no video is loaded at all, only the poster.
  await expect(still.getByTestId('coach-orb-stage').locator('video')).toHaveCount(0)
  await expect(still.getByTestId('coach-orb-stage').locator('img')).toBeVisible()
  await reduced.close()

  const broken = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  await broken.route('**/coach-orb-loop.webm', (route) => route.abort())
  const fallback = await broken.newPage()
  await fallback.goto('/coach')
  await fallback.waitForTimeout(1500)
  await expect(fallback.getByTestId('coach-orb-stage')).not.toHaveAttribute('data-orb-state', 'video')
  await expect(fallback.getByTestId('coach-orb-stage').locator('img')).toBeVisible()
  expect(await fallback.getByTestId('coach-orb-stage').locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  await broken.close()
})
