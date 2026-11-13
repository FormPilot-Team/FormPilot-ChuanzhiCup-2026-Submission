/**
 * Independent-source agreement: pose-measured descriptors vs hand-authored catalogue tags.
 * Also runs the small "route C" check: leave-one-programme-out learned thresholds vs the
 * pre-registered thresholds. Writes JSON to the evidence directory given as argv[2].
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COACH_KNOWLEDGE } from '../../src/features/coachAgent/recommendation/catalogue'
import descriptors from '../../src/features/coachAgent/decisionModel/motionDescriptors.json'

type Caution = 'overhead' | 'bending' | 'balance' | 'twist' | 'weight_bearing'
type Region = 'shoulders' | 'arms' | 'neck' | 'trunk' | 'legs'
const CHANNELS: Array<{ caution: Caution; flag: 'overhead' | 'bending' | 'balance' | 'twist' | 'weightBearing' }> = [
  { caution: 'overhead', flag: 'overhead' }, { caution: 'bending', flag: 'bending' }, { caution: 'balance', flag: 'balance' },
  { caution: 'twist', flag: 'twist' }, { caution: 'weight_bearing', flag: 'weightBearing' },
]
const REGIONS: Region[] = ['shoulders', 'arms', 'neck', 'trunk', 'legs']
const PROGRAMS = ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']

interface Row { id: string; program: string; kind: string; tags: Set<string>; regions: Set<string>; seconds: Record<string, number>; flagged: Record<string, boolean>; involvement: Record<string, number | null> }
const rows: Row[] = descriptors.chapters.filter(c => c.reliable).map(c => {
  const entry = COACH_KNOWLEDGE.find(e => e.id === c.chapterId)
  if (!entry) throw new Error(`catalogue missing ${c.chapterId}`)
  const flags = c.flags as Record<string, { sustainedSeconds: number; flagged: boolean }>
  return {
    id: c.chapterId, program: c.programId, kind: c.kind, tags: new Set(entry.caution), regions: new Set(entry.regions),
    seconds: Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, v.sustainedSeconds])),
    flagged: Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, v.flagged])),
    involvement: c.involvement as Record<string, number | null>,
  }
})

function confusion(pairs: Array<[boolean, boolean]>) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const [predicted, actual] of pairs) {
    if (predicted && actual) tp++
    else if (predicted) fp++
    else if (actual) fn++
    else tn++
  }
  const n = tp + fp + fn + tn
  const po = (tp + tn) / n
  const pe = ((tp + fp) * (tp + fn) + (fn + tn) * (fp + tn)) / (n * n)
  const kappa = pe < 1 ? (po - pe) / (1 - pe) : 0
  return { tp, fp, fn, tn, n, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null, kappa: Number(kappa.toFixed(4)) }
}
/** Mann-Whitney AUC: P(score of positive > score of negative), ties count half. */
function auc(positives: number[], negatives: number[]) {
  if (!positives.length || !negatives.length) return null
  let wins = 0
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0
  return Number((wins / (positives.length * negatives.length)).toFixed(4))
}
function bestThreshold(train: Array<{ x: number; y: boolean }>) {
  const candidates = [...new Set(train.map(item => item.x))].sort((a, b) => a - b)
  let best = { threshold: Infinity, kappa: -Infinity }
  for (const value of [0, ...candidates]) {
    // predict positive when x > threshold
    const { kappa } = confusion(train.map(item => [item.x > value, item.y]))
    if (kappa > best.kappa + 1e-12) best = { threshold: value, kappa }
  }
  return best.threshold
}

const cautionAgreement = CHANNELS.map(({ caution, flag }) => {
  const pre = confusion(rows.map(row => [row.flagged[flag], row.tags.has(caution)]))
  const lopoPairs: Array<[boolean, boolean]> = []
  const folds = PROGRAMS.map(program => {
    const train = rows.filter(row => row.program !== program).map(row => ({ x: row.seconds[flag], y: row.tags.has(caution) }))
    const threshold = bestThreshold(train)
    const test = rows.filter(row => row.program === program)
    for (const row of test) lopoPairs.push([row.seconds[flag] > threshold, row.tags.has(caution)])
    return { heldOut: program, learnedThresholdSeconds: threshold }
  })
  const firing = pre.tp + pre.fp
  const usable = firing >= 3 && pre.precision !== null && pre.precision >= 0.6
  return {
    caution, measuredFlag: flag,
    preRegistered: pre,
    lopoLearned: { ...confusion(lopoPairs), folds },
    measuredOnlyChapters: rows.filter(row => row.flagged[flag] && !row.tags.has(caution)).map(row => ({ id: row.id, sustainedSeconds: row.seconds[flag] })),
    tagOnlyChapters: rows.filter(row => !row.flagged[flag] && row.tags.has(caution)).map(row => ({ id: row.id, sustainedSeconds: row.seconds[flag] })),
    usageRuleU1: usable ? 'USED_IN_CONSERVATIVE_UNION' : 'AUDIT_ONLY',
  }
})

const regionAgreement = REGIONS.map(region => {
  const scored = rows.filter(row => row.involvement[region] !== null)
  const value = auc(scored.filter(row => row.regions.has(region)).map(row => row.involvement[region] as number), scored.filter(row => !row.regions.has(region)).map(row => row.involvement[region] as number))
  const perProgram = PROGRAMS.map(program => ({ program, auc: auc(
    scored.filter(row => row.program === program && row.regions.has(region)).map(row => row.involvement[region] as number),
    scored.filter(row => row.program === program && !row.regions.has(region)).map(row => row.involvement[region] as number)) }))
  return { region, n: scored.length, tagged: scored.filter(row => row.regions.has(region)).length, auc: value, perProgram, usageRuleU2: value !== null && value >= 0.7 ? 'USED_FOR_RANKING_REFINEMENT' : 'TAGS_ONLY' }
})

const deepKnee = rows.filter(row => row.flagged.deepKnee).map(row => ({ id: row.id, sustainedSeconds: row.seconds.deepKnee }))
const out = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  descriptorsId: descriptors.id, extractorVersion: descriptors.extractorVersion, configSha256: descriptors.configSha256,
  scope: `${rows.length} reliable chapters (opening/closing included; ${descriptors.chapters.length - rows.length} unreliable excluded)`,
  sourcesIndependence: 'catalogue tags were hand-authored from captions/movement descriptions; descriptors come from pose tracks and the extractor never reads tags',
  cautionAgreement, regionAgreement,
  deepKneeFlagged: { note: 'no catalogue caution category; load descriptor only (U3)', chapters: deepKnee },
}
const target = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, 'descriptor-audit.json')
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`)
for (const item of cautionAgreement) console.log(item.caution.padEnd(15), 'pre', JSON.stringify({ p: item.preRegistered.precision?.toFixed(2), r: item.preRegistered.recall?.toFixed(2), k: item.preRegistered.kappa, tp: item.preRegistered.tp, fp: item.preRegistered.fp, fn: item.preRegistered.fn }), 'lopo', JSON.stringify({ p: item.lopoLearned.precision?.toFixed(2), r: item.lopoLearned.recall?.toFixed(2), k: item.lopoLearned.kappa }), item.usageRuleU1)
for (const item of regionAgreement) console.log(item.region.padEnd(10), 'auc', item.auc, item.usageRuleU2, JSON.stringify(item.perProgram.map(p => p.auc)))
console.log('written', target)
