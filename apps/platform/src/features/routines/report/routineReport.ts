import { buildRoutineTechniqueReport, type RoutineTechniqueReport } from '../../scoring/routine/techniqueReport'
import { buildRoutineAnalysisReport } from '../analyzers/registry'
import type { AnalyzerReportMetrics } from '../analyzers/types'
import type { FollowAlongRegion } from '../followAlong/matcher'
import { findRoutineProgram } from '../programs'
import { chapterDisplayName, scopeChapters } from '../scope'
import type { RoutineChapterResult, RoutineSessionRecord } from '../session/types'
import type { RoutineChapter, RoutineProgram, RoutineScope } from '../types'

/** 跟练报告：只用跟练相关指标（完成度、与标准视频的相似度、节奏、身体部位），不用智能训练的次数评分 */
export const ROUTINE_REPORT_CONFIG = Object.freeze({
  /** 10 Hz 比对约 2 秒 */
  minSamplesPerChapter: 20,
  chapterCoveredRatio: 0.8,
  /** 两次都至少跟练了一半才比较 */
  comparableCoverage: 0.5,
  similarityDeadband: 3,
  syncDeadband: 5,
  tempoIssueShare: 0.3,
  focusRegionBelow: 70,
  mirroredNoteShare: 0.5,
})

export type SimilarityBand = 'high' | 'fair' | 'low'
export type TempoTendency = 'ahead' | 'behind'
export type DeltaTrend = 'up' | 'down' | 'flat'

export const SIMILARITY_BAND_LABEL: Readonly<Record<SimilarityBand, string>> = Object.freeze({
  high: '高度一致',
  fair: '基本一致',
  low: '差异较大',
})

export const REGION_LABEL: Readonly<Record<FollowAlongRegion, string>> = Object.freeze({
  arms: '上肢',
  torso: '躯干',
  legs: '下肢',
})

export interface RoutineChapterReport {
  chapter: RoutineChapter
  coverage: number
  covered: boolean
  samples: number
  enoughData: boolean
  similarity: number | null
  band: SimilarityBand | null
  syncShare: number | null
  tempo: TempoTendency | null
  regions: Record<FollowAlongRegion, number | null>
}

export interface RoutineComparison {
  available: boolean
  reason: string | null
  previousId: string | null
  previousStartedAt: number | null
  similarityDelta: number | null
  similarityTrend: DeltaTrend | null
  syncDelta: number | null
  syncTrend: DeltaTrend | null
}

/** 一条“下次练习重点”：原有句子及其数值、原因和练习目标 */
export interface RoutineFocusItem {
  kind: 'chapter' | 'region' | 'tempo' | 'coverage' | 'steady'
  text: string
  title: string
  /** 下次怎么做；章节项用该章节自身的动作要领 */
  detail: string
  value: string | null
  reason: string | null
  /** 可单独练习的式 */
  chapterId: string | null
}

export interface RoutineReport {
  record: RoutineSessionRecord
  program: RoutineProgram
  scope: RoutineScope
  chapters: RoutineChapterReport[]
  complete: boolean
  coverage: number
  coveredSeconds: number
  totalSeconds: number
  similarity: number | null
  band: SimilarityBand | null
  syncShare: number | null
  tempo: TempoTendency | null
  regions: Record<FollowAlongRegion, number | null>
  weakestChapter: RoutineChapterReport | null
  strongestChapter: RoutineChapterReport | null
  weakestRegion: FollowAlongRegion | null
  focus: string[]
  focusItems: RoutineFocusItem[]
  comparison: RoutineComparison
  notes: string[]
  headline: string
  /** 动作规范评价，与跟练相似度分开，不合成一个分数 */
  technique: RoutineTechniqueReport
  /** 本功法分析器的专项分析；没有分析记录时为 null */
  analysis: AnalyzerReportMetrics | null
}

const REGIONS: ReadonlyArray<FollowAlongRegion> = ['arms', 'torso', 'legs']

export function similarityBand(similarity: number): SimilarityBand {
  return similarity >= 80 ? 'high' : similarity >= 60 ? 'fair' : 'low'
}

function percent(value: number): number {
  return Math.round(value * 100)
}

function countedSamples(result: Pick<RoutineChapterResult, 'statusCounts'>): number {
  const counts = result.statusCounts
  return counts.in_sync + counts.ahead + counts.behind + counts.mismatch
}

function tempoOf(counts: RoutineChapterResult['statusCounts']): TempoTendency | null {
  const total = counts.in_sync + counts.ahead + counts.behind + counts.mismatch
  if (!total) return null
  const threshold = ROUTINE_REPORT_CONFIG.tempoIssueShare
  if (counts.behind / total >= threshold && counts.behind >= counts.ahead) return 'behind'
  if (counts.ahead / total >= threshold) return 'ahead'
  return null
}

