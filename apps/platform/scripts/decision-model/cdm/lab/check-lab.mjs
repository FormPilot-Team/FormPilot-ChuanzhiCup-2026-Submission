// Consistency check of Coach Decision Lab v3 against the real engine (headless Edge via Playwright).
//   node scripts/decision-model/cdm/lab/check-lab.mjs <lab.html> <out.json>      (run from apps/platform; needs vite-node results file, see below)
// 1. Embedded chart / table data (const D) equals the committed artifact files byte-for-byte (as parsed JSON).
// 2. Every demo case: the inputs are read from the page, re-run in Node through the public engine, and the page's
//    rendered titles / origin / fallback must equal the Node result; then each case's written claim is checked on the Node result.
// 3. No page errors, no network requests, no horizontal overflow at 1366 and 375 px.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const [file, outFile] = process.argv.slice(2)
const A = 'scripts/decision-model/cdm/artifacts'
const sources = {
  m2: `${A}/m2-ai-experiment/fp-cdm-m2.ai-experiment.report.json`, research: `${A}/m2-research/m2-research-ai-v1-features.json`, m1: `${A}/m1/fp-cdm-m1.metrics.json`,
  m1v11: `${A}/m1-v11/fp-cdm-m1-v11.report.json`, m1robust: `${A}/m1-v11/fp-cdm-m1-robustness.json`, aiq: 'scripts/decision-model/cdm/labels-ai/ai-label-quality.json',
  e245: `${A}/integration/cdm-e2-e4-e5-release.json`, cold: `${A}/integration/cold-start.json`, integ: `${A}/integration/integration-experiments.json`,
  probes: `${A}/integration/probes.json`, manifest: `${A}/integration/release-manifest.json`,
}
const { chromium } = await import(pathToFileURL(resolve('node_modules/@playwright/test/index.mjs')).href)
const browser = await chromium.launch({ channel: 'msedge' })
const report = { file, data: {}, cases: [], views: {} }
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const errors = [], requests = []
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('request', r => { if (!r.url().startsWith('file:')) requests.push(r.url()) })
await page.goto(pathToFileURL(resolve(file)).href); await page.waitForTimeout(800)

// 1. embedded data
const embedded = await page.evaluate(() => JSON.stringify(D))
const D = JSON.parse(embedded)
for (const [key, path] of Object.entries(sources)) report.data[key] = JSON.stringify(D[key]) === JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) ? 'identical' : 'DIFFERENT'
const variantNames = D.variants.map(v => v.name)
report.data.variants = variantNames.length

