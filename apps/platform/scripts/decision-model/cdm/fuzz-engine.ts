/**
 * Robustness check of the public call (code review, not an experiment): mutates the documented full request in
 * malformed ways and asserts the engine never throws, stays JSON-safe, never shows the model without ACTIVE + approval +
 * clean input, never shows model output for a risk profile, and never shows content under safety_hold.
 *   node <VN> scripts/decision-model/cdm/fuzz-engine.ts [--out artifacts/integration/fuzz-engine.json]
 * Deterministic (LCG seed 20261108). 2026-11-08 run found sparse profile arrays reaching inference -> fixed in engine/input.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { recommendCoachDecision } from '../../../src/features/coachAgent/decisionModel/engine'

const args = process.argv.slice(2)
const OUT = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'scripts/decision-model/cdm/artifacts/integration/fuzz-engine.json')
const full = JSON.parse(readFileSync(resolve('docs/ai-coach-agent/decision-model/examples/request.full.json'), 'utf8'))

let seed = 20261108
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
const WEIRD: unknown[] = [null, undefined, 0, -1, 1e308, Number.NaN, Infinity, '', 'x', 'bdj-1', true, [], {}, [null], { a: 1 }, '__proto__', Date.now() + 9e12, -5e12, 1.5]
function paths(v: unknown, prefix: (string | number)[] = [], out: (string | number)[][] = []) {
  out.push(prefix)
  if (v && typeof v === 'object') for (const k of Object.keys(v as object)) paths((v as Record<string, unknown>)[k], [...prefix, Array.isArray(v) ? Number(k) : k], out)
  return out
}
function mutate(base: unknown): unknown {
  const x = structuredClone(base) as Record<string, unknown>
  const n = 1 + Math.floor(rnd() * 3)
  for (let i = 0; i < n; i += 1) {
    const all = paths(x).filter(p => p.length)
    const p = pick(all)
    let parent: any = x // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const k of p.slice(0, -1)) parent = parent?.[k]
    if (!parent || typeof parent !== 'object') continue
    const k = p[p.length - 1]
    const op = rnd()
    if (op < 0.35) parent[k] = pick(WEIRD)
    else if (op < 0.55) delete parent[k]
    else if (op < 0.7) parent[`extra_${i}`] = pick(WEIRD)
    else if (op < 0.8 && Array.isArray(parent[k])) parent[k] = [...parent[k], ...parent[k]]
    else if (op < 0.9 && typeof parent[k] === 'string') parent[k] = pick(['dizziness', 'pain', 'unknown-id', 'racing', 'apple', 'bdj-9', 'neck', 'routine', 'live_local_records'])
    else parent[k] = typeof parent[k] === 'number' ? (parent[k] as number) * pick([-1, 0, 1e6, 0.5]) : pick(WEIRD)
  }
  return x
}
const OPTIONS: unknown[] = [undefined, null, {}, { mode: 'off' }, { mode: 'shadow' }, { mode: 'active' }, { mode: 'active', allowExperimentalModel: true }, { mode: 'ACTIVE', allowExperimentalModel: true }, { mode: 'active', allowExperimentalModel: 'yes' }]
const failures: string[] = []
const tally: Record<string, number> = {}
let modelShown = 0
const N = 3000
const extras: unknown[] = [undefined, null, 42, 'fp-coach-decision/v1', [], { contract: 'fp-coach-decision/v1' }, { contract: 'fp-coach-decision/v2', profile: full.profile }]
for (let i = 0; i < N + extras.length; i += 1) {
  const input = i < extras.length ? extras[i] : mutate(full)
  const options = pick(OPTIONS)
  let res: any // eslint-disable-line @typescript-eslint/no-explicit-any
  try { res = recommendCoachDecision(input, options) } catch (e) { failures.push(`THROW #${i}: ${(e as Error).message}`); continue }
  try { JSON.parse(JSON.stringify(res)) } catch { failures.push(`NOT_JSON #${i}`) }
  if (res.contract !== 'fp-coach-decision/v1') failures.push(`CONTRACT #${i}`)
  tally[res.fallbackReason ?? 'MODEL_SHOWN'] = (tally[res.fallbackReason ?? 'MODEL_SHOWN'] ?? 0) + 1
  if (res.decisionOrigin === 'model') {
    modelShown += 1
    const o = options as { mode?: string; allowExperimentalModel?: unknown } | undefined
    if (!(o?.mode === 'active' && o.allowExperimentalModel === true)) failures.push(`MODEL_WITHOUT_APPROVAL #${i}`)
    if (res.fallbackReason !== null || res.inputIssues.length) failures.push(`MODEL_WITH_ISSUES #${i}`)
    if ((input as { profile?: { risk?: unknown } } | null)?.profile?.risk !== 'none') failures.push(`MODEL_FOR_RISK #${i}`)
    if (res.guard.checked !== true || res.guard.violations.length) failures.push(`MODEL_GUARD #${i}`)
  } else if (res.fallbackReason === null) failures.push(`RULES_WITHOUT_REASON #${i}`)
  if (res.status === 'safety_hold' && res.display && [...(res.display.result?.chapters ?? []), ...(res.display.result?.games ?? []), ...(res.display.result?.routines ?? [])].length) failures.push(`HOLD_SHOWS_CONTENT #${i}`)
  if (res.status === 'error' && res.display !== null) failures.push(`ERROR_WITH_DISPLAY #${i}`)
  if (res.executedActions !== false) failures.push(`ACTIONS #${i}`)
}
const summary = { checked: N + extras.length, failures: failures.length, firstFailures: failures.slice(0, 20), modelShown, outcomes: tally }
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary))
if (failures.length) process.exitCode = 1
