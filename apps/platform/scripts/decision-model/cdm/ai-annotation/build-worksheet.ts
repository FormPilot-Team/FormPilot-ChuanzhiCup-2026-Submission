/**
 * Blinded annotator view for the AI annotation round (same information the HTML tool shows humans):
 * no pooledFrom, no split, no rules/PR #49/model ranks or scores.
 *   node <vite-node.mjs> scripts/decision-model/cdm/ai-annotation/build-worksheet.ts <out.txt>
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COACH_KNOWLEDGE } from '../../../../src/features/coachAgent/recommendation/catalogue'
import type { ScenarioFile } from '../scenarioTypes'

const text = readFileSync(resolve(import.meta.dirname, '../data/scenarios.v1.json'), 'utf8')
const file = JSON.parse(text) as ScenarioFile
const used = [...new Set(file.scenarios.flatMap(s => s.candidates))].sort()
const PROG: Record<string, string> = { baduanjin: '八段锦', taijiquan: '太极拳', wuqinxi: '五禽戏', yijinjing: '易筋经' }
const lines: string[] = [`scenarioSha256 ${createHash('sha256').update(text).digest('hex')}`, '', '## CANDIDATES']
for (const id of used) {
  const e = COACH_KNOWLEDGE.find(x => x.id === id)!
  lines.push(`${id} | ${e.title} | ${e.kind === 'game' ? '游戏(独立应用)' : `章节/${PROG[e.programId!]}`} | ${e.movement} | 部位 ${e.regions.join(',')} | 方向 ${e.focuses.join(',')} | 注意 ${e.caution.join(',') || '-'}`)
}
const families = [...new Set(file.scenarios.map(s => s.familyId))]
for (const f of families) {
  const group = file.scenarios.filter(s => s.familyId === f)
  const p = group[0].profile
  lines.push('', `## ${f} profile goals=${p.goals.join('+')} difficulties=${p.difficulties.join('+')} regions=${p.regions.join('+')} pref=${p.preference}`)
  for (const s of group) {
    const h = s.history ? `hist[28d=${s.history.sessionsLast28d}; ${s.history.routines.map(r => `${r.chapterId} x${r.sessions} done${r.completedSessions} ${r.lastDaysAgo}d score${r.meanScore} ${r.trend}`).join('; ')}${s.history.games.map(g => `; game ${g.gameId} x${g.plays} done${g.completedPlays} ${g.lastDaysAgo}d`).join('')}]` : 'hist[none]'
    const r = s.report ? `report[${s.report.daysAgo}d: ${s.report.findings.map(x => `${x.focus}@${x.subjectId} ${x.score}/100 ${x.trend}`).join('; ')}]` : 'report[none]'
    lines.push(`${s.id} ${h} ${r}`, `  cands: ${s.candidates.join(' ')}`)
  }
}
writeFileSync(process.argv[2], `${lines.join('\n')}\n`)
console.log(JSON.stringify({ out: process.argv[2], candidates: used.length, families: families.length, lines: lines.length }))
