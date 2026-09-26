import { freeTrainingPath, reportPath, routineTrainingPath, customTrainingPath } from '../../app/routes'
import type { TrainingAnalysis } from '../analysis'
import { exerciseName } from '../analysis/copy'
import type { HistoryEntry } from '../history/historyEntries'
import { isTrainingIncomplete } from '../history/TrainingHistory'
import { REGION_LABEL, SIMILARITY_BAND_LABEL, type RoutineReport } from '../routines/report/routineReport'
import { chapterDisplayName, scopeTitle } from '../routines/scope'
import { freeTrainingLabel, resolveTrainingScope } from '../training/trainingScope'
import type { TrainingSessionState } from '../training/types'
import { REQUIREMENTS } from '../workshop/catalog'
import type { CustomActionReport } from '../workshop/report'
import type { ReportDigest } from './types'

const WARM_UP_TITLE = '热身训练 · 完整训练'

function ratio(stats: { affected: number; evaluable: number }, unit: string): string {
  return `${stats.evaluable} ${unit}中 ${stats.affected} ${unit}`
}

/** 热身训练: straight from analysis-v1 output (priority issues, next focus, comparison, strengths). */
export function warmUpDigest(analysis: TrainingAnalysis, session: TrainingSessionState): ReportDigest {
  const scope = resolveTrainingScope(session)
  const free = scope.kind === 'free_training' ? scope.exerciseId : null
  const top = analysis.priorityIssues[0]
  const focus = analysis.nextFocus[0]
  const trend = analysis.overall.trend
  const delta = analysis.overall.delta
  const comparable = analysis.comparison.level === 'FULL' && trend !== null && delta !== null
  const topMember = top ? [...top.members].sort((left, right) => right.stats.affected - left.stats.affected)[0] : undefined
  const scored = analysis.overall.scope === 'FULL_COURSE' || analysis.overall.scope === 'COMPLETED_EXERCISES'
  return {
    kind: 'warm-up',
    title: free ? freeTrainingLabel(free) : WARM_UP_TITLE,
    startedAt: analysis.sessionStartedAt,
    complete: !isTrainingIncomplete(session, analysis, scope),
    completionText: free
      ? `${exerciseName(free)}${analysis.exercises.find((item) => item.exerciseId === free)?.completion.status === 'completed' ? '已完成' : '未完成'}`
      : `完成 ${analysis.overall.completedExercises} / ${analysis.overall.totalExercises} 个动作`,
    result: scored && analysis.overall.score !== null
      ? { label: analysis.overall.scope === 'FULL_COURSE' ? '综合评分' : '已完成动作平均分', value: `${analysis.overall.score} 分` }
      : null,
    biggestIssue: top ? {
      title: top.kind === 'THEME' ? top.reportLabel : `${top.exerciseIds.map(exerciseName).join('、')} · ${top.reportLabel}`,
      detail: `${top.cue}。`,
      value: topMember ? ratio(topMember.stats, topMember.unit) : undefined,
    } : null,
    nextFocus: focus ? {
      title: focus.exerciseIds.length > 1 ? focus.cue : `${exerciseName(focus.exerciseIds[0])}：${focus.cue}`,
      detail: `${focus.cue}。`,
      target: focus.target?.text,
      href: focus.exerciseIds.length === 1 ? freeTrainingPath(focus.exerciseIds[0]) : undefined,
    } : null,
    comparison: comparable
      ? { text: trend === 'STABLE' ? '综合评分与上次基本持平' : trend === 'IMPROVED' ? `综合评分比上次提高 ${delta} 分` : `综合评分比上次降低 ${Math.abs(delta as number)} 分`, direction: trend === 'IMPROVED' ? 'up' : trend === 'DECLINED' ? 'down' : 'flat' }
      : null,
    comparisonReason: comparable ? null : analysis.comparison.level === 'PARTIAL'
      ? `只能和上次共同完成的 ${analysis.comparison.commonExerciseIds.length} 个动作对比，不比较综合评分。`
      : analysis.comparison.reasonText ?? '当前没有可以对比的历史记录。',
    strengths: analysis.strengths.slice(0, 2).map((finding) => finding.text),
    reportPath: reportPath(session.id),
  }
}

