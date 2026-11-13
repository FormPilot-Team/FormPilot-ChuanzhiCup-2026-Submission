import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// REAL MODEL: every answer is generated at run time by whatever model the demo gateway forwards to (its health label is
// recorded). The records the tools read are the demo's bundled SYNTHETIC dataset (a fictional user).
const OUT = process.env.FP_EVIDENCE_DIR ?? 'test-results/public-demo'
const QUESTIONS = [
  { id: 'A-today', text: '我今天应该练什么？', tool: 'recommend_training' },
  { id: 'D-knowledge', text: '八段锦第二式的标准动作要领是什么？', tool: 'search_knowledge' },
  { id: 'B-last', text: '我上一次训练有什么问题？', tool: 'read_last_training' },
  { id: 'C-progress', text: '我最近有没有进步？', tool: 'compare_recent_training' },
] as const

async function ask(page: Page, question: string) {
  const before = await page.getByTestId('coach-agent-answer').count()
  await page.getByTestId('coach-agent-input').fill(question)
  await page.getByTestId('coach-agent-send').click()
  const answer = page.getByTestId('coach-agent-answer').nth(before)
  await expect(answer).not.toHaveAttribute('data-source', 'running', { timeout: 180_000 })
  return answer
}

test('public demo: four competition questions on the real model, synthetic data disclosed', async ({ page, request }, info) => {
  const dir = join(OUT, info.project.name)
  mkdirSync(dir, { recursive: true })
  const health = await (await request.get('/v1/coach/agent/health')).json() as Record<string, unknown>
  expect(health).toMatchObject({ protocol: 'fp-coach-agent/1.2', status: 'ready', runtime: 'remote-demo', data: 'synthetic-demo', paid: false })
  const requests: string[] = []
  const origin = new URL(info.project.use.baseURL!).origin
  page.on('request', (req) => { const url = req.url(); if (!url.startsWith(`${origin}/`) && !url.startsWith('data:') && !url.startsWith('blob:')) requests.push(url) })

  await page.goto('/')
  await expect(page.getByTestId('public-demo-banner')).toContainText('虚构的示例用户')
  await expect(page.getByTestId('coach-agent-status')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 })
  await page.screenshot({ path: join(dir, '00-landing.png') })
  await page.getByTestId('coach-agent-consent').locator('input').check()

  const transcript: Array<Record<string, unknown>> = []
  for (const question of QUESTIONS) {
    const started = Date.now()
    const answer = await ask(page, question.text)
    const tools = await answer.locator('[data-tool]').evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.tool))
    transcript.push({
      id: question.id, question: question.text, elapsedMs: Date.now() - started,
      source: await answer.getAttribute('data-source'), tools,
      answer: await answer.getByTestId('coach-agent-text').textContent(),
      sourceLabel: await answer.getByTestId('coach-agent-source').textContent(),
      evidence: await answer.locator('[data-testid="coach-agent-evidence"] li, [data-testid="coach-agent-citations"] li b').allTextContents(),
    })
    expect(tools).toContain(question.tool)
    await answer.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(dir, `${question.id}.png`) })
  }
  writeFileSync(join(dir, 'transcript.json'), `${JSON.stringify({ url: page.url(), project: info.project.name, health, at: new Date().toISOString(), thirdPartyRequests: requests, transcript }, null, 2)}\n`)
  expect(requests).toEqual([])
  // Answers on records must come from the tools; the record evidence is labelled as synthetic.
  const recordTurns = transcript.filter((item) => item.id === 'B-last' || item.id === 'C-progress')
  for (const turn of recordTurns) expect((turn.evidence as string[]).join(' ')).toContain('合成示例')
})
