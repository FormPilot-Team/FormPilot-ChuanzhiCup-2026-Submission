import { isRoutineAnalysisRecord } from '../routines/analyzers/analysisRecord'
import { createRoutineAnalyzer } from '../routines/analyzers/registry'
import { FOLLOW_ALONG_CONFIG } from '../routines/followAlong/matcher'
import { findRoutineProgram } from '../routines/programs'
import { buildRoutineReport } from '../routines/report/routineReport'
import { scopeChapters } from '../routines/scope'
import type { RoutineChapterResult, RoutineSessionRecord } from '../routines/session/types'
import type { RoutineProgram } from '../routines/types'
import { criteriaFor, findCriterion } from '../scoring/criteria'
import { TECHNIQUE_CONFIG } from '../scoring/routine/RoutineTechniqueEvaluator'
import type { RoutineTechniqueRecord } from '../scoring/routine/techniqueRecord'
import { SCORING_VERSION, type EvaluationCriterion } from '../scoring/types'
import type { DataProvenance, ScoringEvidence, TrainingSessionSummary } from './contracts'
import { ReaderFault, type EvidenceDetail, type MappedSession } from './readerTypes'
import { validateTrainingSessionSummary } from './validation'

type JsonRecord = Record<string, unknown>
const MAX_EPOCH = 8_640_000_000_000_000
const REGIONS = ['arms', 'torso', 'legs'] as const
const STATUSES = ['in_sync', 'ahead', 'behind', 'mismatch'] as const

function corrupt(path: string, message: string): never { throw new ReaderFault('CORRUPT', path, message) }
function object(value: unknown, path: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) corrupt(path, 'Expected a record.')
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) corrupt(path, 'Expected ordinary stored JSON.')
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) corrupt(path, 'Expected JSON data properties.')
  }
  return value as JsonRecord
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 128 || value.trim() !== value || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) corrupt(path, 'Invalid identifier or version.')
  return value
}
function numeric(value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum || (integer && !Number.isSafeInteger(value))) corrupt(path, 'Invalid nonnegative finite number.')
  return value
}
function array(value: unknown, path: string, maximum = 128): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) corrupt(path, 'Invalid or oversized JSON array.')
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) corrupt(`${path}[${index}]`, 'Expected JSON array data.')
  }
  return value as unknown[]
}
function version(value: unknown, expected: string | number, path: string): void {
  if (value !== expected) throw new ReaderFault('UNSUPPORTED_VERSION', path, 'Stored version is not supported by this reader.')
}
function programFor(id: unknown): RoutineProgram {
  const program = findRoutineProgram(text(id, '$.programId'))
  if (!program) corrupt('$.programId', 'Unknown routine program.')
  return program
}

function chapterResult(value: unknown, chapterId: string, duration: number, path: string): RoutineChapterResult {
  const v = object(value, path)
  if (v.chapterId !== chapterId) corrupt(`${path}.chapterId`, 'Chapter does not belong to the saved scope.')
  const totalSeconds = numeric(v.totalSeconds, `${path}.totalSeconds`, Math.ceil(duration), true)
  // The recorder counts integer-second midpoints; chapter boundaries can fall on half seconds.
  if (Math.abs(totalSeconds - duration) > 1) corrupt(`${path}.totalSeconds`, 'Chapter duration does not match the versioned catalogue.')
  const samples = numeric(v.samples, `${path}.samples`, Number.MAX_SAFE_INTEGER, true)
  const regionSums = object(v.regionSums, `${path}.regionSums`)
  const regionSamples = object(v.regionSamples, `${path}.regionSamples`)
  const statusCounts = object(v.statusCounts, `${path}.statusCounts`)
  const regions = Object.fromEntries(REGIONS.map(region => [region, numeric(regionSamples[region], `${path}.regionSamples.${region}`, samples, true)])) as RoutineChapterResult['regionSamples']
  const sums = Object.fromEntries(REGIONS.map(region => [region, numeric(regionSums[region], `${path}.regionSums.${region}`, regions[region] + Number.EPSILON * Math.max(1, regions[region]))])) as RoutineChapterResult['regionSums']
  const counts = Object.fromEntries(STATUSES.map(status => [status, numeric(statusCounts[status], `${path}.statusCounts.${status}`, samples, true)])) as RoutineChapterResult['statusCounts']
  if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== samples) corrupt(`${path}.statusCounts`, 'Status counts do not match the saved sample count.')
  return {
    chapterId, totalSeconds, samples,
    coveredSeconds: numeric(v.coveredSeconds, `${path}.coveredSeconds`, totalSeconds, true),
    insufficientSamples: numeric(v.insufficientSamples, `${path}.insufficientSamples`, Number.MAX_SAFE_INTEGER, true),
    similaritySum: numeric(v.similaritySum, `${path}.similaritySum`, samples + Number.EPSILON * Math.max(1, samples)),
    mirroredSamples: numeric(v.mirroredSamples, `${path}.mirroredSamples`, samples, true),
    regionSums: sums, regionSamples: regions, statusCounts: counts,
  }
}

