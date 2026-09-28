import { criteriaFor } from '../../scoring/criteria'
import { TECHNIQUE_CONFIG } from '../../scoring/routine/RoutineTechniqueEvaluator'
import type { RoutineTechniqueRecord } from '../../scoring/routine/techniqueRecord'
import type { EvaluationCriterion } from '../../scoring/types'
import type { RoutineChapter, RoutineId } from '../types'
import type { FollowAlongMatch } from './matcher'

/**
 * Training-page views of Scoring v2.1 for the current chapter. Nothing here scores anything: the points come from the
 * criterion registry, and the live check status reads the technique evaluator's own snapshot. The training page
 * only shows what to watch and whether it has been met so far; the report keeps the full evidence.
 */

export interface ChapterPoint {
  id: string
  name: string
  cue: string
}

export interface ChapterPoints {
  /** `criteria` when the points come from the Scoring v2.1 registry, `cue` for the chapter's own cue only. */
  source: 'criteria' | 'cue'
  points: ReadonlyArray<ChapterPoint>
}

const MAX_POINTS = 3

const ROLE_ORDER: Readonly<Record<EvaluationCriterion['scoring'], number>> = { SCORED: 0, ADVISORY: 1, REFERENCE_ONLY: 2 }

function visible(criteria: ReadonlyArray<EvaluationCriterion>): EvaluationCriterion[] {
  // Breathing, intent or gaze are real requirements, but a camera page cannot show them as something to watch.
  return criteria.filter((criterion) => criterion.observable !== 'NOT_OBSERVABLE')
}

function ranked(criteria: ReadonlyArray<EvaluationCriterion>): EvaluationCriterion[] {
  return [...criteria].sort((a, b) => ROLE_ORDER[a.scoring] - ROLE_ORDER[b.scoring] || b.weight - a.weight)
}

/** 本段要点: the chapter's own movement requirements first, then routine-wide ones (太极拳 has only those). */
export function chapterPoints(routine: RoutineId, chapter: RoutineChapter): ChapterPoints {
  const all = visible(criteriaFor(routine, chapter.id))
  const own = ranked(all.filter((criterion) => criterion.exercise === chapter.id))
  const shared = ranked(all.filter((criterion) => criterion.exercise === '*'))
  const picked = [...own, ...shared].slice(0, MAX_POINTS)
  if (!picked.length) return { source: 'cue', points: [] }
  return { source: 'criteria', points: picked.map((criterion) => ({ id: criterion.id, name: criterion.name, cue: criterion.feedback.cue })) }
}

export type LiveCheckStatus = 'idle' | 'observing' | 'met' | 'attention' | 'unstable'

export interface LiveCheck {
  id: string
  name: string
  status: LiveCheckStatus
  /** One short correction, only while the check needs attention. */
  hint?: string
}

export const LIVE_CHECK_LABEL: Readonly<Record<LiveCheckStatus, string>> = {
  idle: '待开始',
  observing: '识别中',
  met: '已达标',
  attention: '需注意',
  unstable: '暂未稳定识别',
}

const MAX_CHECKS = 3

function measured(routine: RoutineId, chapter: RoutineChapter): EvaluationCriterion[] {
  const own = criteriaFor(routine, chapter.id).filter((criterion) => criterion.measurement.kind === 'pose-window' && criterion.scoring !== 'REFERENCE_ONLY')
  return [...ranked(own.filter((criterion) => criterion.exercise === chapter.id)), ...ranked(own.filter((criterion) => criterion.exercise === '*'))]
}

function criterionStatus(
  criterion: EvaluationCriterion,
  chapter: RoutineChapter,
  record: RoutineTechniqueRecord | undefined,
  videoSeconds: number,
  following: boolean,
): { status: LiveCheckStatus; hint?: string } | undefined {
  const entry = record?.criteria.find((item) => item.criterionId === criterion.id && item.chapterId === chapter.id)
  // The standard video has no phase of this requirement in the chapter: nothing to report live.
  if (record && (!entry || !entry.windows.length)) return undefined
  if (!following) return { status: 'idle' }
  if (!entry) return { status: 'observing' }
  const started = entry.windows.filter((window) => window.start <= videoSeconds)
  const scored = started.filter((window) => window.score !== null)
  const latest = scored.at(-1)
  if (latest) {
    return latest.score === 100 ? { status: 'met' } : { status: 'attention', hint: criterion.feedback.cue }
  }
  const closedUnobserved = started.some((window) => Math.min(window.end + TECHNIQUE_CONFIG.lagSeconds, chapter.endSeconds) < videoSeconds)
  return { status: closedUnobserved ? 'unstable' : 'observing' }
}

function rhythmCheck(match: FollowAlongMatch | undefined, following: boolean): LiveCheck {
  const base = { id: 'follow-along.rhythm', name: '节奏同步' }
  if (!following) return { ...base, status: 'idle' }
  if (!match || match.status === 'insufficient') return { ...base, status: 'observing' }
  if (match.status === 'in_sync') return { ...base, status: 'met' }
  if (match.status === 'ahead') return { ...base, status: 'attention', hint: '稍快了，放慢跟上示范' }
  if (match.status === 'behind') return { ...base, status: 'attention', hint: '稍慢了，跟上示范的节奏' }
  return { ...base, status: 'attention', hint: '对照示范调整动作' }
}

export interface LiveChecksInput {
  routine: RoutineId
  chapter: RoutineChapter
  record: RoutineTechniqueRecord | undefined
  videoSeconds: number
  match: FollowAlongMatch | undefined
  /** The user is following (course ACTIVE, not paused); otherwise every check waits. */
  following: boolean
  /** The follow-along comparison is available (the standard video's pose track loaded). */
  comparisonAvailable: boolean
}

/** 动作规范检查: up to three measured requirements of the chapter, then rhythm against the standard video. */
export function liveChecks(input: LiveChecksInput): LiveCheck[] {
  const checks: LiveCheck[] = []
  if (input.comparisonAvailable) {
    for (const criterion of measured(input.routine, input.chapter)) {
      if (checks.length >= MAX_CHECKS) break
      const status = criterionStatus(criterion, input.chapter, input.record, input.videoSeconds, input.following)
      if (status) checks.push({ id: criterion.id, name: criterion.name, ...status })
    }
  }
  checks.push(input.comparisonAvailable ? rhythmCheck(input.match, input.following) : { id: 'follow-along.rhythm', name: '节奏同步', status: 'unstable' })
  return checks
}
