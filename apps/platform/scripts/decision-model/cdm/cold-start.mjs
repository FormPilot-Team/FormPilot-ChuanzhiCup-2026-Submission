// E5 cold start: bundle the fp-cdm entry like a browser build (esbuild, minified ESM), then measure in fresh
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
writeFileSync(entry, `export { getCoachCdmRecommendation, createCdmService } from '${resolve('src/features/coachAgent/decisionModel/cdm/index.ts').replace(/\\/g, '/')}'\nexport { getCoachWebRecommendation } from '${resolve('src/features/coachAgent/recommendation/webService.ts').replace(/\\/g, '/')}'\n`)
const bundle = resolve(tmp, 'cdm.bundle.mjs')
await esbuild.build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', platform: 'neutral', outfile: bundle, logLevel: 'silent', mainFields: ['module', 'main'] })
const probe = resolve(tmp, 'probe.mjs')
writeFileSync(probe, `const t0 = performance.now()
const m = await import(${JSON.stringify(pathToFileURL(bundle).href)})
const t1 = performance.now()
const req = { schemaVersion: 1, source: 'rules', profile: { version: 1, goals: ['upper_limb'], difficulties: ['none'], regions: ['shoulders', 'arms'], preference: 'mixed', risk: 'none', acknowledged: true } }
m.getCoachCdmRecommendation(req, { mode: 'active' })
const t2 = performance.now()
m.getCoachCdmRecommendation(req, { mode: 'active' })
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
  note: 'fresh node process per run; bundled weights are the AWAITING_LABELS placeholder, so the first call measures the fallback path until trained weights are bundled' }))