function techniqueRecord(value: unknown, program: RoutineProgram, chapterIds: Set<string>): RoutineTechniqueRecord {
  const v = object(value, '$.technique')
  version(v.version, SCORING_VERSION, '$.technique.version')
  const seen = new Set<string>()
  let windowCount = 0
  const criteria = array(v.criteria, '$.technique.criteria').map((entry, index) => {
    const path = `$.technique.criteria[${index}]`
    const item = object(entry, path)
    const criterionId = text(item.criterionId, `${path}.criterionId`)
    const chapterId = text(item.chapterId, `${path}.chapterId`)
    const criterion = findCriterion(criterionId)
    const chapter = program.chapters.find(candidate => candidate.id === chapterId)
    if (!criterion || criterion.mode !== program.id || (criterion.exercise !== '*' && criterion.exercise !== chapterId)
      || criterion.measurement.kind !== 'pose-window' || criterion.scoring === 'REFERENCE_ONLY' || !chapter || !chapterIds.has(chapterId)) {
      corrupt(path, 'Technique criterion reference does not resolve to this routine and chapter.')
    }
    const key = `${criterionId}@${chapterId}`
    if (seen.has(key)) corrupt(path, 'Duplicate technique criterion/chapter reference.')
    seen.add(key)
    let previousEnd = -Infinity
    const windows = array(item.windows, `${path}.windows`, 256).map((entryWindow, windowIndex) => {
      const windowPath = `${path}.windows[${windowIndex}]`
      const window = object(entryWindow, windowPath)
      const start = numeric(window.start, `${windowPath}.start`, program.video.durationSeconds)
      const end = numeric(window.end, `${windowPath}.end`, program.video.durationSeconds)
      // Evaluator snapshots round phase boundaries to 0.1 s.
      if (end <= start || start < chapter.startSeconds - 0.05 || end > chapter.endSeconds + 0.05) corrupt(windowPath, 'Technique window is outside its video chapter.')
      if (start < previousEnd) corrupt(windowPath, 'Duplicate, overlapping or out-of-order windows cannot establish separate observations for one criterion.')
      previousEnd = end
      const samples = numeric(window.samples, `${windowPath}.samples`, Number.MAX_SAFE_INTEGER, true)
      if (window.value !== null && (typeof window.value !== 'number' || !Number.isFinite(window.value) || Math.abs(window.value) > Number.MAX_SAFE_INTEGER)) corrupt(`${windowPath}.value`, 'Invalid saved observation.')
      const measured = window.value as number | null
      const score = window.score === null ? null : numeric(window.score, `${windowPath}.score`, 100)
      if ((measured === null) !== (score === null) || (score !== null && samples < TECHNIQUE_CONFIG.minSamples)) corrupt(windowPath, 'Technique score does not have sufficient saved observations.')
      windowCount += 1
      if (windowCount > 256) throw new ReaderFault('INSUFFICIENT_DATA', '$.technique', 'Saved evidence exceeds the Phase 1A transport capacity; no evidence was truncated.')
      return { start, end, samples, value: measured, score }
    })
    return { criterionId, chapterId, windows }
  })
  return { version: SCORING_VERSION, criteria }
}

