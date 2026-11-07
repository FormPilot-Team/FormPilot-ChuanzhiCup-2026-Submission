/**
 * Writes the Web integration JSON examples from REAL engine calls (never hand-written), so the docs cannot drift from the code.
 *   node <vite-node.mjs> scripts/decision-model/cdm/export-examples.ts [--out docs/ai-coach-agent/decision-model/examples]
 * Inputs are synthetic demo inputs (origin 'synthetic_demo'); fixed clock for reproducibility.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CoachProfile } from '../../../src/features/coachAgent/recommendation/types'
import { COACH_DECISION_CONTRACT, createCoachDecisionEngine, recommendCoachDecision, type CoachDecisionInput } from '../../../src/features/coachAgent/decisionModel/engine'

const args = process.argv.slice(2)
const OUT = resolve(args[args.indexOf('--out') + 1] && args.includes('--out') ? args[args.indexOf('--out') + 1] : 'docs/ai-coach-agent/decision-model/examples')
mkdirSync(OUT, { recursive: true })
const NOW = Date.UTC(2026, 10, 8, 4) // 2026-11-08 12:00 UTC+8
const DAY = 86_400_000
const profile: CoachProfile = { version: 1, goals: ['upper_limb'], difficulties: ['stiffness'], regions: ['shoulders', 'arms'], preference: 'mixed', risk: 'none', acknowledged: true }
const minimal: CoachDecisionInput = { contract: COACH_DECISION_CONTRACT, profile, now: NOW }
const full: CoachDecisionInput = {
  contract: COACH_DECISION_CONTRACT, profile, now: NOW,
  trainingHistory: { origin: 'synthetic_demo', chapters: [
    { chapterId: 'bdj-1', sessions: 5, completedSessions: 5, meanScore: 70, trend: 'up', lastPracticedAt: NOW - 5 * DAY },
    { chapterId: 'bdj-2', sessions: 3, completedSessions: 2, meanScore: 64, trend: 'flat', lastPracticedAt: NOW - 4 * DAY },
  ] },
  gameHistory: { origin: 'synthetic_demo', games: [{ gameId: 'apple', plays: 3, completedPlays: 3, lastPlayedAt: NOW - 1 * DAY }] },
  latestReport: { origin: 'synthetic_demo', createdAt: NOW - 1 * DAY, findings: [{ focus: 'stability', subjectId: 'bdj-2', score: 52, trend: 'worse' }] },
  availability: { snapshotRef: 'web-demo-2026-11-08', unavailableIds: ['racing'] },
}
const write = (name: string, value: unknown) => writeFileSync(resolve(OUT, name), `${JSON.stringify(value, null, 2)}\n`)
const files: Array<[string, unknown]> = [
  ['request.minimal.json', minimal],
  ['request.full.json', full],
  ['response.off.json', recommendCoachDecision(full)],
  ['response.shadow.json', recommendCoachDecision(full, { mode: 'shadow' })],
  ['response.active-not-approved.json', recommendCoachDecision(full, { mode: 'active' })],
  ['response.active-approved.json', recommendCoachDecision(full, { mode: 'active', allowExperimentalModel: true })],
  ['response.safety-hold.json', recommendCoachDecision({ ...minimal, profile: { ...profile, risk: 'dizziness' } }, { mode: 'active', allowExperimentalModel: true })],
  ['response.abstain-out-of-distribution.json', recommendCoachDecision({ ...minimal, profile: { ...profile, goals: ['mobility'], difficulties: ['none'], regions: ['shoulders', 'neck', 'arms', 'legs'], preference: 'routine' } }, { mode: 'active', allowExperimentalModel: true })],
  ['response.input-invalid.json', recommendCoachDecision({ ...minimal, trainingHistory: { origin: 'live_local_records', chapters: [{ chapterId: 'unknown-chapter', sessions: 1 }] } }, { mode: 'active', allowExperimentalModel: true })],
  ['response.error-invalid-envelope.json', recommendCoachDecision({ profile }, { mode: 'active', allowExperimentalModel: true })],
  // Known limitation (MODEL_REPORT §open issues): the top candidate practised 0-2 days ago is outside the training range of
  // h_recency_this (training saw 4-20 days), so the model abstains and the rules result is shown.
  ['response.abstain-recent-practice.json', recommendCoachDecision({ ...full, trainingHistory: { origin: 'synthetic_demo', chapters: [full.trainingHistory!.chapters[0], { ...full.trainingHistory!.chapters[1], lastPracticedAt: NOW - 2 * DAY }] } }, { mode: 'active', allowExperimentalModel: true })],
  ['response.model-missing.json', createCoachDecisionEngine({ weights: undefined }).recommend(full, { mode: 'active', allowExperimentalModel: true })],
]
for (const [name, value] of files) write(name, value)
console.log(JSON.stringify({ out: OUT, files: files.map(([n, v]) => [n, (v as { fallbackReason?: string }).fallbackReason ?? 'request']) }))
