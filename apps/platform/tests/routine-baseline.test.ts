import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildRoutineReport } from '../src/features/routines/report/routineReport'
import type { RoutineSessionRecord } from '../src/features/routines/session/types'
import type { RoutineId, RoutineScope } from '../src/features/routines/types'
import { swingingPose } from './helpers/routineFixtures'
import { bentElbows, mirrorLandmarks, noisyLandmarks, replayRoutine, ROUTINE_IDS, type ReplayOptions, type ReplayResult } from './helpers/routineReplay'

/**
 * Baseline snapshot regression for the follow-along pipeline (matcher, chapter recorder, Scoring v2 technique,
 * feedback policy, live checks, report). The fixtures were generated on e4fdb41, before the routine analyzers were
 * added; everything the analyzers add (the optional `analysis` fields) is removed before comparing, so any other
 * difference is a regression of existing behaviour.
 *
 * Regenerate only on purpose: `UPDATE_ROUTINE_BASELINE=1 pnpm vitest run tests/routine-baseline.test.ts`.
 */

const FIXTURE_DIR = 'tests/fixtures/routine-baseline'
const UPDATE = process.env.UPDATE_ROUTINE_BASELINE === '1'
const ASPECT = 640 / 360

/** One numbered form per routine for the single-form scope runs. */
const FORM_SCOPE: Readonly<Record<RoutineId, string>> = { baduanjin: 'bdj-3', taijiquan: 'tjq-9', wuqinxi: 'wqx-5', yijinjing: 'yjj-7' }

interface Variant {
  name: string
  options: (id: RoutineId) => ReplayOptions
  /** Report history: the identity run, saved earlier, so "相比上次" is exercised. */
  withHistory: boolean
}

const VARIANTS: ReadonlyArray<Variant> = [
  { name: 'identity', options: () => ({}), withHistory: false },
  { name: 'lag-0.6s', options: () => ({ lagSeconds: 0.6 }), withHistory: true },
  { name: 'mirror', options: () => ({ transform: mirrorLandmarks }), withHistory: true },
  { name: 'noise-0.01', options: (id) => ({ transform: noisyLandmarks(0.01, ROUTINE_IDS.indexOf(id) + 7) }), withHistory: true },
  { name: 'elbows-30deg', options: () => ({ transform: bentElbows(30, ASPECT) }), withHistory: true },
  // Two ticks in ten without a pose, plus a 3 s dropout every 40 s of video.
  { name: 'dropouts', options: () => ({ dropped: (video, index) => index % 10 === 3 || index % 10 === 7 || video % 40 < 3 }), withHistory: true },
  { name: 'form-identity', options: (id) => ({ scope: { kind: 'form', chapterId: FORM_SCOPE[id] } }), withHistory: false },
  {
    name: 'form-synthetic-swing',
    options: (id) => ({ scope: { kind: 'form', chapterId: FORM_SCOPE[id] }, userPose: (video) => swingingPose(video) }),
    withHistory: false,
  },
]

/** Large shared objects (program, chapters, criteria, the record itself) are reduced to their ids. */
function collapse(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const object = value as Record<string, unknown>
  if (object.kind === 'routine' && 'schemaVersion' in object) return `record:${String(object.id)}`
  if ('video' in object && 'chapters' in object && 'formUnit' in object) return `program:${String(object.id)}`
  if ('startSeconds' in object && 'endSeconds' in object && 'cue' in object && 'index' in object) return `chapter:${String(object.id)}`
  if ('measurement' in object && 'scoring' in object && 'feedback' in object) return `criterion:${String(object.id)}`
  return value
}

function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, collapse))
}

/** Removes the routine analyzers' additions (optional `analysis` fields) wherever they appear. */
export function withoutAnalysis(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAnalysis)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'analysis').map(([key, item]) => [key, withoutAnalysis(item)]))
}

function snapshotOf(id: RoutineId, variant: Variant, run: ReplayResult, identity: RoutineSessionRecord | undefined) {
  const record: RoutineSessionRecord = { ...run.record, id: `replay-${id}-${variant.name}` }
  const history = variant.withHistory && identity ? [{ ...identity, startedAt: identity.startedAt - 86_400_000 }] : []
  return plain({
    variant: variant.name,
    scope: run.scope as RoutineScope,
    ticks: run.ticks,
    record: {
      chapters: record.chapters,
      technique: record.technique,
      analysis: (record as { analysis?: unknown }).analysis,
    },
    feedback: run.feedback,
    spoken: run.spoken,
    liveChecks: run.liveChecks,
    report: buildRoutineReport(record, history),
  })
}

describe('Routine follow-along baseline (snapshot regression)', () => {
  for (const id of ROUTINE_IDS) {
    it(`${id}: matcher, recorder, technique, feedback, live checks and report match the e4fdb41 baseline`, () => {
      let identity: RoutineSessionRecord | undefined
      const snapshots = VARIANTS.map((variant) => {
        const run = replayRoutine(id, variant.options(id))
        if (variant.name === 'identity') identity = { ...run.record, id: `replay-${id}-identity` }
        return snapshotOf(id, variant, run, identity)
      })
      const actual = withoutAnalysis(snapshots)
      const file = `${FIXTURE_DIR}/${id}.json`
      if (UPDATE) {
        if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true })
        writeFileSync(file, `${JSON.stringify(actual, null, 1)}\n`)
      }
      const expected = JSON.parse(readFileSync(file, 'utf8')) as unknown
      expect(actual).toEqual(expected)
    }, 120_000)
  }
})
