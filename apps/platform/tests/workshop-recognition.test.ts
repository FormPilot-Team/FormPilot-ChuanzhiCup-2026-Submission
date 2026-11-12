import { describe, expect, it } from 'vitest'
import { createDraftAction, defaultRequirements, validateForSave, withSignalSource } from '../src/features/workshop/definition'
import { FIXTURE_ASPECT, cyclePosition, fixtureFrame, standingPose } from '../src/features/workshop/fixture'
import { PoseCaptureSession } from '../src/features/workshop/recognition/capture'
import { buildPoseMatch } from '../src/features/workshop/recognition/poseMatch'
import { CustomActionRecognizer, resolveRecognition, workshopTestPasses, type RecognizerSnapshot } from '../src/features/workshop/recognition/recognizer'
import { effectiveRequirements, suggestRequirement } from '../src/features/workshop/recognition/requirements'
import { templateProgressThresholds } from '../src/features/workshop/recognition/templates'
import type { CapturedPose, CustomActionDefinition } from '../src/features/workshop/types'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'
import type { PoseLandmark } from '../src/features/pose/types'

const ASPECT = FIXTURE_ASPECT

function capture(landmarks: PoseLandmark[]): CapturedPose {
  return { landmarks: landmarks.map(({ x, y, z, visibility }) => ({ x, y, z, visibility })), aspect: ASPECT, frames: 10, capturedAt: '2026-09-27T00:00:00.000Z' }
}

function lateralRaiseAction(overrides: Partial<CustomActionDefinition> = {}): CustomActionDefinition {
  const draft = createDraftAction(new Date('2026-09-27T00:00:00Z'), 'custom-test')
  return {
    ...draft,
    name: '侧平举练习',
    startPose: { description: '双臂自然下垂', capture: capture(standingPose(8)) },
    finishPose: { description: '双臂抬到肩高', capture: capture(standingPose(90)) },
    ...overrides,
  }
}

/** Bent elbows at shoulder height: the upper arms are level, the forearms point up. */
function bentArmsPose(): PoseLandmark[] {
  const pose = standingPose(90)
  for (const [elbow, wrist] of [[13, 15], [14, 16]] as const) pose[wrist] = { ...pose[elbow], y: pose[elbow].y - 0.14 }
  return pose
}

function run(recognizer: CustomActionRecognizer, poseAt: (t: number) => PoseLandmark[] | null, fromMs: number, toMs: number, stepMs = 33): RecognizerSnapshot[] {
  const snapshots: RecognizerSnapshot[] = []
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const landmarks = poseAt(t)
    const frame = landmarks ? normalizePoseFrame({ timestamp: t, landmarks, confidence: 0.98 }) : null
    snapshots.push(recognizer.process(frame, t, ASPECT))
  }
  return snapshots
}

const cycling = (t: number) => fixtureFrame('cycle', t, { start: capture(standingPose(8)), finish: capture(standingPose(90)) })?.landmarks as PoseLandmark[]
const CYCLE = 3000

