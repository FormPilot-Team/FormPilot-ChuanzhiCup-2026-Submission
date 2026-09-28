import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseReferenceTrack, type ReferencePoint, type ReferenceTrack } from '../src/features/routines/followAlong/referenceTrack'
import { getRoutineProgram } from '../src/features/routines/programs'
import { buildRoutineReport } from '../src/features/routines/report/routineReport'
import { isRoutineSessionRecord } from '../src/features/routines/session/types'
import type { RoutineId } from '../src/features/routines/types'
import { getCriterion, routineMeasuredCriteria } from '../src/features/scoring'
import { RoutineTechniqueEvaluator } from '../src/features/scoring/routine/RoutineTechniqueEvaluator'
import { detectPhaseWindows } from '../src/features/scoring/routine/phaseWindows'
import { computePoseMetric } from '../src/features/scoring/routine/poseMetrics'
import { buildRoutineTechniqueReport, evidenceSentence } from '../src/features/scoring/routine/techniqueReport'
import type { RoutineTechniqueRecord } from '../src/features/scoring/routine/techniqueRecord'
import { routineRecord } from './helpers/routineFixtures'

const tracks = new Map<RoutineId, ReferenceTrack>()
function track(id: RoutineId): ReferenceTrack {
  let loaded = tracks.get(id)
  if (!loaded) {
    loaded = parseReferenceTrack(JSON.parse(readFileSync(`public/assets/routines/${id}-standard.pose.json`, 'utf8'))) as ReferenceTrack
    tracks.set(id, loaded)
  }
  return loaded
}

type Transform = (landmarks: ReadonlyArray<ReferencePoint>, t: number) => ReadonlyArray<ReferencePoint>

/** Follows the standard video with its own pose (optionally late, mirrored or altered), one tick per 0.1 s. */
function followWithReference(id: RoutineId, options: { lagSeconds?: number; transform?: Transform; scope?: { kind: 'full' } | { kind: 'form'; chapterId: string } } = {}): RoutineTechniqueRecord {
  const reference = track(id)
  const evaluator = new RoutineTechniqueEvaluator(getRoutineProgram(id), options.scope ?? { kind: 'full' }, reference)
  const aspect = reference.width / reference.height
  const lag = options.lagSeconds ?? 0
  for (const frame of reference.frames) {
    if (!frame.landmarks.length) continue
    const landmarks = options.transform ? options.transform(frame.landmarks, frame.t) : frame.landmarks
    evaluator.observe(frame.t + lag, { landmarks, confidence: frame.confidence, aspect })
  }
  return evaluator.snapshot()
}

function mirror(landmarks: ReadonlyArray<ReferencePoint>): ReferencePoint[] {
  const pairs: Array<[number, number]> = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]]
  const next = landmarks.map((point) => ({ ...point, x: 1 - point.x }))
  for (const [left, right] of pairs) [next[left], next[right]] = [next[right], next[left]]
  return next
}

/** Bends both elbows by rotating each wrist about its elbow towards the shoulder (in true image proportions). */
function bendElbows(degrees: number, aspect: number): Transform {
  const elbowAngle = (s: ReferencePoint, e: ReferencePoint, w: ReferencePoint) => {
    const ax = (s.x - e.x) * aspect
    const ay = s.y - e.y
    const bx = (w.x - e.x) * aspect
    const by = w.y - e.y
    return Math.acos((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by)))
  }
  return (landmarks) => {
    const next = landmarks.map((point) => ({ ...point }))
    for (const [shoulder, elbow, wrist] of [[11, 13, 15], [12, 14, 16]] as const) {
      const e = next[elbow]
      const w = next[wrist]
      const candidates = [1, -1].map((sign) => {
        const radians = (sign * degrees * Math.PI) / 180
        const dx = (w.x - e.x) * aspect
        const dy = w.y - e.y
        const rotated = { ...w, x: e.x + (dx * Math.cos(radians) - dy * Math.sin(radians)) / aspect, y: e.y + dx * Math.sin(radians) + dy * Math.cos(radians) }
        return { rotated, angle: elbowAngle(next[shoulder], e, rotated) }
      })
      next[wrist] = candidates[0].angle <= candidates[1].angle ? candidates[0].rotated : candidates[1].rotated
    }
    return next
  }
}