function chapterReport(chapter: RoutineChapter, result: RoutineChapterResult | undefined): RoutineChapterReport {
  const totalSeconds = result?.totalSeconds ?? 0
  const coverage = result && totalSeconds > 0 ? Math.min(1, result.coveredSeconds / totalSeconds) : 0
  const samples = result?.samples ?? 0
  const enoughData = samples >= ROUTINE_REPORT_CONFIG.minSamplesPerChapter
  const similarity = result && enoughData ? percent(result.similaritySum / result.samples) : null
  const counted = result ? countedSamples(result) : 0
  return {
    chapter,
    coverage,
    covered: coverage >= ROUTINE_REPORT_CONFIG.chapterCoveredRatio,
    samples,
    enoughData,
    similarity,
    band: similarity === null ? null : similarityBand(similarity),
    syncShare: result && enoughData && counted ? percent(result.statusCounts.in_sync / counted) : null,
    tempo: result && enoughData ? tempoOf(result.statusCounts) : null,
    regions: Object.fromEntries(REGIONS.map((region) => [
      region,
      result && enoughData && result.regionSamples[region] >= ROUTINE_REPORT_CONFIG.minSamplesPerChapter
        ? percent(result.regionSums[region] / result.regionSamples[region])
        : null,
    ])) as Record<FollowAlongRegion, number | null>,
  }
}

interface Totals {
  coveredSeconds: number
  totalSeconds: number
  samples: number
  similaritySum: number
  statusCounts: RoutineChapterResult['statusCounts']
  regionSums: Record<FollowAlongRegion, number>
  regionSamples: Record<FollowAlongRegion, number>
  mirroredSamples: number
}

function totalsOf(results: ReadonlyArray<RoutineChapterResult>, reports: ReadonlyArray<RoutineChapterReport>): Totals {
  const usable = new Set(reports.filter((item) => item.enoughData).map((item) => item.chapter.id))
  const totals: Totals = {
    coveredSeconds: 0,
    totalSeconds: 0,
    samples: 0,
    similaritySum: 0,
    statusCounts: { in_sync: 0, ahead: 0, behind: 0, mismatch: 0 },
    regionSums: { arms: 0, torso: 0, legs: 0 },
    regionSamples: { arms: 0, torso: 0, legs: 0 },
    mirroredSamples: 0,
  }
  for (const result of results) {
    totals.coveredSeconds += Math.min(result.coveredSeconds, result.totalSeconds)
    totals.totalSeconds += result.totalSeconds
    // 数据太少的章节不计入整体平均
    if (!usable.has(result.chapterId)) continue
    totals.samples += result.samples
    totals.similaritySum += result.similaritySum
    totals.mirroredSamples += result.mirroredSamples
    for (const key of ['in_sync', 'ahead', 'behind', 'mismatch'] as const) totals.statusCounts[key] += result.statusCounts[key]
    for (const region of REGIONS) {
      totals.regionSums[region] += result.regionSums[region]
      totals.regionSamples[region] += result.regionSamples[region]
    }
  }
  return totals
}

interface SessionSummary {
  coverage: number
  similarity: number | null
  syncShare: number | null
}

function summarize(record: RoutineSessionRecord, program: RoutineProgram): SessionSummary {
  const chapters = scopeChapters(program, record.scope)
  const results = new Map(record.chapters.map((item) => [item.chapterId, item]))
  const reports = chapters.map((chapter) => chapterReport(chapter, results.get(chapter.id)))
  const totals = totalsOf(chapters.map((chapter) => results.get(chapter.id)).filter((item): item is RoutineChapterResult => Boolean(item)), reports)
  const counted = countedSamples(totals)
  return {
    coverage: totals.totalSeconds ? totals.coveredSeconds / totals.totalSeconds : 0,
    similarity: totals.samples ? percent(totals.similaritySum / totals.samples) : null,
    syncShare: counted ? percent(totals.statusCounts.in_sync / counted) : null,
  }
}

function sameScope(left: RoutineScope, right: RoutineScope): boolean {
  return left.kind === right.kind && (left.kind === 'full' || (right.kind === 'form' && left.chapterId === right.chapterId))
}

export function isReliableRoutineSession(record: RoutineSessionRecord): boolean {
  return record.source === 'live' && record.mode === 'normal' && record.outcome !== 'in_progress' && record.matcher.available
}

function trend(delta: number, deadband: number): DeltaTrend {
  return delta >= deadband ? 'up' : delta <= -deadband ? 'down' : 'flat'
}

const NO_COMPARISON = { previousId: null, previousStartedAt: null, similarityDelta: null, similarityTrend: null, syncDelta: null, syncTrend: null }

