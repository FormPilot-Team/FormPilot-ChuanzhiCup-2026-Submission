import { expect, test, type Page, type Route } from '@playwright/test'
import { SESSION_STORAGE_KEY } from '../../src/features/training/LocalStorageTrainingSessionRepository'
import { FULL_IMPROVEMENT } from '../analysis-fixtures'
import { markOnboardingSeen } from './support/onboarding'

// Web V1.2 AI Coach free-text chat — UI tests with a FAKE AGENT BRIDGE (Playwright route, scripted NDJSON).
// The fake stands in for server/coachAgent/agent; no model runs here. Real-model behaviour is measured by
// tests/llm-eval (agent.eval.ts / rag.eval.ts) against the real local Qwen3-4B and reported separately.

const BRIDGE = 'http://127.0.0.1:4321'
const HEALTH_READY = { protocol: 'fp-coach-agent/1.2', status: 'ready', model: 'qwen3:4b-instruct-2507-q4_K_M', digest: 'sha256:0edcdef34593…', runtime: 'ollama-local', paid: false, tokenRequired: false, warm: 'warm' }
const ndjson = (events: unknown[]) => events.map((event) => JSON.stringify(event)).join('\n') + '\n'
const done = { type: 'done', model: 'qwen3:4b-instruct-2507-q4_K_M', metrics: { promptTokens: 900, outputTokens: 40, outputMs: 400, promptMs: 30, loadMs: 0, totalMs: 450 } }

async function fakeBridge(page: Page, options: { health?: 'ready' | 'down'; answer?: string } = {}) {
  const chats: Array<{ messages: Array<{ role: string; content: string }>; allowTools: boolean }> = []
  await page.route(`${BRIDGE}/v1/coach/agent/health`, (route: Route) => options.health === 'down' ? route.abort('connectionrefused') : route.fulfill({ json: HEALTH_READY }))
  await page.route(`${BRIDGE}/v1/coach/agent/chat`, async (route: Route) => {
    const body = route.request().postDataJSON() as (typeof chats)[number]
    chats.push(body)
    const last = body.messages.at(-1)
    // Round 1: the "model" asks for the knowledge tool; round 2 (after the tool result): it answers with a citation.
    const events = last?.role === 'tool'
      ? [{ type: 'delta', text: options.answer?.slice(0, 6) ?? '马步高低' }, { type: 'delta', text: options.answer?.slice(6) ?? '要量力而行，两手同高 [K1]。' }, done]
      : [{ type: 'tool_calls', calls: [{ name: 'search_knowledge', arguments: { query: '左右开弓似射雕 常见错误', topic: 'baduanjin' } }] }, done]
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson(events) })
  })
  return chats
}

async function openQuestions(page: Page) {
  await markOnboardingSeen(page)
  await page.goto('/coach?view=questions')
  await page.getByTestId('coach-link-questions').click()
}

test('Web V1.2 A: fake bridge ready → tool progress, validated answer, model source and expandable citations', async ({ page }) => {
  const chats = await fakeBridge(page)
  await openQuestions(page)
  await expect(page.getByTestId('coach-agent-status')).toHaveAttribute('data-status', 'ready')
  await expect(page.getByTestId('coach-agent-status')).toContainText('Qwen3-4B-Instruct（本机） 已就绪')
  await page.getByTestId('coach-agent-input').fill('八段锦第二式左右开弓似射雕有哪些常见错误？')
  await page.getByTestId('coach-agent-send').click()
  const answer = page.getByTestId('coach-agent-answer').last()
  await expect(answer).toHaveAttribute('data-source', 'llm')
  await expect(answer).toContainText('马步高低要量力而行')
  await expect(answer.locator('[data-tool="search_knowledge"]')).toContainText('检索功法知识库')
  await expect(page.getByTestId('coach-agent-source')).toContainText('本机大模型生成')
  await answer.getByRole('button', { name: '查看依据 K1' }).click()
  await expect(page.getByTestId('coach-agent-citations')).toBeVisible()
  await expect(page.getByTestId('coach-agent-citations')).toContainText('[K1]')
  await expect(page.getByTestId('coach-agent-details')).toContainText('模型文本不作为证据')
  expect(chats).toHaveLength(2)
  expect(chats[0].allowTools).toBe(true)
  expect(chats[1].messages.at(-1)?.role).toBe('tool')
})

