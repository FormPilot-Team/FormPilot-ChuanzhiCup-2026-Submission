import { describe, expect, it } from 'vitest'
import { chapterPoints, liveChecks } from '../src/features/routines/followAlong/liveChecks'
import type { FollowAlongMatch } from '../src/features/routines/followAlong/matcher'
import { ROUTINE_PROGRAMS, getRoutineProgram } from '../src/features/routines/programs'
import { getCriterion } from '../src/features/scoring'
import type { RoutineTechniqueRecord } from '../src/features/scoring/routine/techniqueRecord'

const baduanjin = getRoutineProgram('baduanjin')
const bdj1 = baduanjin.chapters.find((chapter) => chapter.id === 'bdj-1')!

function record(windows: RoutineTechniqueRecord['criteria'][number]['windows']): RoutineTechniqueRecord {
  return {
    version: 'scoring-v2.1',
    criteria: ['bdj.1.elbow_extension', 'bdj.1.lift_height', 'bdj.1.arms_by_ears', 'bdj.1.symmetry', 'bdj.1.torso_upright']
      .map((criterionId) => ({ criterionId, chapterId: 'bdj-1', windows })),
  }
}

const inSync = { status: 'in_sync' } as FollowAlongMatch

describe('本段要点', () => {
  it('shows the chapter’s own Scoring v2.1 requirements, scored ones first', () => {
    const { source, points } = chapterPoints('baduanjin', bdj1)
    expect(source).toBe('criteria')
    expect(points.map((point) => point.name)).toEqual(['双臂伸直上托', '上举充分', '两臂帖耳'])
    expect(points[0].cue).toBe(getCriterion('bdj.1.elbow_extension').feedback.cue)
  })

  it('never lists requirements a camera cannot see, and falls back to routine-wide ones', () => {
    for (const program of ROUTINE_PROGRAMS) {
      for (const chapter of program.chapters) {
        const { source, points } = chapterPoints(program.id, chapter)
        expect(points.length).toBeLessThanOrEqual(3)
        for (const point of points) expect(getCriterion(point.id).observable).not.toBe('NOT_OBSERVABLE')
        if (source === 'cue') expect(points).toEqual([])
      }
    }
    const taiji = getRoutineProgram('taijiquan')
    expect(chapterPoints('taijiquan', taiji.chapters[3]).points.map((point) => point.name)).toContain('立身中正')
  })
})

describe('动作规范检查', () => {
  const base = { routine: 'baduanjin' as const, chapter: bdj1, match: inSync, following: true, comparisonAvailable: true }

  it('lists up to three measured requirements and then rhythm', () => {
    const checks = liveChecks({ ...base, record: record([{ start: 50, end: 53, samples: 0, value: null, score: null }]), videoSeconds: 45 })
    expect(checks.map((check) => check.name)).toEqual(['双臂伸直上托', '上举充分', '两臂帖耳', '节奏同步'])
    expect(checks.slice(0, 3).every((check) => check.status === 'observing')).toBe(true)
    expect(checks[3].status).toBe('met')
  })

  it('reads the latest scored phase window: met, or attention with the correction cue', () => {
    const met = liveChecks({ ...base, record: record([{ start: 50, end: 53, samples: 20, value: 160, score: 100 }]), videoSeconds: 52 })
    expect(met[0]).toMatchObject({ status: 'met' })
    const missed = liveChecks({
      ...base,
      record: record([{ start: 50, end: 53, samples: 20, value: 160, score: 100 }, { start: 60, end: 63, samples: 20, value: 130, score: 40 }]),
      videoSeconds: 64,
    })
    expect(missed[0]).toMatchObject({ status: 'attention', hint: getCriterion('bdj.1.elbow_extension').feedback.cue })
  })

  it('says 暂未稳定识别 when a phase closed without enough samples', () => {
    const checks = liveChecks({ ...base, record: record([{ start: 50, end: 53, samples: 2, value: null, score: null }]), videoSeconds: 55 })
    expect(checks[0].status).toBe('unstable')
  })

  it('waits while not following, and keeps only rhythm when the comparison is unavailable', () => {
    expect(liveChecks({ ...base, record: undefined, videoSeconds: 45, following: false }).every((check) => check.status === 'idle')).toBe(true)
    const unavailable = liveChecks({ ...base, record: undefined, videoSeconds: 45, comparisonAvailable: false })
    expect(unavailable).toEqual([{ id: 'follow-along.rhythm', name: '节奏同步', status: 'unstable' }])
  })

  it('drops a requirement the standard video has no phase for in this chapter', () => {
    const partial: RoutineTechniqueRecord = { version: 'scoring-v2.1', criteria: [{ criterionId: 'bdj.1.lift_height', chapterId: 'bdj-1', windows: [{ start: 50, end: 53, samples: 20, value: 0.6, score: 100 }] }] }
    expect(liveChecks({ ...base, record: partial, videoSeconds: 52 }).map((check) => check.name)).toEqual(['上举充分', '节奏同步'])
  })
})