/** 跟练课程: the routine report's similarity, weakest chapter or region, focus items and comparison. */
export function routineDigest(report: RoutineReport): ReportDigest {
  const { record, program } = report
  const weakest = report.weakestChapter
  const region = report.weakestRegion
  const focus = report.focusItems[0]
  const comparison = report.comparison
  const strongest = report.strongestChapter
  const change = comparison.similarityDelta
  return {
    kind: 'routine',
    title: scopeTitle(program, record.scope),
    startedAt: record.startedAt,
    complete: report.complete,
    completionText: report.complete && report.coverage >= 0.9 ? '完整跟练了本次内容' : `跟练了 ${Math.round(report.coverage * 100)}% 的内容`,
    result: report.similarity === null ? null : { label: '跟练相似度', value: `${report.similarity}%（${SIMILARITY_BAND_LABEL[report.band as keyof typeof SIMILARITY_BAND_LABEL]}）` },
    biggestIssue: weakest && weakest.similarity !== null && weakest.band !== 'high'
      ? { title: chapterDisplayName(weakest.chapter), detail: `这一段与示范视频的一致度最低。`, value: `相似度 ${weakest.similarity}%` }
      : region && (report.regions[region] ?? 100) < 70
        ? { title: `${REGION_LABEL[region]}动作`, detail: '这个部位与示范视频的一致度最低。', value: `${report.regions[region]}%` }
        : null,
    nextFocus: focus ? { title: focus.title, detail: focus.detail, href: focus.chapterId ? routineTrainingPath(program.id, focus.chapterId) : undefined } : null,
    comparison: comparison.available && change !== null && comparison.similarityTrend !== null
      ? { text: comparison.similarityTrend === 'flat' ? '跟练相似度与上次基本持平' : change > 0 ? `跟练相似度比上次提高 ${change} 分` : `跟练相似度比上次降低 ${Math.abs(change)} 分`, direction: comparison.similarityTrend === 'up' ? 'up' : comparison.similarityTrend === 'down' ? 'down' : 'flat' }
      : null,
    comparisonReason: comparison.available ? null : comparison.reason,
    strengths: strongest && strongest.similarity !== null && strongest.band === 'high' ? [`「${chapterDisplayName(strongest.chapter)}」跟得最好，相似度 ${strongest.similarity}%。`] : [],
    reportPath: reportPath(record.id),
  }
}

/** 我的动作: completion and 识别重点 results only; the custom report has no score and the coach does not make one up. */
export function customDigest(report: CustomActionReport): ReportDigest {
  const { record, progress } = report
  const unit = record.goal.type === 'duration' ? '秒' : '次'
  const focus = report.focus[0]
  const comparison = report.comparison
  const worst = report.requirements.filter((row) => row.rate !== null && row.checked > row.passed).sort((left, right) => (left.rate as number) - (right.rate as number))[0]
  return {
    kind: 'custom',
    title: `我的动作 · ${record.actionName}`,
    startedAt: record.startedAt,
    complete: report.complete,
    completionText: `${record.goal.type === 'duration' ? '保持' : '完成'} ${progress.done} / ${progress.target} ${progress.unit}`,
    result: record.reps ? { label: '识别重点全部达标', value: `${record.passedReps} ${unit}` } : null,
    biggestIssue: report.primaryFeedback
      ? { title: worst ? worst.label : '动作幅度', detail: `${report.primaryFeedback.message}。`, value: worst ? `${worst.passed} / ${worst.checked} ${unit}达标` : undefined }
      : null,
    nextFocus: focus ? { title: focus.title, detail: focus.detail, href: customTrainingPath(record.actionId) } : null,
    comparison: comparison.available && comparison.doneDelta !== null
      ? { text: comparison.doneDelta === 0 ? '完成量与上次相同' : comparison.doneDelta > 0 ? `比上次多完成 ${comparison.doneDelta} ${progress.unit}` : `比上次少完成 ${Math.abs(comparison.doneDelta)} ${progress.unit}`, direction: comparison.doneDelta > 0 ? 'up' : comparison.doneDelta < 0 ? 'down' : 'flat' }
      : null,
    comparisonReason: comparison.available ? null : comparison.reason,
    strengths: report.requirements.filter((row) => row.rate === 100 && row.checked >= 2).map((row) => `「${REQUIREMENTS[row.id].label}」每${unit}都做到了。`).slice(0, 2),
    reportPath: reportPath(record.id),
  }
}

export function historyEntryDigest(entry: HistoryEntry): ReportDigest {
  if (entry.kind === 'smart') return warmUpDigest(entry.smart.analysis, entry.smart.session)
  if (entry.kind === 'routine') return routineDigest(entry.routine.report)
  return customDigest(entry.custom.report)
}