describe('pose match: the user\'s own start and finish poses', () => {
  it('measures progress from the start pose (0) to the finish pose (1) on the moving joints only', () => {
    const { model, issue } = buildPoseMatch(capture(standingPose(8)), capture(standingPose(90)))
    expect(issue).toBeUndefined()
    expect(model?.joints.map((joint) => joint.name).sort()).toEqual(['leftElbow', 'leftWrist', 'rightElbow', 'rightWrist'])
    const recognizer = new CustomActionRecognizer(lateralRaiseAction())
    for (const [degrees, expected] of [[8, 0], [90, 1]] as const) {
      const frame = normalizePoseFrame({ timestamp: 0, landmarks: standingPose(degrees), confidence: 1 })
      expect(recognizer.process(frame, 0, ASPECT).progress).toBeCloseTo(expected, 2)
    }
    const halfway = fixtureFrame('cycle', 600 + 350, { start: capture(standingPose(8)), finish: capture(standingPose(90)) })
    expect(cyclePosition(950)).toBeCloseTo(0.5, 2)
    expect(new CustomActionRecognizer(lateralRaiseAction()).process(normalizePoseFrame(halfway!), 950, ASPECT).progress).toBeCloseTo(0.5, 2)
  })

  it('refuses poses that are missing or too similar, with a user-facing reason', () => {
    expect(resolveRecognition(lateralRaiseAction({ finishPose: { description: '' } }))).toMatchObject({ ready: false, issue: '请先记录开始姿势和完成姿势。' })
    const same = resolveRecognition(lateralRaiseAction({ finishPose: { description: '', capture: capture(standingPose(12)) } }))
    expect(same.ready).toBe(false)
    expect(same.issue).toContain('太接近')
    const snapshot = new CustomActionRecognizer(lateralRaiseAction({ finishPose: { description: '' } })).process(normalizePoseFrame({ timestamp: 0, landmarks: standingPose(8), confidence: 1 }), 0, ASPECT)
    expect(snapshot.feedback?.code).toBe('NOT_READY')
    expect(snapshot.reps).toBe(0)
  })

  it('counts one repetition per full start → finish → start cycle, and each passes its requirements', () => {
    const recognizer = new CustomActionRecognizer(lateralRaiseAction())
    const snapshots = run(recognizer, cycling, 0, CYCLE * 3 - 1)
    const events = snapshots.flatMap((item) => item.repEvent ? [item.repEvent] : [])
    expect(events.map((item) => item.index)).toEqual([1, 2, 3])
    expect(events.every((item) => item.passed)).toBe(true)
    expect(events[0].requirements.map((item) => item.id)).toEqual(['arms-straight', 'torso-stable', 'full-return'])
    expect(events[0].durationMs).toBeGreaterThan(1200)
    expect(snapshots.at(-1)).toMatchObject({ reps: 3, passedReps: 3 })
    expect(snapshots.some((item) => item.phase === 'PEAK')).toBe(true)
  })

  it('does not count a movement that stops short of the finish pose', () => {
    const recognizer = new CustomActionRecognizer(lateralRaiseAction())
    const halfRaise = (t: number) => standingPose(8 + (40 - 8) * cyclePosition(t))
    const snapshots = run(recognizer, halfRaise, 0, CYCLE * 2)
    expect(snapshots.at(-1)?.reps).toBe(0)
    expect(snapshots.some((item) => item.feedback?.code === 'MOTION_TOO_SMALL')).toBe(true)
  })

  it('rejects a movement that strays far from the demonstrated path', () => {
    const recognizer = new CustomActionRecognizer(lateralRaiseAction())
    const start = standingPose(8)
    const bent = bentArmsPose()
    const lerp = (t: number) => start.map((a, index) => ({ ...a, x: a.x + (bent[index].x - a.x) * t, y: a.y + (bent[index].y - a.y) * t }))
    const snapshots = run(recognizer, (t) => lerp(cyclePosition(t)), 0, CYCLE)
    expect(snapshots.at(-1)).toMatchObject({ reps: 0, passedReps: 0 })
    expect(snapshots.some((item) => item.quality === 'degraded')).toBe(true)
    expect(snapshots.some((item) => item.feedback?.message.includes('轨迹与示范差别较大'))).toBe(true)
  })

  it('does not join a peak to a return after a brief missing frame', () => {
    const snapshots = run(new CustomActionRecognizer(lateralRaiseAction()), (t) => t < 1000 ? standingPose(8 + 82 * t / 1000) : t < 1100 ? null : standingPose(8), 0, 1800)
    expect(snapshots.at(-1)?.reps).toBe(0)
  })

  it('requires an observed start before a finish-to-start movement can count', () => {
    const snapshots = run(new CustomActionRecognizer(lateralRaiseAction()), (t) => standingPose(t < 500 ? 90 : 8), 0, 1100)
    expect(snapshots.at(-1)?.reps).toBe(0)
  })

  it('does not pass when a required joint is invisible even if the movement counts', () => {
    const action = lateralRaiseAction({ requirements: defaultRequirements('upper').map((item) => item.id === 'knees-bent' ? { ...item, enabled: true } : item) })
    const snapshots = run(new CustomActionRecognizer(action), (t) => standingPose(8 + 82 * cyclePosition(t)).map((point, index) => index === 25 || index === 26 ? { ...point, visibility: 0.05 } : point), 0, CYCLE)
    expect(snapshots.find((item) => item.repEvent)?.repEvent).toMatchObject({ passed: false, failed: ['knees-bent'] })
    expect(snapshots.at(-1)).toMatchObject({ reps: 1, passedReps: 0 })
  })

  it('never completes a repetition across lost tracking', () => {
    const recognizer = new CustomActionRecognizer(lateralRaiseAction())
    // Reach the finish pose, lose the person for 600 ms, then come back already at the start pose.
    const poseAt = (t: number) => t < 1300 ? standingPose(8 + 82 * Math.min(1, t / 1000)) : t < 1900 ? null : standingPose(8)
    const snapshots = run(recognizer, poseAt, 0, 2600)
    expect(snapshots.some((item) => item.quality === 'lost' && item.progress === null)).toBe(true)
    expect(snapshots.at(-1)?.reps).toBe(0)
    expect(snapshots.at(-1)?.phase).toBe('READY')
  })

  it('asks the user to step back when the moving joints leave the picture', () => {
    const recognizer = new CustomActionRecognizer(lateralRaiseAction())
    const outside = standingPose(90).map((item, index) => index === 15 ? { ...item, x: 1.02 } : item)
    const snapshot = recognizer.process(normalizePoseFrame({ timestamp: 0, landmarks: outside, confidence: 1 }), 0, ASPECT)
    expect(snapshot.quality).toBe('degraded')
    expect(snapshot.framingHint).toContain('完整入镜')
  })
})