test('Web V1.2 B: bridge unavailable → input disabled, honest status, fixed five unaffected', async ({ page }) => {
  await fakeBridge(page, { health: 'down' })
  await openQuestions(page)
  await expect(page.getByTestId('coach-agent-status')).toHaveAttribute('data-status', 'bridge_unavailable')
  await expect(page.getByTestId('coach-agent-status')).toContainText('本地 AI 模型未连接')
  await expect(page.getByTestId('coach-agent-input')).toBeDisabled()
  await expect(page.getByTestId('coach-agent-send')).toBeDisabled()
  await expect(page.getByTestId('coach-agent-example')).toHaveCount(0)
  await expect(page.getByTestId('coach-ask-why')).toBeDisabled()
})

test('Web V1.2 C: acute-risk question gets the safety rule without any model call; chat survives panel switches', async ({ page }) => {
  const chats = await fakeBridge(page)
  await openQuestions(page)
  await expect(page.getByTestId('coach-agent-status')).toHaveAttribute('data-status', 'ready')
  await page.getByTestId('coach-agent-input').fill('我刚才练的时候膝盖突然剧痛，现在还头晕，要继续吗？')
  await page.getByTestId('coach-agent-input').press('Enter')
  const answer = page.getByTestId('coach-agent-answer').last()
  await expect(answer).toHaveAttribute('data-source', 'safety_rule')
  await expect(answer).toContainText('先停下来')
  await expect(page.getByTestId('coach-agent-source')).toContainText('安全规则回答（不经过大模型）')
  expect(chats).toHaveLength(0)
  await page.getByTestId('coach-link-profile').click()
  await page.getByTestId('coach-link-questions').click()
  await expect(page.getByTestId('coach-agent-turn')).toHaveCount(1)
})

test('Web V1.2 D: an answer with an ungrounded score is replaced by the rule rendering (record flow, fake bridge)', async ({ page }) => {
  await page.route(`${BRIDGE}/v1/coach/agent/health`, (route) => route.fulfill({ json: HEALTH_READY }))
  await page.route(`${BRIDGE}/v1/coach/agent/chat`, (route) => {
    const body = route.request().postDataJSON() as { messages: Array<{ role: string }> }
    const events = body.messages.at(-1)?.role === 'tool' ? [{ type: 'delta', text: '你上次得了 97 分。' }, done] : [{ type: 'tool_calls', calls: [{ name: 'read_last_training', arguments: { kind: 'warmup' } }] }, done]
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson(events) })
  })
  await openQuestions(page)
  await expect(page.getByTestId('coach-agent-status')).toHaveAttribute('data-status', 'ready')
  await page.getByTestId('coach-agent-input').fill('我上一次热身训练练得怎么样？')
  await page.getByTestId('coach-agent-send').click()
  const answer = page.getByTestId('coach-agent-answer').last()
  await expect(answer).toHaveAttribute('data-source', 'rules_fallback')
  await expect(answer).not.toContainText('97 分')
  await expect(answer).toContainText('授权')
  await expect(page.getByTestId('coach-agent-source')).toContainText('模型回答未通过安全与证据校验')
})

test('Web V1.2 E: report hand-off prefills (never sends) the question; consented record read reaches the model as tool data only', async ({ page }) => {
  // TEST FIXTURE records (golden warm-up sessions from the analysis suite), not a real person's training.
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value) }, { key: SESSION_STORAGE_KEY, value: JSON.stringify([...FULL_IMPROVEMENT.history, FULL_IMPROVEMENT.current]) })
  await page.route(`${BRIDGE}/v1/coach/agent/health`, (route) => route.fulfill({ json: HEALTH_READY }))
  const chats: Array<{ messages: Array<{ role: string; content: string }> }> = []
  await page.route(`${BRIDGE}/v1/coach/agent/chat`, (route) => {
    const body = route.request().postDataJSON() as (typeof chats)[number]
    chats.push(body)
    const events = body.messages.at(-1)?.role === 'tool' ? [{ type: 'delta', text: '上次的主要问题见下方记录证据，下次先把动作做稳。' }, done] : [{ type: 'tool_calls', calls: [{ name: 'read_last_training', arguments: { kind: 'warmup' } }] }, done]
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson(events) })
  })
  await markOnboardingSeen(page)
  await page.goto(`/coach?view=questions&ask=${encodeURIComponent('我上一次热身训练练得怎么样？主要问题在哪里？')}`)
  await expect(page.getByTestId('coach-agent-status')).toHaveAttribute('data-status', 'ready')
  await expect(page.getByTestId('coach-agent-input')).toHaveValue('我上一次热身训练练得怎么样？主要问题在哪里？')
  expect(chats).toHaveLength(0)
  await page.getByTestId('coach-agent-consent').locator('input').check()
  await page.getByTestId('coach-agent-send').click()
  const answer = page.getByTestId('coach-agent-answer').last()
  await expect(answer).toHaveAttribute('data-source', 'llm')
  await answer.getByTestId('coach-agent-details').locator('summary').click()
  await expect(page.getByTestId('coach-agent-evidence')).toContainText('热身')
  const toolMessage = chats[1].messages.at(-1)!
  expect(toolMessage.role).toBe('tool')
  expect(toolMessage.content).toContain('overallScore')
})