/** A safe domain view. Missing legacy source/mode remain absent at runtime, never live/normal. */
export function validateRoutineRecord(raw: unknown): RoutineSessionRecord {
  const v = object(raw, '$')
  version(v.schemaVersion, 1, '$.schemaVersion')
  if (v.kind !== 'routine') corrupt('$.kind', 'Expected a routine session.')
  const program = programFor(v.programId)
  version(v.programVersion, program.version, '$.programVersion')
  const id = text(v.id, '$.id')
  if (v.source !== undefined && v.source !== 'live' && v.source !== 'synthetic') corrupt('$.source', 'Invalid routine source.')
  if (v.mode !== undefined && v.mode !== 'normal' && v.mode !== 'fast') corrupt('$.mode', 'Invalid routine mode.')
  const scope = object(v.scope, '$.scope')
  if (scope.kind !== 'full' && scope.kind !== 'form') corrupt('$.scope.kind', 'Invalid routine scope.')
  if (scope.kind === 'form' && !program.chapters.some(chapter => chapter.kind === 'form' && chapter.id === scope.chapterId)) corrupt('$.scope.chapterId', 'Unknown form chapter.')
  const domainScope = scope.kind === 'full' ? { kind: 'full' as const } : { kind: 'form' as const, chapterId: text(scope.chapterId, '$.scope.chapterId') }
  const matcher = object(v.matcher, '$.matcher')
  version(matcher.version, FOLLOW_ALONG_CONFIG.version, '$.matcher.version')
  if (typeof matcher.available !== 'boolean') corrupt('$.matcher.available', 'Invalid matcher availability.')
  const startedAt = numeric(v.startedAt, '$.startedAt', MAX_EPOCH, true)
  const endedAt = v.endedAt === undefined ? undefined : numeric(v.endedAt, '$.endedAt', MAX_EPOCH, true)
  if (!['in_progress', 'completed', 'incomplete'].includes(v.outcome as string)) corrupt('$.outcome', 'Unknown session outcome.')
  if ((v.outcome === 'in_progress') !== (endedAt === undefined) || (endedAt !== undefined && endedAt < startedAt)) corrupt('$.endedAt', 'Session outcome and epoch times are inconsistent.')
  const activeMs = numeric(v.activeMs, '$.activeMs')
  if (endedAt !== undefined && activeMs > endedAt - startedAt) corrupt('$.activeMs', 'Active time exceeds session wall time.')
  const scopeItems = scopeChapters(program, domainScope)
  const records = array(v.chapters, '$.chapters')
  const chapterIds = new Set<string>()
  const chapters = records.map((entry, index) => {
    const path = `$.chapters[${index}]`
    const item = object(entry, path)
    const chapterId = text(item.chapterId, `${path}.chapterId`)
    const chapter = scopeItems.find(candidate => candidate.id === chapterId)
    if (!chapter || chapterIds.has(chapterId)) corrupt(path, 'Unknown, out-of-scope or duplicate chapter.')
    chapterIds.add(chapterId)
    return chapterResult(item, chapterId, chapter.endSeconds - chapter.startSeconds, path)
  })
  if (chapterIds.size !== scopeItems.length) corrupt('$.chapters', 'Saved scope is missing chapter results; coverage cannot be trusted.')
  const technique = v.technique === undefined ? undefined : techniqueRecord(v.technique, program, chapterIds)
  if (!matcher.available && (chapters.some(chapter => chapter.samples > 0) || technique?.criteria.some(criterion => criterion.windows.some(window => window.samples > 0)))) corrupt('$.matcher', 'Observed evidence requires an available reference track.')
  if (v.analysis !== undefined) {
    // Optional analyzer data is never returned verbatim or used to recalculate scores.
    const analysis = object(v.analysis, '$.analysis')
    array(analysis.chapters, '$.analysis.chapters')
    if (!isRoutineAnalysisRecord(analysis)) corrupt('$.analysis', 'Invalid stored analyzer data.')
    const analyzer = createRoutineAnalyzer(program)
    if (!analyzer || analysis.analyzerId !== analyzer.id || analysis.version !== analyzer.version) throw new ReaderFault('UNSUPPORTED_VERSION', '$.analysis.version', 'Unsupported stored analyzer version.')
    const seenAnalysis = new Set<string>()
    analysis.chapters.forEach((chapter, index) => {
      const path = `$.analysis.chapters[${index}]`
      if (!chapterIds.has(chapter.chapterId) || seenAnalysis.has(chapter.chapterId)) corrupt(path, 'Invalid analyzer chapter reference.')
      seenAnalysis.add(chapter.chapterId)
      numeric(chapter.samples, `${path}.samples`, Number.MAX_SAFE_INTEGER, true)
      if (chapter.evaluation) {
        numeric(chapter.evaluation.usableSamples, `${path}.evaluation.usableSamples`, chapter.samples, true)
        if (chapter.evaluation.score !== null) numeric(chapter.evaluation.score, `${path}.evaluation.score`, 100)
        array(chapter.evaluation.metrics, `${path}.evaluation.metrics`, 64)
        for (const metric of chapter.evaluation.metrics) {
          if (metric.score !== null) numeric(metric.score, `${path}.evaluation.metrics.score`, 100)
          numeric(metric.weight, `${path}.evaluation.metrics.weight`)
        }
      }
    })
  }
  return {
    schemaVersion: 1, kind: 'routine', id, programId: program.id, programVersion: program.version,
    scope: domainScope, source: v.source as RoutineSessionRecord['source'], mode: v.mode as RoutineSessionRecord['mode'],
    matcher: { version: FOLLOW_ALONG_CONFIG.version, available: matcher.available },
    startedAt, ...(endedAt === undefined ? {} : { endedAt }), activeMs,
    outcome: v.outcome as RoutineSessionRecord['outcome'], chapters,
    ...(technique === undefined ? {} : { technique }),
  }
}