export function compareWithPrevious(record: RoutineSessionRecord, program: RoutineProgram, history: readonly RoutineSessionRecord[]): RoutineComparison {
  const current = summarize(record, program)
  if (!isReliableRoutineSession(record)) {
    return { available: false, reason: '本次记录不参与历史对比（测试记录、未结束或缺少比对数据）。', ...NO_COMPARISON }
  }
  if (current.coverage < ROUTINE_REPORT_CONFIG.comparableCoverage || current.similarity === null) {
    return { available: false, reason: '本次跟练时长不足一半，暂不与历史对比。', ...NO_COMPARISON }
  }
  const previous = history
    .filter((item) => item.id !== record.id
      && item.programId === record.programId
      && item.programVersion === record.programVersion
      && sameScope(item.scope, record.scope)
      && isReliableRoutineSession(item)
      && (item.startedAt < record.startedAt || (item.startedAt === record.startedAt && item.id < record.id)))
    .map((item) => ({ item, summary: summarize(item, program) }))
    .filter(({ summary }) => summary.coverage >= ROUTINE_REPORT_CONFIG.comparableCoverage && summary.similarity !== null)
    .sort((left, right) => right.item.startedAt - left.item.startedAt || (left.item.id < right.item.id ? 1 : -1))[0]
  if (!previous) return { available: false, reason: '这是同一练习范围内第一条可对比的记录。', ...NO_COMPARISON }
  const similarityDelta = (current.similarity as number) - (previous.summary.similarity as number)
  const syncDelta = current.syncShare !== null && previous.summary.syncShare !== null ? current.syncShare - previous.summary.syncShare : null
  return {
    available: true,
    reason: null,
    previousId: previous.item.id,
    previousStartedAt: previous.item.startedAt,
    similarityDelta,
    similarityTrend: trend(similarityDelta, ROUTINE_REPORT_CONFIG.similarityDeadband),
    syncDelta,
    syncTrend: syncDelta === null ? null : trend(syncDelta, ROUTINE_REPORT_CONFIG.syncDeadband),
  }
}

function focusItems(report: Omit<RoutineReport, 'focus' | 'focusItems' | 'notes' | 'headline' | 'comparison' | 'technique' | 'analysis'>, program: RoutineProgram): RoutineFocusItem[] {
  const items: RoutineFocusItem[] = []
  const weakest = report.weakestChapter
  if (weakest && weakest.similarity !== null && report.similarity !== null && weakest.band !== 'high'
    && weakest.similarity <= report.similarity - 5) {
    const single = weakest.chapter.kind === 'form' ? `，可以在「${program.title}」页单独练习这一${program.formUnit}` : ''
    items.push({
      kind: 'chapter',
      text: `重点复习「${chapterDisplayName(weakest.chapter)}」：跟练相似度 ${weakest.similarity}%，低于本次平均${single}。`,
      title: `重点复习「${chapterDisplayName(weakest.chapter)}」`,
      detail: `动作要点：${weakest.chapter.cue}。`,
      value: `相似度 ${weakest.similarity}%`,
      reason: `本次各段中相似度最低，比全程平均（${report.similarity}%）低 ${report.similarity - weakest.similarity} 个百分点。`,
      chapterId: weakest.chapter.kind === 'form' ? weakest.chapter.id : null,
    })
  }
  const region = report.weakestRegion
  if (region && (report.regions[region] ?? 100) < ROUTINE_REPORT_CONFIG.focusRegionBelow) {
    items.push({
      kind: 'region',
      text: `注意${REGION_LABEL[region]}动作：该部位与示范差异最大（${report.regions[region]}%），对照视频调整幅度与方向。`,
      title: `注意${REGION_LABEL[region]}动作`,
      detail: `对照视频调整${REGION_LABEL[region]}动作的幅度与方向。`,
      value: `${REGION_LABEL[region]} ${report.regions[region]}%`,
      reason: `上肢、躯干、下肢中与示范差异最大，且低于 ${ROUTINE_REPORT_CONFIG.focusRegionBelow}%。`,
      chapterId: null,
    })
  }
  const sync = report.syncShare === null ? null : `节奏同步 ${report.syncShare}%`
  if (report.tempo === 'behind') items.push({ kind: 'tempo', text: '节奏常慢于视频：留意口令提示，动作与视频同步起落。', title: '跟上视频节奏', detail: '留意口令提示，动作与视频同步起落。', value: sync, reason: '跟练中较多时间慢于视频。', chapterId: null })
  if (report.tempo === 'ahead') items.push({ kind: 'tempo', text: '节奏常快于视频：放慢动作，跟随口令完成每个定势。', title: '放慢动作节奏', detail: '放慢动作，跟随口令完成每个定势。', value: sync, reason: '跟练中较多时间快于视频。', chapterId: null })
  if (report.coverage < 0.9 && report.chapters.length > 1) {
    items.push({ kind: 'coverage', text: '有部分段落没有完整跟练，下次尽量从头到尾连续完成。', title: '完整跟练全套', detail: '下次尽量从头到尾连续完成。', value: `完成 ${percent(report.coverage)}%`, reason: '有部分段落没有完整跟练。', chapterId: null })
  }
  if (!items.length && report.similarity !== null) {
    items.push({ kind: 'steady', text: '整体跟练稳定，下次保持节奏，尝试把每个定势做得更舒展到位。', title: '保持稳定，做得更舒展', detail: '下次保持节奏，尝试把每个定势做得更舒展到位。', value: `相似度 ${report.similarity}%`, reason: '本次没有明显低于平均的段落或部位。', chapterId: null })
  }
  return items.slice(0, 3)
}

