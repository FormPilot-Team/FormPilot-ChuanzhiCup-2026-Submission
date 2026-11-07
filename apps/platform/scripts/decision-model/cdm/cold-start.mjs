// E5 cold start: bundle the public decision engine like a browser build (esbuild, minified ESM), then measure in fresh
// Node processes: module import time, first call and second call. Usage (apps/platform):
//   node scripts/decision-model/cdm/cold-start.mjs <tmpDir> [runs]
import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [tmp, runsArg] = process.argv.slice(2)
if (!tmp) throw new Error('usage: cold-start.mjs <tmpDir> [runs]')
mkdirSync(tmp, { recursive: true })
const esbuild = await import(pathToFileURL(resolve('node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js')).href)
const entry = resolve(tmp, 'entry.ts')
const engineIndex = resolve('src/features/coachAgent/decisionModel/engine/index.ts').split('\\').join('/')
writeFileSync(entry, `export { recommendCoachDecision, COACH_DECISION_CONTRACT } from '${engineIndex}'\n`)
const bundle = resolve(tmp, 'engine.bundle.mjs')
await esbuild.build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', platform: 'neutral', outfile: bundle, logLevel: 'silent', mainFields: ['module', 'main'] })
const probe = resolve(tmp, 'probe.mjs')
writeFileSync(probe, `const t0 = performance.now()
const m = await import(${JSON.stringify(pathToFileURL(bundle).href)})
const t1 = performance.now()
const req = { contract: m.COACH_DECISION_CONTRACT, now: 1794139200000, profile: { version: 1, goals: ['upper_limb'], difficulties: ['none'], regions: ['shoulders', 'arms'], preference: 'mixed', risk: 'none', acknowledged: true } }
const first = m.recommendCoachDecision(req, { mode: 'active', allowExperimentalModel: true })
if (first.decisionOrigin !== 'model') throw new Error('cold start did not reach the model: ' + first.fallbackReason)
const t2 = performance.now()
m.recommendCoachDecision(req, { mode: 'active', allowExperimentalModel: true })
const t3 = performance.now()
console.log(JSON.stringify({ importMs: t1 - t0, firstCallMs: t2 - t1, secondCallMs: t3 - t2, rssMB: process.memoryUsage().rss / 1e6, heapMB: process.memoryUsage().heapUsed / 1e6 }))
`)
const runs = Number(runsArg ?? 7)
const samples = []
for (let i = 0; i < runs; i += 1) {
  const r = spawnSync(process.execPath, [probe], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  samples.push(JSON.parse(r.stdout.trim()))
}
const med = key => { const v = samples.map(s => s[key]).sort((a, b) => a - b); return Number(v[Math.floor(v.length / 2)].toFixed(3)) }
console.log(JSON.stringify({ runs, bundleBytes: statSync(bundle).size, median: { importMs: med('importMs'), firstCallMs: med('firstCallMs'), secondCallMs: med('secondCallMs'), rssMB: med('rssMB'), heapMB: med('heapMB') },
  note: 'fresh node process per run; release-bound engine (fp-cdm-release/1.0.0, AI-label experimental tier) in ACTIVE with the owner flag, so the first call runs the trained model end to end' }))
