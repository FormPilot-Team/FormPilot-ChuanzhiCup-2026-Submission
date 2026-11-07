/**
 * M2 data: one row per (scenario, judged candidate) with fp-cdm features and both baselines' full orderings.
 *   node <vite-node.mjs> scripts/decision-model/cdm/export-ranking-matrix.ts
 * Labels are NOT produced here; they come only from human annotation files (see ingest_labels.py).
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COACH_KNOWLEDGE } from '../../../src/features/coachAgent/recommendation/catalogue'
import { recommendCoach } from '../../../src/features/coachAgent/recommendation/engine'
import type { CoachEvidence, CoachProfile, Focus, KnowledgeEntry } from '../../../src/features/coachAgent/recommendation/types'
import { rankCoachDecision, scoreCandidatesForEvaluation } from '../../../src/features/coachAgent/decisionModel/ranker'
import { buildFeatures, FEATURE_GROUPS, FEATURE_NAMES, FEATURE_SET_VERSION } from '../../../src/features/coachAgent/decisionModel/cdm/features'
import { stateFromScenario } from '../../../src/features/coachAgent/decisionModel/cdm/state'
import { scenarioEvidence } from './evidence'
import type { ScenarioFile } from './scenarioTypes'

const DIR = import.meta.dirname
const text = readFileSync(resolve(DIR, 'data/scenarios.v1.json'), 'utf8')
const file = JSON.parse(text) as ScenarioFile
const byId = new Map(COACH_KNOWLEDGE.map(e => [e.id, e]))

/** P0 engine rank tuple (recommendation/engine.ts), restated to order candidates beyond the P0 slate. */
function p0Tuple(entry: KnowledgeEntry, profile: CoachProfile, evidence: CoachEvidence[]): number[] {
  const focus: Focus[] = []
  if (profile.goals.includes('mobility') || profile.goals.includes('upper_limb')) focus.push('reach', 'coordination')
  if (profile.difficulties.includes('reach_difficulty') || profile.difficulties.includes('soreness')) focus.push('stability', 'coordination')
  if (profile.goals.includes('daily') || profile.difficulties.includes('sedentary')) focus.push('general', 'rhythm')
  if (profile.goals.includes('rehab_support')) focus.push('general', 'stability')
  const focuses = focus.length ? focus : ['general']
  const direct = (e: CoachEvidence) => typeof e.contentId === 'string' && (e.contentId === entry.id || e.contentId === entry.programId || e.contentId === entry.chapterId)
  return [entry.regions.filter(r => profile.regions.includes(r)).length * 10 + entry.focuses.filter(f => focuses.includes(f)).length,
    ...(['training', 'game', 'report', 'decision'] as const).map(c => Math.max(0, ...evidence.filter(e => e.category === c).map(e => direct(e) ? 3 : e.focuses.some(f => entry.focuses.includes(f)) ? 1 : 0)))]
}
const cmp = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return b[i] - a[i]; return 0 }
function unified(preference: CoachProfile['preference'], chapters: string[], games: string[]) {
  if (preference === 'routine') return [...chapters, ...games]
  if (preference === 'game') return [...games, ...chapters]
  const out: string[] = []
  for (let i = 0; i < Math.max(chapters.length, games.length); i += 1) { if (chapters[i]) out.push(chapters[i]); if (games[i]) out.push(games[i]) }
  return out
}

let slateMismatch = 0
const rows = file.scenarios.flatMap(s => {
  const evidence = scenarioEvidence(s.history, s.report)
  const pool = s.candidates.map(id => byId.get(id)!)
  // P0: its own slate first (exact engine output), then remaining candidates by the engine tuple.
  const rules = recommendCoach(s.profile, { evidence, limitations: [], decisionStatus: 'synthetic' })
  const order = (kind: 'chapter' | 'game', slate: string[]) => {
    const rest = pool.filter(e => e.kind === kind && !slate.includes(e.id)).sort((a, b) => cmp(p0Tuple(a, s.profile, evidence), p0Tuple(b, s.profile, evidence)) || a.id.localeCompare(b.id))
    return [...slate.filter(id => s.candidates.includes(id)), ...rest.map(e => e.id)]
  }
  const p0Order = unified(s.profile.preference, order('chapter', rules.chapters.map(c => c.entry.id)), order('game', rules.games.map(g => g.entry.id)))
  // PR #49: its unified priority first, then remaining candidates by its base utility.
  const ranker = rankCoachDecision({ profile: s.profile, evidence, availability: null, catalogue: COACH_KNOWLEDGE })
  const util = scoreCandidatesForEvaluation(s.profile, evidence, COACH_KNOWLEDGE, s.candidates)
  const prSlate = ranker.priority.map(i => i.id).filter(id => s.candidates.includes(id))
  if (prSlate.length !== ranker.priority.length) slateMismatch += 1
  const prOrder = [...prSlate, ...s.candidates.filter(id => !prSlate.includes(id)).sort((a, b) => util[b] - util[a] || a.localeCompare(b))]
  const state = stateFromScenario(s.profile, s.history, s.report)
  return pool.map(entry => ({
    scenarioId: s.id, familyId: s.familyId, condition: s.condition, split: s.split, candidateId: entry.id, kind: entry.kind,
    p0Rank: p0Order.indexOf(entry.id) + 1, pr49Rank: prOrder.indexOf(entry.id) + 1, pr49Utility: util[entry.id],
    features: Array.from(buildFeatures(state, entry, COACH_KNOWLEDGE)).map(v => Number(v.toFixed(6))),
  }))
})
const out = { schemaVersion: 1, id: 'fp-cdm-m2-matrix/v1', featureSet: FEATURE_SET_VERSION, scenarioSha256: createHash('sha256').update(text).digest('hex'),
  featureNames: FEATURE_NAMES, featureGroups: FEATURE_GROUPS, rows }
const outText = JSON.stringify(out)
writeFileSync(resolve(DIR, 'data/m2-matrix.v1.json'), outText)
console.log(JSON.stringify({ rows: rows.length, features: FEATURE_NAMES.length, groups: Object.values(FEATURE_GROUPS).reduce((m: Record<string, number>, g) => (m[g] = (m[g] ?? 0) + 1, m), {}), pr49SlateOutsidePool: slateMismatch, sha256: createHash('sha256').update(outText).digest('hex') }))