function criterionDetail(criterion: EvaluationCriterion): Record<string, unknown> {
  return {
    criterionId: criterion.id, phase: criterion.phase, requirement: criterion.requirement,
    scoringRole: criterion.scoring, sourceId: criterion.sourceId, sourceType: criterion.sourceType,
    additionalSourceIds: [...criterion.additionalSourceIds], evidenceLevel: criterion.evidenceLevel,
    observable: criterion.observable, thresholdSource: criterion.thresholdSource,
    thresholdBasis: criterion.thresholdBasis, target: criterion.target ? { ...criterion.target } : null,
  }
}

function evidenceId(sessionId: string, localRef: string): string {
  const full = `routine:${sessionId}:${localRef}`
  if (full.length <= 128) return full
  // Bounded reference only, not an authenticity certificate. Original ID remains intact in recordRef.
  let first = 2166136261
  let second = 5381
  for (let index = 0; index < sessionId.length; index += 1) {
    first = Math.imul(first ^ sessionId.charCodeAt(index), 16777619)
    second = Math.imul(second, 33) ^ sessionId.charCodeAt(index)
  }
  return `routine:${sessionId.slice(0, 64)}:${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}:${localRef}`
}

/** Pure read projection: persisted scores + existing report formatting, with no pose scoring or I/O. */
export function mapRoutineSession(raw: unknown, recordedAt: number): MappedSession {
  const record = validateRoutineRecord(raw)
  numeric(recordedAt, '$recordedAt', MAX_EPOCH, true)
  if (recordedAt < (record.endedAt ?? record.startedAt) || record.activeMs > recordedAt - record.startedAt) corrupt('$recordedAt', 'Trusted snapshot time precedes this training record.')
  const program = programFor(record.programId)
  const report = buildRoutineReport(record)
  if (!report) corrupt('$.programId', 'Routine report is unavailable.')
  const provenance: DataProvenance = { source: record.source ?? 'unknown', mode: record.mode ?? 'unknown', producer: 'repository' }
  const recordRef = { id: record.id, version: String(record.schemaVersion) }
  const clockId = `${record.programId}@${record.programVersion}`
  const evidence: ScoringEvidence[] = []
  const details: EvidenceDetail[] = []
  const limitations: string[] = ['ROUTINE_CHAPTER_AGGREGATES_HAVE_NO_PER_SAMPLE_TIMESTAMPS', 'NO_PERSISTED_CONFIRMED_ROUTINE_FEEDBACK_EVENTS']
  if (provenance.source === 'unknown' || provenance.mode === 'unknown') limitations.push('LEGACY_PROVENANCE_UNKNOWN')
  if (provenance.source !== 'live' || provenance.mode !== 'normal') limitations.push('NOT_ELIGIBLE_FOR_HUMAN_PROGRESS_CLAIMS')
  if (!record.technique) limitations.push('NO_SAVED_TECHNIQUE_EVIDENCE')
  else limitations.push('TECHNIQUE_SAMPLE_COUNTS_ARE_PER_WINDOW_NOT_DISTINCT_SESSION_SAMPLES')
  if (!record.matcher.available) limitations.push('REFERENCE_TRACK_UNAVAILABLE')
  const common = { schemaVersion: 1 as const, recordedAt: { domain: 'epoch-ms' as const, value: recordedAt }, provenance, confidence: null,
    sessionId: record.id, subject: { kind: 'routine' as const, id: record.programId }, recordRef }
  for (const [index, chapter] of record.chapters.entries()) {
    const formatted = report.chapters.find(item => item.chapter.id === chapter.chapterId)
    if (!formatted) corrupt(`$.chapters[${index}]`, 'Chapter report cannot be resolved.')
    const id = evidenceId(record.id, `similarity:${index}`)
    evidence.push({
      ...common, id,
      window: { start: { domain: 'video-seconds', clockId, value: formatted.chapter.startSeconds }, end: { domain: 'video-seconds', clockId, value: formatted.chapter.endSeconds } },
      score: formatted.similarity === null
        ? { scoreKind: 'follow-along-similarity', scale: '0-1', status: 'insufficient', value: null, scoringVersion: record.matcher.version, rulesVersion: null }
        : { scoreKind: 'follow-along-similarity', scale: '0-1', status: 'available', value: formatted.similarity / 100, scoringVersion: record.matcher.version, rulesVersion: null },
      quality: { sampleCount: chapter.samples, observability: 'PROXY', evidenceLevel: 'C' }, criterionIds: [],
    })
    details.push({ evidenceId: id, recordPaths: [`$.chapters[${index}]`, '$.matcher'], explanation: {
      chapterId: chapter.chapterId, windowBasis: 'catalogue-chapter-aggregate', matcherVersion: record.matcher.version,
      coverage: formatted.coverage, coveredSeconds: chapter.coveredSeconds, totalSeconds: chapter.totalSeconds,
      samples: chapter.samples, insufficientSamples: chapter.insufficientSamples, similaritySum: chapter.similaritySum,
      rhythm: { syncShare: formatted.syncShare, tempo: formatted.tempo, statusCounts: { ...chapter.statusCounts } },
      thresholdSource: 'FORMPILOT_CALIBRATED',
    } })
  }
  record.technique?.criteria.forEach((item, criterionIndex) => {
    const criterion = findCriterion(item.criterionId)
    if (!criterion) corrupt('$.technique', 'Criterion reference is unavailable.')
    item.windows.forEach((window, windowIndex) => {
      const id = evidenceId(record.id, `technique:${criterionIndex}:${windowIndex}`)
      evidence.push({ ...common, id,
        window: { start: { domain: 'video-seconds', clockId, value: window.start }, end: { domain: 'video-seconds', clockId, value: window.end } },
        score: window.score === null
          ? { scoreKind: 'routine-technique', scale: '0-100', status: 'insufficient', value: null, scoringVersion: record.technique?.version ?? null, rulesVersion: null }
          : { scoreKind: 'routine-technique', scale: '0-100', status: 'available', value: window.score, scoringVersion: record.technique?.version ?? SCORING_VERSION, rulesVersion: null },
        quality: { sampleCount: window.samples, observability: criterion.observable, evidenceLevel: criterion.evidenceLevel }, criterionIds: [item.criterionId],
      })
      details.push({ evidenceId: id, recordPaths: [`$.technique.criteria[${criterionIndex}].windows[${windowIndex}]`, `$.technique.criteria[${criterionIndex}].criterionId`, '$.technique.version'],
        explanation: { ...criterionDetail(criterion), chapterId: item.chapterId, occurrence: windowIndex + 1,
          observedValue: window.value, savedScore: window.score, samples: window.samples, windowBasis: 'saved-phase-window' } })
    })
  })
  if (evidence.length > 256) throw new ReaderFault('INSUFFICIENT_DATA', '$.technique', 'Evidence exceeds the unchanged Phase 1A transport capacity; nothing was truncated.')
  if (evidence.some(item => item.score.status === 'insufficient')) limitations.push('PARTIAL_OR_INSUFFICIENT_OBSERVATIONS')
  const summary: TrainingSessionSummary = {
    schemaVersion: 1, id: record.id, recordedAt: common.recordedAt, provenance, confidence: null,
    sessionId: record.id, recordRef, kind: 'routine', startedAt: { domain: 'epoch-ms', value: record.startedAt },
    endedAt: record.endedAt === undefined ? null : { domain: 'epoch-ms', value: record.endedAt },
    status: record.outcome === 'in_progress' ? 'active' : record.outcome, activeDurationMs: record.activeMs, completedReps: null, evidence,
  }
  const checked = validateTrainingSessionSummary(summary)
  if (!checked.ok) corrupt(checked.errors[0].path, checked.errors[0].message)
  const guidanceReferences = scopeChapters(program, record.scope).flatMap(chapter => criteriaFor(program.id, chapter.id)
    .filter(criterion => criterion.scoring === 'REFERENCE_ONLY')
    .map(criterion => ({ ...criterionDetail(criterion), chapterId: chapter.id, observed: false, scoreKind: 'guidance', value: null })))
  return { summary: checked.value, details, limitations, metadata: {
    programId: record.programId, programVersion: record.programVersion, scope: { ...record.scope },
    source: provenance.source, mode: provenance.mode, matcher: { ...record.matcher }, matcherVersion: record.matcher.version,
    techniqueVersion: record.technique?.version ?? null,
    technique: { available: report.technique.available, score: report.technique.score, reason: report.technique.reason },
    rhythm: { syncShare: report.syncShare, tempo: report.tempo },
    coverage: report.coverage, guidanceReferences,
  } }
}