// 2. cases: page inputs + page rendering
const pageCases = await page.evaluate(() => CASES.map((c, k) => {
  const card = document.querySelectorAll('#cases .case')[k]
  const cols = [...card.querySelectorAll('.cols > div')].map(col => ({ pill: col.querySelector('.pill')?.innerText, warn: col.querySelector('p.warnc')?.innerText ?? null, titles: [...col.querySelectorAll('ol li')].map(li => li.innerText) }))
  return { title: c[0], before: c[2], after: c[3], rendered: cols }
}))
const tmp = resolve(outFile + '.cases-in.json'), tmpOut = resolve(outFile + '.cases-node.json')
writeFileSync(tmp, JSON.stringify(pageCases.map(c => [c.before, c.after])))
const VN = 'node_modules/.pnpm/vite-node@3.2.4_@types+node_de474a0b50d035fb47eb67fa144202a3/node_modules/vite-node/vite-node.mjs'
execFileSync(process.execPath, [VN, 'scripts/decision-model/cdm/lab/run-cases.ts', tmp, tmpOut], { stdio: 'inherit' })
const node = JSON.parse(readFileSync(tmpOut, 'utf8'))
const titlesOf = r => (r.display ? [...r.display.result.chapters, ...r.display.result.games].map(i => i.entry.title) : [])
const slate = r => (r.display ? [...r.display.result.chapters, ...r.display.result.games].map(i => i.entry.id) : [])
const claims = [
  ([a, b]) => ({ claim: '目标变化主要体现在候选集合上', ok: a.ranking.map(x => x.id).sort().join() !== b.ranking.map(x => x.id).sort().join() }),
  ([a, b], c) => {
    // "New" = not in the after-input's own history (chapters + games), applied to both slates.
    const seen = new Set([...(c.after.trainingHistory?.chapters ?? []).map(x => x.chapterId), ...(c.after.gameHistory?.games ?? []).map(x => x.gameId)])
    const novel = r => slate(r).filter(id => !seen.has(id)).length / Math.max(1, slate(r).length)
    return { claim: '历史后出现“与你最近的练习记录相衔接”，新内容占比下降', ok: b.ranking.some(x => x.inSlate && x.reasons.some(s => s.includes('与你最近的练习记录相衔接'))) && novel(b) < novel(a), detail: { history: [...seen], novelShareBefore: novel(a), novelShareAfter: novel(b) } }
  },
  ([a, b]) => ({ claim: '部位改变后推荐不同', ok: slate(a).join() !== slate(b).join() }),
  ([a, b]) => { const rk = r => r.ranking.find(x => x.id === 'bdj-2')?.rank ?? null; return { claim: '报告把所指章节 bdj-2 重新排到前面', ok: b.display?.result.chapters[0]?.entry.id === 'bdj-2' && rk(b) < rk(a), detail: { rankBefore: rk(a), rankAfter: rk(b) } } },
  ([, b]) => ({ claim: '不可用的林间射箭与太极拳不被排序或展示', ok: ![...slate(b), ...b.ranking.map(x => x.id)].some(id => id === 'archery' || id.startsWith('tjq')) }),
  ([, b]) => ({ claim: '风险画像暂停且模型未运行', ok: b.status === 'safety_hold' && b.execution === 'not_run' && slate(b).length === 0 }),
  ([a, b]) => ({ claim: '4 天前练过时模型展示；2 天前时分布外弃权（h_recency_this）', ok: a.decisionOrigin === 'model' && b.fallbackReason === 'MODEL_ABSTAINED' && b.abstainReason === 'OUT_OF_DISTRIBUTION' && b.outOfDistributionFeatures.includes('h_recency_this') }),
  ([a, b]) => ({ claim: '3 个部位模型展示；4 个部位分布外弃权（x_region_overlap）', ok: a.decisionOrigin === 'model' && b.fallbackReason === 'MODEL_ABSTAINED' && b.outOfDistributionFeatures.includes('x_region_overlap') }),
]
pageCases.forEach((c, k) => {
  const [a, b] = node[k]
  const same = (r, col) => col.pill === (r.decisionOrigin === 'model' ? '模型' : '规则') && (col.warn === null) === (r.fallbackReason === null) && (r.status === 'safety_hold' ? col.titles.length === 0 : col.titles.join('|') === titlesOf(r).join('|'))
  const claim = claims[k]([a, b], c)
  report.cases.push({ case: k + 1, title: c.title, pageEqualsNode: same(a, c.rendered[0]) && same(b, c.rendered[1]), before: { origin: a.decisionOrigin, fallback: a.fallbackReason, titles: titlesOf(a) }, after: { origin: b.decisionOrigin, fallback: b.fallbackReason, abstain: b.abstainReason, ood: b.outOfDistributionFeatures, titles: titlesOf(b) }, ...claim })
})
const ov = async p => p.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }))
report.views.desktop = await ov(page)
const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } })
mobile.on('pageerror', e => errors.push('mobile: ' + e.message))
await mobile.goto(pathToFileURL(resolve(file)).href); await mobile.waitForTimeout(800)
report.views.mobile = await ov(mobile)
report.errors = errors; report.externalRequests = requests
report.pass = Object.values(report.data).every(v => v === 'identical' || typeof v === 'number') && report.cases.every(c => c.pageEqualsNode && c.ok) && !errors.length && !requests.length
  && report.views.desktop.scrollWidth <= 1366 && report.views.mobile.scrollWidth <= 375
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ pass: report.pass, data: report.data, cases: report.cases.map(c => [c.case, c.pageEqualsNode, c.ok]), views: report.views, errors: errors.length, requests: requests.length }))
await browser.close()