test('Web V1.2 F: a rejected draft streamed slowly never appears on screen before the rule answer replaces it', async ({ page }) => {
  // FAKE BRIDGE with real incremental streaming: an in-page fetch stub returns a ReadableStream that sends one NDJSON
  // line every 150 ms, so React gets to render between chunks. A MutationObserver records every text the answer area
  // ever showed. The draft promises a cure; validation must reject it and the dangerous words must never be visible.
  await page.route(`${BRIDGE}/v1/coach/agent/health`, (route) => route.fulfill({ json: HEALTH_READY }))
  await page.addInitScript(({ bridge, doneEvent }) => {
    const original = window.fetch.bind(window)
    let round = 0
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.startsWith(`${bridge}/v1/coach/agent/chat`)) return original(input, init)
      round += 1
      const events = round === 1
        ? [{ type: 'tool_calls', calls: [{ name: 'search_knowledge', arguments: { query: '八段锦 腰椎', topic: 'baduanjin' } }] }, doneEvent]
        : [...['坚持练', '八段锦，', '保证能', '治愈', '你的腰椎间盘突出。'].map((text) => ({ type: 'delta', text })), doneEvent]
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
            await new Promise((resolve) => setTimeout(resolve, 150))
          }
          controller.close()
        },
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
    }
    const seen: string[] = []
    ;(window as unknown as { __agentSeen: string[] }).__agentSeen = seen
    const watch = () => new MutationObserver(() => {
      // Everything the answer bubble shows except the collapsed diagnostics (which name the rejected rule, e.g. MEDICAL_PROMISE).
      for (const node of document.querySelectorAll('[data-testid="coach-agent-answer"]')) {
        const copy = node.cloneNode(true) as HTMLElement
        copy.querySelectorAll('details').forEach((item) => item.remove())
        seen.push(copy.textContent ?? '')
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
    if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch)
  }, { bridge: BRIDGE, doneEvent: done })
  await openQuestions(page)
  await expect(page.getByTestId('coach-agent-status')).toHaveAttribute('data-status', 'ready')
  await page.getByTestId('coach-agent-input').fill('练八段锦能治好腰椎间盘突出吗？')
  await page.getByTestId('coach-agent-send').click()
  const answer = page.getByTestId('coach-agent-answer').last()
  // While the draft streams, only progress is shown.
  await expect(answer.getByTestId('coach-agent-drafting')).toContainText('校验通过后显示')
  await expect(answer).toHaveAttribute('data-source', 'rules_fallback', { timeout: 10_000 })
  await expect(page.getByTestId('coach-agent-source')).toContainText('模型回答未通过安全与证据校验')
  await expect(answer.getByTestId('coach-agent-text')).not.toContainText('治愈')
  await expect(answer.getByTestId('coach-agent-text')).toContainText('八段锦')
  const seen = await page.evaluate(() => (window as unknown as { __agentSeen: string[] }).__agentSeen)
  expect(seen.length).toBeGreaterThan(3)
  expect(seen.some((text) => text.includes('模型已生成'))).toBe(true)
  for (const word of ['保证能', '治愈', '坚持练八段锦']) expect(seen.filter((text) => text.includes(word))).toEqual([])
})