describe('requirements follow the demonstration', () => {
  it('suggests thresholds from the recorded finish pose and flags contradictions', () => {
    const straight = lateralRaiseAction()
    expect(suggestRequirement('arms-straight', straight)).toEqual({ threshold: 150 })
    expect(suggestRequirement('hands-above-shoulders', straight).conflict).toContain('没有高过肩膀')
    const bent = lateralRaiseAction({ finishPose: { description: '', capture: capture(bentArmsPose()) } })
    expect(suggestRequirement('arms-straight', bent).conflict).toContain('手肘弯曲')
    const overhead = lateralRaiseAction({ finishPose: { description: '', capture: capture(standingPose(170)) } })
    expect(suggestRequirement('hands-above-shoulders', overhead).conflict).toBeUndefined()
  })

  it('uses a manual threshold over the suggestion and never lets full-return be switched off', () => {
    const action = lateralRaiseAction({ requirements: defaultRequirements('upper').map((item) => item.id === 'arms-straight' ? { ...item, threshold: 165 } : item) })
    expect(effectiveRequirements(action).find((item) => item.id === 'arms-straight')?.threshold).toBe(165)
    expect(defaultRequirements('lower').filter((item) => item.enabled).map((item) => item.id)).toEqual(['knees-bent', 'torso-stable', 'full-return'])
    expect(defaultRequirements('core').filter((item) => item.enabled).map((item) => item.id)).toEqual(['full-return'])
  })
})

describe('hold goals', () => {
  it('accumulates time only while the finish pose is held and judges every held second', () => {
    const action = lateralRaiseAction({ goal: { type: 'duration', seconds: 10 } })
    const recognizer = new CustomActionRecognizer(action)
    expect(recognizer.setup.counting).toBe('hold')
    const poseAt = (t: number) => standingPose(t < 500 ? 8 : t < 3600 ? 90 : 8)
    const snapshots = run(recognizer, poseAt, 0, 4200)
    const held = snapshots.at(-1)!.holdMs
    expect(held).toBeGreaterThan(2800)
    expect(held).toBeLessThan(3300)
    expect(snapshots.filter((item) => item.repEvent).length).toBe(3)
    expect(snapshots.some((item) => item.phase === 'HOLDING')).toBe(true)
    expect(effectiveRequirements(action).map((item) => item.id)).not.toContain('full-return')
  })
  it('does not count missing-camera time as held time', () => {
    const action = lateralRaiseAction({ goal: { type: 'duration', seconds: 10 } })
    const snapshots = run(new CustomActionRecognizer(action), (t) => t < 500 ? standingPose(8) : t < 1600 ? standingPose(90) : t < 1800 ? null : standingPose(90), 0, 2600)
    expect(snapshots.at(-1)?.holdMs).toBeLessThan(1900)
    expect(snapshots.filter((item) => item.repEvent)).toHaveLength(1)
  })
})