function scoresOf(record: RoutineTechniqueRecord, criterionId: string): number[] {
  return record.criteria.filter((item) => item.criterionId === criterionId).flatMap((item) => item.windows.map((window) => window.score)).filter((score): score is number => score !== null)
}

describe('Scoring v2 routines: the standard demonstration meets its own criteria', () => {
  for (const id of ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing'] as RoutineId[]) {
    it(`${id}: every measured criterion finds phase windows and the demonstrator scores full marks`, () => {
      const record = followWithReference(id)
      const measured = routineMeasuredCriteria(id)
      for (const criterion of measured) {
        const entries = record.criteria.filter((item) => item.criterionId === criterion.id)
        expect(entries.length, `${criterion.id} has no phase window in the standard video`).toBeGreaterThan(0)
        const scores = entries.flatMap((item) => item.windows.map((window) => window.score)).filter((score): score is number => score !== null)
        expect(scores.length, criterion.id).toBeGreaterThan(0)
        expect(Math.min(...scores), `${criterion.id} is stricter than the standard demonstration`).toBe(100)
      }
    })
  }

  it('finds the six 托举 of 两手托天理三焦 in the standard video', () => {
    const criterion = getCriterion('bdj.1.elbow_extension')
    if (criterion.measurement.kind !== 'pose-window') throw new Error('expected a pose-window check')
    const chapter = getRoutineProgram('baduanjin').chapters.find((item) => item.id === 'bdj-1')
    const windows = detectPhaseWindows(track('baduanjin'), chapter!.startSeconds, chapter!.endSeconds, criterion.measurement.window)
    expect(windows).toHaveLength(6)
    expect(windows.every((window) => window.end - window.start >= 4)).toBe(true)
  })
})

describe('Scoring v2 routines: 两手托天理三焦 sample — requirement → metric → threshold → score → feedback', () => {
  const scope = { kind: 'form' as const, chapterId: 'bdj-1' }
  const aspect = 640 / 360

  it('fails 双臂伸直上托 with phase evidence when the elbows stay bent at the top', () => {
    const record = followWithReference('baduanjin', { scope, transform: bendElbows(45, aspect) })
    const elbow = scoresOf(record, 'bdj.1.elbow_extension')
    expect(elbow).toHaveLength(6)
    expect(Math.max(...elbow)).toBeLessThan(100)
    const report = buildRoutineTechniqueReport(getRoutineProgram('baduanjin'), scope, record)
    const top = report.deductions[0]
    expect(top.result.criterion.id).toBe('bdj.1.elbow_extension')
    const worst = top.result.failures[0]
    expect(worst.value).toBeLessThan(150)
    expect(worst.phase).toBe('托举顶点')
    expect(worst.targetText).toBe('≥ 150°')
    expect(evidenceSentence(top.result, worst)).toMatch(/^第 \d 次托举顶点（视频 0[0-2]:\d\d）双肘伸展角（较弯一侧） \d+°，要求 ≥ 150°$/)
    expect(top.result.criterion.feedback.cue).toContain('两肘慢慢伸直')
    expect(top.result.criterion.sourceTitle).toBe('《健身气功•八段锦习惯性错误及纠正方法》')
  })

  it('does not blame the elbows when the arms are straight but the user follows 0.8 s late or as in a mirror', () => {
    for (const record of [followWithReference('baduanjin', { scope, lagSeconds: 0.8 }), followWithReference('baduanjin', { scope, transform: mirror })]) {
      for (const id of ['bdj.1.elbow_extension', 'bdj.1.lift_height', 'bdj.1.arms_by_ears', 'bdj.1.torso_upright', 'bdj.1.phase_completion']) {
        expect(Math.min(...scoresOf(record, id)), id).toBe(100)
      }
    }
  })

  it('leaves a phase unobserved (never zero) when the user is not visible', () => {
    const hidden: Transform = (landmarks) => landmarks.map((point) => ({ ...point, visibility: 0.1 }))
    const record = followWithReference('baduanjin', { scope, transform: hidden })
    expect(record.criteria.every((item) => item.windows.every((window) => window.value === null && window.score === null))).toBe(true)
    const report = buildRoutineTechniqueReport(getRoutineProgram('baduanjin'), scope, record)
    expect(report.score).toBeNull()
    expect(report.deductions).toEqual([])
  })

  it('measures 2D metrics the same way for the demonstrator and a mirrored user', () => {
    const frame = track('baduanjin').frames.find((item) => item.t >= 52 && item.landmarks.length)!
    for (const metric of ['elbowAngleMin', 'wristsAboveHead', 'upperArmFromVertical', 'torsoLean', 'shoulderAngleGap'] as const) {
      const direct = computePoseMetric(metric, { landmarks: frame.landmarks, aspect })
      const mirrored = computePoseMetric(metric, { landmarks: mirror(frame.landmarks), aspect })
      expect(mirrored, metric).toBeCloseTo(direct as number, 6)
    }
  })
})