export function buildRoutineReport(record: RoutineSessionRecord, history: readonly RoutineSessionRecord[] = []): RoutineReport | undefined {
  const program = findRoutineProgram(record.programId)
  if (!program) return undefined
  const chapters = scopeChapters(program, record.scope)
  const results = new Map(record.chapters.map((item) => [item.chapterId, item]))
  const chapterReports = chapters.map((chapter) => chapterReport(chapter, results.get(chapter.id)))
  const totals = totalsOf(chapters.map((chapter) => results.get(chapter.id)).filter((item): item is RoutineChapterResult => Boolean(item)), chapterReports)
  const counted = countedSamples(totals)
  const similarity = totals.samples ? percent(totals.similaritySum / totals.samples) : null
  const regions = Object.fromEntries(REGIONS.map((region) => [
    region,
    totals.regionSamples[region] ? percent(totals.regionSums[region] / totals.regionSamples[region]) : null,
  ])) as Record<FollowAlongRegion, number | null>
  const withData = chapterReports.filter((item) => item.similarity !== null)
  const byScore = [...withData].sort((left, right) => (left.similarity as number) - (right.similarity as number) || left.chapter.index - right.chapter.index)
  const regionWithData = REGIONS.filter((region) => regions[region] !== null)
  const weakestRegion = regionWithData.length
    ? regionWithData.reduce((lowest, region) => (regions[region] as number) < (regions[lowest] as number) ? region : lowest)
    : null
  const base = {
    record,
    program,
    scope: record.scope,
    chapters: chapterReports,
    complete: record.outcome === 'completed',
    coverage: totals.totalSeconds ? totals.coveredSeconds / totals.totalSeconds : 0,
    coveredSeconds: totals.coveredSeconds,
    totalSeconds: totals.totalSeconds,
    similarity,
    band: similarity === null ? null : similarityBand(similarity),
    syncShare: counted ? percent(totals.statusCounts.in_sync / counted) : null,
    tempo: tempoOf(totals.statusCounts),
    regions,
    weakestChapter: byScore.length > 1 ? byScore[0] : null,
    strongestChapter: byScore.length > 1 ? byScore[byScore.length - 1] : null,
    weakestRegion,
  }

  const notes: string[] = []
  if (!record.matcher.available) notes.push('本次没有加载到标准动作姿态数据，只记录了跟练完成度。')
  if (record.source !== 'live' || record.mode !== 'normal') notes.push('这条记录来自测试模式，不参与历史对比。')
  const thin = chapterReports.filter((item) => item.coverage > 0 && !item.enoughData).length
  if (thin) notes.push(`有 ${thin} 段识别数据不足（例如身体未完整入镜），这些段落不计算相似度。`)
  if (totals.samples && totals.mirroredSamples / totals.samples >= ROUTINE_REPORT_CONFIG.mirroredNoteShare) {
    notes.push('你多数时间以镜像方式跟练（与示范左右相反），系统已按镜像比对，不影响结果。')
  }
  notes.push('动作规范评价按官方动作要求逐项检查关键阶段的关节角度与位置，与跟练相似度分开计算，两者不合成一个分数。')
  notes.push('跟练相似度比较你与标准视频在同一时刻的身体姿态，只反映二维姿态，不评估呼吸、手型与眼神。')

  const coverageText = base.complete && base.coverage >= 0.9 ? '完整跟练' : `跟练完成 ${percent(base.coverage)}%`
  const headline = similarity === null
    ? `${coverageText} · 暂无跟练相似度`
    : `${coverageText} · 跟练相似度 ${similarity}%（${SIMILARITY_BAND_LABEL[similarityBand(similarity)]}）`
  const structuredFocus = focusItems(base, program)
  return {
    ...base,
    focus: structuredFocus.map((item) => item.text),
    focusItems: structuredFocus,
    comparison: compareWithPrevious(record, program, history),
    notes,
    headline,
    technique: buildRoutineTechniqueReport(program, record.scope, record.technique, record.matcher.available),
    analysis: buildRoutineAnalysisReport(program, record.scope, record.analysis),
  }
}