describe('workbench templates', () => {
  it('runs an uncalibrated template in its own units with the workbench thresholds', () => {
    const action = withSignalSource(lateralRaiseAction({ startPose: { description: '' }, finishPose: { description: '' } }), 'arm-raise')
    expect(action.recognition.thresholds).toEqual(templateProgressThresholds('arm-raise', 'upper-body'))
    const recognizer = new CustomActionRecognizer(action)
    expect(recognizer.setup).toMatchObject({ mode: 'template', ready: true, counting: 'pulse' })
    const overhead = (t: number) => standingPose(8 + (170 - 8) * cyclePosition(t))
    const snapshots = run(recognizer, overhead, 0, CYCLE * 2 - 1)
    expect(snapshots.at(-1)?.reps).toBe(2)
  })

  it('calibrates a template with the recorded poses when both exist', () => {
    // arm-raise measures wrist height above the shoulder, so its finish pose is an overhead raise.
    const action = withSignalSource(lateralRaiseAction({ finishPose: { description: '', capture: capture(standingPose(170)) } }), 'arm-raise')
    const setup = resolveRecognition(action)
    expect(setup.mode).toBe('template-calibrated')
    expect(setup.calibration!.finish).toBeGreaterThan(setup.calibration!.start)
  })

  it('counts arm circles by full turns', () => {
    const action = withSignalSource(lateralRaiseAction({ startPose: { description: '' }, finishPose: { description: '' } }), 'arm-circle')
    const recognizer = new CustomActionRecognizer(action)
    expect(recognizer.setup.counting).toBe('orbit')
    const circle = (t: number) => standingPose(8 + (360 * t) / 2000)
    const snapshots = run(recognizer, circle, 0, 4000)
    expect(snapshots.at(-1)!.reps).toBeGreaterThanOrEqual(1)
  })
  it('does not count back-and-forth arm swings as an orbit', () => {
    const action = withSignalSource(lateralRaiseAction({ startPose: { description: '' }, finishPose: { description: '' } }), 'arm-circle')
    const snapshots = run(new CustomActionRecognizer(action), (t) => {
      const pose = standingPose(8)
      const shoulder = pose[11]
      const angle = Math.sin(t / 220) * 1.3
      pose[15] = { ...pose[15], x: shoulder.x + Math.cos(angle) * 0.18, y: shoulder.y + Math.sin(angle) * 0.18 }
      return pose
    }, 0, 4000)
    expect(snapshots.at(-1)?.reps).toBe(0)
  })
  it('rejects duration goals with count-only templates', () => {
    const action = withSignalSource(lateralRaiseAction({ goal: { type: 'duration', seconds: 10 } }), 'arm-circle')
    expect(resolveRecognition(action)).toMatchObject({ ready: false, issue: expect.stringContaining('按次数') })
    expect(validateForSave(action)).toContain('这个动作模板按完整次数识别；请改为按次数，或选择可保持的识别方式。')
  })
})

describe('workshop test acceptance', () => {
  it('requires passed repetitions, not just counted repetitions or time', () => {
    expect(workshopTestPasses({ reps: 3, passedReps: 0, holdMs: 0 }, { type: 'reps', target: 10 })).toBe(false)
    expect(workshopTestPasses({ reps: 3, passedReps: 3, holdMs: 0 }, { type: 'reps', target: 10 })).toBe(true)
    expect(workshopTestPasses({ reps: 3, passedReps: 0, holdMs: 3200 }, { type: 'duration', seconds: 10 })).toBe(false)
  })
})

describe('pose capture', () => {
  it('records the average of a still hold and restarts when the user moves', () => {
    const session = new PoseCaptureSession(['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip', 'leftWrist', 'rightWrist'], ASPECT, 1000, () => 'now')
    expect(session.push(null, 0).status).toBe('waiting-body')
    let result = session.push(standingPose(8), 100)
    expect(result.status).toBe('holding')
    result = session.push(standingPose(60), 700)
    expect(result.progress).toBe(0)
    for (let t = 733; t <= 1800; t += 33) result = session.push(standingPose(60), t)
    expect(result.status).toBe('captured')
    expect(result.pose).toMatchObject({ aspect: ASPECT, capturedAt: 'now' })
    expect(result.pose!.landmarks).toHaveLength(33)
    expect(result.pose!.landmarks[15].x).toBeCloseTo(standingPose(60)[15].x, 3)
  })

  it('names the landmarks it is still waiting for', () => {
    const session = new PoseCaptureSession(['leftShoulder', 'leftAnkle'], ASPECT)
    const hidden = standingPose(8).map((item, index) => index === 27 ? { ...item, visibility: 0.1 } : item)
    expect(session.push(hidden, 0)).toMatchObject({ status: 'waiting-body', missing: ['leftAnkle'] })
  })
})

describe('saving', () => {
  it('lists what blocks saving in user language', () => {
    const draft = createDraftAction(new Date('2026-09-27T00:00:00Z'), 'custom-draft')
    expect(validateForSave(draft)).toEqual(['请填写动作名称', '请记录开始姿势和完成姿势，FormPilot 才能识别这个动作'])
    expect(validateForSave(lateralRaiseAction())).toEqual([])
  })
})