describe('Scoring v2 routines: Gate E — similarity and technique stay separate', () => {
  it('reports technique from its own evidence, whatever the similarity', () => {
    const technique = followWithReference('baduanjin', { scope: { kind: 'form', chapterId: 'bdj-1' }, transform: bendElbows(45, 640 / 360) })
    const record = { ...routineRecord({ scope: { kind: 'form', chapterId: 'bdj-1' }, chapters: { 'bdj-1': { similarity: 0.92 } } }), technique }
    expect(isRoutineSessionRecord(record)).toBe(true)
    const report = buildRoutineReport(record)!
    expect(report.similarity).toBe(92)
    expect(report.technique.available).toBe(true)
    expect(report.technique.score).not.toBeNull()
    expect(report.technique.score).toBeLessThan(92)
    expect(report.headline).toContain('跟练相似度 92%')
    expect(report.headline).not.toContain('规范')
  })

  it('says why there is no technique evaluation for records saved before Scoring v2 or without the pose data', () => {
    const old = buildRoutineReport(routineRecord())!
    expect(old.technique).toMatchObject({ available: false, score: null })
    expect(old.technique.reason).toContain('评分说明上线之前')
    const noTrack = buildRoutineReport(routineRecord({ matcherAvailable: false }))!
    expect(noTrack.technique.reason).toContain('没有加载到标准动作姿态数据')
  })

  it('validates the optional technique field of a saved record', () => {
    const base = routineRecord()
    expect(isRoutineSessionRecord({ ...base, technique: { version: 'scoring-v2.0', criteria: [] } })).toBe(true)
    expect(isRoutineSessionRecord({ ...base, technique: { version: 'scoring-v2.0', criteria: [{ criterionId: 'x', chapterId: 'y', windows: [{ start: 'a' }] }] } })).toBe(false)
  })

  it('lists requirements the camera cannot judge instead of scoring them', () => {
    const report = buildRoutineTechniqueReport(getRoutineProgram('baduanjin'), { kind: 'full' }, followWithReference('baduanjin'))
    expect(report.routineNotObservable.map((item) => item.name)).toEqual(['呼吸配合', '意念与神态'])
    const form1 = report.chapters.find((item) => item.chapter.id === 'bdj-1')!
    expect(form1.references.map((item) => item.id)).toEqual(['bdj.1.head_follows_hands', 'bdj.1.separate_hands'])
    expect(form1.measured.map((item) => item.criterion.id)).toEqual([
      'bdj.1.elbow_extension', 'bdj.1.lift_height', 'bdj.1.arms_by_ears', 'bdj.1.symmetry', 'bdj.1.torso_upright', 'bdj.1.phase_completion',
    ])
    expect(report.score).toBe(100)
    expect(report.measuredChapterCount).toBe(8)
  })
})
