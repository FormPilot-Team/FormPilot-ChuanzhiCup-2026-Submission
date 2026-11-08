import type { CoachEvidence, Focus, KnowledgeEntry } from '../../recommendation/types'
import type { DataOriginTag, DecisionState, StateFinding, StateGameRecord, StateRoutineRecord } from '../cdm/state'
import type { CatalogueAvailability } from '../types'
import { COACH_DECISION_CONTRACT, type CoachDecisionDataOrigin, type CoachDecisionResponse } from './contract'

/**
 * Strict validation of a CoachDecisionInput and its mapping to the model's DecisionState (same shape the model was
 * trained on) plus CoachEvidence for the stage-1 retrieval baselines (same construction as the training scenarios).
 * Nothing is repaired or defaulted: an invalid block is reported as an issue and the model does not run.
 */
export const DAY_MS = 86_400_000
const ORIGINS: readonly CoachDecisionDataOrigin[] = ['live_local_records', 'synthetic_demo']
const TOP_KEYS = ['contract', 'profile', 'trainingHistory', 'gameHistory', 'latestReport', 'availability', 'now']
/** Programme-level focus mapping, identical to recommendation/context.ts and the training scenarios. */
const SUBJECT_FOCUS: Record<string, Focus[]> = { baduanjin: ['coordination', 'rhythm'], taijiquan: ['coordination', 'stability'], wuqinxi: ['coordination', 'rhythm'], yijinjing: ['stability'] }

export interface InputIssue { path: string; message: string }
export interface PreparedInput {
  /** false only when the envelope itself is unusable (not an object / wrong contract). */
  envelopeOk: boolean
  profile: unknown
  now: number
  state: { history: DecisionState['history']; report: DecisionState['report'] }
  evidence: CoachEvidence[]
  availability: CatalogueAvailability | null
  availabilityValid: boolean
  issues: InputIssue[]
  dataSources: CoachDecisionResponse['dataSources']
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const nullableNumber = (v: unknown, lo: number, hi: number, integer = false) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi && (!integer || Number.isInteger(v)))
const nn = <T>(v: T | undefined | null): T | null => (v === undefined ? null : v)

export function prepareDecisionInput(raw: unknown, catalogue: readonly KnowledgeEntry[], clock: () => number): PreparedInput {
  const issues: InputIssue[] = []
  const missingSources: CoachDecisionResponse['dataSources'] = { profile: 'self_reported', trainingHistory: 'missing', gameHistory: 'missing', latestReport: 'missing', catalogue: 'trusted_project_catalogue' }
  const empty = { history: { status: 'missing' as const }, report: { status: 'missing' as const } }
  if (!obj(raw) || raw.contract !== COACH_DECISION_CONTRACT) {
    return { envelopeOk: false, profile: undefined, now: clock(), state: empty, evidence: [], availability: null, availabilityValid: true, issues: [{ path: '$.contract', message: `必须为 ${COACH_DECISION_CONTRACT}` }], dataSources: missingSources }
  }
  for (const key of Object.keys(raw)) if (!TOP_KEYS.includes(key)) issues.push({ path: `$.${key}`, message: '未知字段（契约 v1 不接受）' })
  // Sparse arrays (holes) are skipped by Array#every in the shared profile validator but reach the ranker as undefined.
  // JSON input can never contain holes; programmatic input is reported here instead of failing inside inference.
  if (obj(raw.profile)) for (const key of ['goals', 'difficulties', 'regions']) {
    const list = raw.profile[key]
    if (Array.isArray(list)) for (let i = 0; i < list.length; i += 1) if (!(i in list)) issues.push({ path: `$.profile.${key}[${i}]`, message: '数组不能有空位' })
  }
  let now = clock()
  if (raw.now !== undefined) {
    if (typeof raw.now === 'number' && Number.isFinite(raw.now) && raw.now > 0) now = raw.now
    else issues.push({ path: '$.now', message: '必须为正的 epoch 毫秒数' })
  }
  const byId = new Map(catalogue.map(e => [e.id, e]))
  const chapters = new Set(catalogue.filter(e => e.kind === 'chapter').map(e => e.id))
  const games = new Set(catalogue.filter(e => e.kind === 'game').map(e => e.id))
  const time = (v: unknown) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= now + DAY_MS)
  const daysAgo = (t: number | null | undefined) => (t === null || t === undefined ? null : Math.max(0, Math.round((now - t) / DAY_MS)))
  const sources = { ...missingSources }
  const origins: CoachDecisionDataOrigin[] = []
  const block = (name: string, value: unknown, listKey: string, max: number): Record<string, unknown>[] | null => {
    if (value === undefined || value === null) return null
    if (!obj(value)) { issues.push({ path: `$.${name}`, message: '必须为对象或 null' }); return null }
    for (const key of Object.keys(value)) if (!['origin', listKey, 'createdAt'].includes(key) || (key === 'createdAt' && name !== 'latestReport')) issues.push({ path: `$.${name}.${key}`, message: '未知字段' })
    if (!ORIGINS.includes(value.origin as CoachDecisionDataOrigin)) issues.push({ path: `$.${name}.origin`, message: `必须为 ${ORIGINS.join(' / ')}` })
    const list = value[listKey]
    if (!Array.isArray(list) || list.length > max || !list.every(obj)) { issues.push({ path: `$.${name}.${listKey}`, message: `必须为不超过 ${max} 项的对象数组` }); return null }
    if (ORIGINS.includes(value.origin as CoachDecisionDataOrigin)) origins.push(value.origin as CoachDecisionDataOrigin)
    return list as Record<string, unknown>[]
  }

  const routines: StateRoutineRecord[] = []
  const tList = block('trainingHistory', raw.trainingHistory, 'chapters', 200)
  if (tList) {
    const seen = new Set<string>()
    tList.forEach((c, i) => {
      const p = `$.trainingHistory.chapters[${i}]`
      for (const key of Object.keys(c)) if (!['chapterId', 'sessions', 'completedSessions', 'meanScore', 'trend', 'lastPracticedAt'].includes(key)) issues.push({ path: `${p}.${key}`, message: '未知字段' })
      const id = c.chapterId
      if (typeof id !== 'string' || !chapters.has(id)) { issues.push({ path: `${p}.chapterId`, message: '不是可信目录中的章节 id' }); return }
      if (seen.has(id)) { issues.push({ path: `${p}.chapterId`, message: '重复章节，请先聚合' }); return }
      seen.add(id)
      const sessions = c.sessions
      if (!(typeof sessions === 'number' && Number.isInteger(sessions) && sessions >= 1 && sessions <= 100_000)) { issues.push({ path: `${p}.sessions`, message: '必须为 >= 1 的整数' }); return }
      if (!nullableNumber(c.completedSessions, 0, sessions, true)) issues.push({ path: `${p}.completedSessions`, message: '必须为 0..sessions 的整数或 null' })
      if (!nullableNumber(c.meanScore, 0, 100)) issues.push({ path: `${p}.meanScore`, message: '必须为 0..100 或 null' })
      if (!(c.trend === undefined || c.trend === null || ['up', 'flat', 'down'].includes(c.trend as string))) issues.push({ path: `${p}.trend`, message: '必须为 up / flat / down / null' })
      if (!time(c.lastPracticedAt)) issues.push({ path: `${p}.lastPracticedAt`, message: '必须为不晚于 now 的 epoch 毫秒或 null' })
      routines.push({ chapterId: id, programId: byId.get(id)?.programId as string, sessions, completedSessions: nn(c.completedSessions as number | null | undefined),
        lastDaysAgo: daysAgo(c.lastPracticedAt as number | null | undefined), meanScore: nn(c.meanScore as number | null | undefined), trend: nn(c.trend as StateRoutineRecord['trend'] | undefined) })
    })
    if (routines.length) sources.trainingHistory = (raw.trainingHistory as { origin: CoachDecisionDataOrigin }).origin
  }

  const gameRecords: StateGameRecord[] = []
  const gList = block('gameHistory', raw.gameHistory, 'games', 20)
  if (gList) {
    const seen = new Set<string>()
    gList.forEach((g, i) => {
      const p = `$.gameHistory.games[${i}]`
      for (const key of Object.keys(g)) if (!['gameId', 'plays', 'completedPlays', 'lastPlayedAt'].includes(key)) issues.push({ path: `${p}.${key}`, message: '未知字段' })
      const id = g.gameId
      if (typeof id !== 'string' || !games.has(id)) { issues.push({ path: `${p}.gameId`, message: '不是可信目录中的游戏 id' }); return }
      if (seen.has(id)) { issues.push({ path: `${p}.gameId`, message: '重复游戏，请先聚合' }); return }
      seen.add(id)
      const plays = g.plays
      if (!(typeof plays === 'number' && Number.isInteger(plays) && plays >= 1 && plays <= 100_000)) { issues.push({ path: `${p}.plays`, message: '必须为 >= 1 的整数' }); return }
      if (!nullableNumber(g.completedPlays, 0, plays, true)) issues.push({ path: `${p}.completedPlays`, message: '必须为 0..plays 的整数或 null' })
      if (!time(g.lastPlayedAt)) issues.push({ path: `${p}.lastPlayedAt`, message: '必须为不晚于 now 的 epoch 毫秒或 null' })
      gameRecords.push({ gameId: id, plays, completedPlays: nn(g.completedPlays as number | null | undefined), lastDaysAgo: daysAgo(g.lastPlayedAt as number | null | undefined) })
    })
    if (gameRecords.length) sources.gameHistory = (raw.gameHistory as { origin: CoachDecisionDataOrigin }).origin
  }

  const findings: StateFinding[] = []
  let reportDays: number | null = null
  const rList = block('latestReport', raw.latestReport, 'findings', 50)
  if (rList) {
    const report = raw.latestReport as Record<string, unknown>
    if (!time(report.createdAt)) issues.push({ path: '$.latestReport.createdAt', message: '必须为不晚于 now 的 epoch 毫秒或 null' })
    else reportDays = daysAgo(report.createdAt as number | null | undefined)
    rList.forEach((f, i) => {
      const p = `$.latestReport.findings[${i}]`
      for (const key of Object.keys(f)) if (!['focus', 'subjectId', 'score', 'trend'].includes(key)) issues.push({ path: `${p}.${key}`, message: '未知字段' })
      if (!['reach', 'stability', 'coordination', 'rhythm'].includes(f.focus as string)) { issues.push({ path: `${p}.focus`, message: '必须为 reach / stability / coordination / rhythm' }); return }
      if (typeof f.subjectId !== 'string' || !byId.has(f.subjectId)) { issues.push({ path: `${p}.subjectId`, message: '不是可信目录中的章节 / 功法 / 游戏 id' }); return }
      if (!nullableNumber(f.score, 0, 100)) issues.push({ path: `${p}.score`, message: '必须为 0..100 或 null' })
      if (!(f.trend === undefined || f.trend === null || ['worse', 'same', 'better'].includes(f.trend as string))) issues.push({ path: `${p}.trend`, message: '必须为 worse / same / better / null' })
      findings.push({ focus: f.focus as StateFinding['focus'], subjectId: f.subjectId, score: nn(f.score as number | null | undefined), trend: nn(f.trend as StateFinding['trend'] | undefined) })
    })
    if (findings.length) sources.latestReport = report.origin as CoachDecisionDataOrigin
  }

  let availability: CatalogueAvailability | null = null
  let availabilityValid = true
  if (raw.availability !== undefined && raw.availability !== null) {
    const a = raw.availability
    const known = new Set(catalogue.flatMap(e => [e.id, ...(e.programId ? [e.programId] : [])]))
    if (!obj(a) || typeof a.snapshotRef !== 'string' || !a.snapshotRef || !Array.isArray(a.unavailableIds) || !a.unavailableIds.every(id => typeof id === 'string' && known.has(id))
      || Object.keys(a).some(k => !['snapshotRef', 'unavailableIds'].includes(k))) availabilityValid = false
    else availability = { snapshotRef: a.snapshotRef, unavailableIds: [...(a.unavailableIds as string[])] }
  }

  const origin: DataOriginTag = origins.includes('synthetic_demo') ? 'synthetic_fixture' : 'live_reader'
  const evidenceSource = origin === 'live_reader' ? 'live' as const : 'synthetic' as const
  const history: DecisionState['history'] = routines.length || gameRecords.length
    ? { status: 'present', origin, sessionsLast28d: null, routines, games: gameRecords } : { status: 'missing' }
  const report: DecisionState['report'] = findings.length ? { status: 'present', origin, daysAgo: reportDays, findings } : { status: 'missing' }

  // Evidence for the stage-1 retrieval baselines, built exactly like the training scenarios (scripts/decision-model/cdm/evidence.ts).
  const evidence: CoachEvidence[] = []
  for (const r of routines) {
    evidence.push({ id: `input:training:${r.chapterId}`, category: 'training', source: evidenceSource, title: `训练历史：${byId.get(r.chapterId)?.title ?? r.chapterId}`,
      detail: `${r.sessions} 次${r.meanScore === null ? '' : `，均分 ${r.meanScore}`}（${origin === 'live_reader' ? '本机记录' : '合成演示'}）`, focuses: SUBJECT_FOCUS[r.programId] ?? ['general'],
      contentId: r.chapterId, occurredAt: now - (r.lastDaysAgo ?? 0) * DAY_MS, references: [`input:trainingHistory:${r.chapterId}`] })
  }
  for (const g of gameRecords) {
    evidence.push({ id: `input:game:${g.gameId}`, category: 'game', source: evidenceSource, title: `游戏记录：${byId.get(g.gameId)?.title ?? g.gameId}`,
      detail: `${g.plays} 局`, focuses: byId.get(g.gameId)?.focuses ?? ['general'], contentId: g.gameId, occurredAt: now - (g.lastDaysAgo ?? 0) * DAY_MS, references: [`input:gameHistory:${g.gameId}`] })
  }
  findings.forEach((f, index) => {
    evidence.push({ id: `input:report:${index}`, category: 'report', source: evidenceSource, title: `最近报告：${byId.get(f.subjectId)?.title ?? f.subjectId}`,
      detail: `分项 ${f.score ?? '未记录'}/100，趋势 ${f.trend ?? '未记录'}`, focuses: [f.focus], contentId: f.subjectId, occurredAt: now - (reportDays ?? 0) * DAY_MS, references: [`input:latestReport:${index}`] })
  })
  return { envelopeOk: true, profile: raw.profile, now, state: { history, report }, evidence, availability, availabilityValid, issues, dataSources: sources }
}
