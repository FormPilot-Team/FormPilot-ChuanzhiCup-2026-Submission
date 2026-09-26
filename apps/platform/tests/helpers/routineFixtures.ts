import type { ReferenceFrame, ReferencePoint, ReferenceTrack } from '../../src/features/routines/followAlong/referenceTrack'
import { getRoutineProgram } from '../../src/features/routines/programs'
import { scopeChapters } from '../../src/features/routines/scope'
import type { RoutineChapterResult, RoutineSessionRecord } from '../../src/features/routines/session/types'
import type { RoutineId, RoutineScope } from '../../src/features/routines/types'

export type Pose = ReferencePoint[]

const point = (x: number, y: number, visibility = 0.98): ReferencePoint => ({ x, y, visibility })

/**
 * A person facing the camera, standing in the middle of a 16:9 frame. MediaPipe's "left" is the person's left,
 * which appears on the right of the image (larger x).
 */
export function standingPose(): Pose {
  const pose: Pose = Array.from({ length: 33 }, () => point(0.5, 0.4))
  const set = (index: number, x: number, y: number) => { pose[index] = point(x, y) }
  set(0, 0.5, 0.2)
  for (let index = 1; index <= 10; index += 1) set(index, 0.5 + (index % 2 ? 0.01 : -0.01), 0.19)
  set(11, 0.54, 0.3); set(12, 0.46, 0.3)
  set(13, 0.56, 0.42); set(14, 0.44, 0.42)
  set(15, 0.57, 0.53); set(16, 0.43, 0.53)
  for (const [index, x] of [[17, 0.575], [19, 0.575], [21, 0.57], [18, 0.425], [20, 0.425], [22, 0.43]] as const) set(index, x, 0.55)
  set(23, 0.53, 0.55); set(24, 0.47, 0.55)
  set(25, 0.53, 0.72); set(26, 0.47, 0.72)
  set(27, 0.53, 0.88); set(28, 0.47, 0.88)
  set(29, 0.53, 0.9); set(30, 0.47, 0.9); set(31, 0.54, 0.91); set(32, 0.46, 0.91)
  return pose
}

/** Raises one arm (the person's own side) by `degrees` from hanging down, elbow straight. */
export function withArmRaised(pose: Pose, side: 'left' | 'right', degrees: number): Pose {
  const next = pose.map((item) => ({ ...item }))
  const [shoulder, elbow, wrist] = side === 'left' ? [11, 13, 15] : [12, 14, 16]
  const direction = side === 'left' ? 1 : -1
  const radians = (degrees * Math.PI) / 180
  const upper = 0.12
  const origin = next[shoulder]
  // Measured in a 16:9 frame: x distances are scaled so the limb keeps its length in pixels.
  const dx = (Math.sin(radians) * upper * direction) / (16 / 9)
  const dy = Math.cos(radians) * upper
  next[elbow] = point(origin.x + dx, origin.y + dy)
  next[wrist] = point(origin.x + 2 * dx, origin.y + 2 * dy)
  return next
}

export function withLegsHidden(pose: Pose): Pose {
  return pose.map((item, index) => (index >= 25 ? { ...item, visibility: 0.05 } : item))
}

/** Re-expresses a 16:9 pose as it would appear in a 4:3 image of the same scene (same pixel proportions). */
export function asFourByThree(pose: Pose): Pose {
  const scale = (16 / 9) / (4 / 3)
  return pose.map((item) => ({ ...item, x: 0.5 + (item.x - 0.5) * scale }))
}

export function trackOf(poseAt: (t: number) => Pose | null, durationSeconds: number, fps = 10): ReferenceTrack {
  const frames: ReferenceFrame[] = []
  for (let index = 0; index <= Math.round(durationSeconds * fps); index += 1) {
    const t = Number((index / fps).toFixed(2))
    const pose = poseAt(t)
    frames.push(pose ? { t, confidence: 0.95, landmarks: pose } : { t, confidence: 0, landmarks: [] })
  }
  return { asset: '/test.mp4', duration: durationSeconds, fps, width: 640, height: 360, frames }
}

/** Both arms swing up and down together with the given period; a smooth, always-moving reference. */
export function swingingPose(t: number, periodSeconds = 8): Pose {
  const angle = 60 + 50 * Math.sin((2 * Math.PI * t) / periodSeconds)
  return withArmRaised(withArmRaised(standingPose(), 'left', angle), 'right', angle)
}

/** Alternating one-arm raise: the left arm leads, the right follows half a period later. */
export function alternatingPose(t: number, periodSeconds = 6): Pose {
  const phase = (2 * Math.PI * t) / periodSeconds
  return withArmRaised(withArmRaised(standingPose(), 'left', 90 + 80 * Math.sin(phase)), 'right', 90 - 80 * Math.sin(phase))
}

export function chapterResult(chapterId: string, overrides: Partial<RoutineChapterResult> = {}): RoutineChapterResult {
  return {
    chapterId,
    totalSeconds: 60,
    coveredSeconds: 60,
    samples: 400,
    insufficientSamples: 0,
    similaritySum: 400 * 0.8,
    regionSums: { arms: 400 * 0.8, torso: 400 * 0.85, legs: 400 * 0.75 },
    regionSamples: { arms: 400, torso: 400, legs: 400 },
    statusCounts: { in_sync: 320, ahead: 20, behind: 40, mismatch: 20 },
    mirroredSamples: 0,
    ...overrides,
  }
}

interface RecordOptions {
  id?: string
  programId?: RoutineId
  scope?: RoutineScope
  startedAt?: number
  outcome?: RoutineSessionRecord['outcome']
  source?: RoutineSessionRecord['source']
  mode?: RoutineSessionRecord['mode']
  matcherAvailable?: boolean
  /** Per-chapter overrides keyed by chapter id; `similarity` sets the mean similarity (0..1). */
  chapters?: Record<string, Partial<RoutineChapterResult> & { similarity?: number }>
}

/** A saved routine record whose chapter results cover the scope, with realistic totals per chapter. */
export function routineRecord(options: RecordOptions = {}): RoutineSessionRecord {
  const programId = options.programId ?? 'baduanjin'
  const program = getRoutineProgram(programId)
  const scope = options.scope ?? { kind: 'full' }
  const chapters = scopeChapters(program, scope).map((chapter) => {
    const totalSeconds = Math.round(chapter.endSeconds - chapter.startSeconds)
    const samples = totalSeconds * 10
    const { similarity, ...override } = options.chapters?.[chapter.id] ?? {}
    const mean = similarity ?? 0.8
    return chapterResult(chapter.id, {
      totalSeconds,
      coveredSeconds: totalSeconds,
      samples,
      similaritySum: samples * mean,
      regionSums: { arms: samples * mean, torso: samples * Math.min(1, mean + 0.05), legs: samples * Math.max(0, mean - 0.05) },
      regionSamples: { arms: samples, torso: samples, legs: samples },
      statusCounts: { in_sync: Math.round(samples * 0.8), ahead: Math.round(samples * 0.05), behind: Math.round(samples * 0.1), mismatch: samples - Math.round(samples * 0.8) - Math.round(samples * 0.05) - Math.round(samples * 0.1) },
      ...override,
    })
  })
  return {
    schemaVersion: 1,
    kind: 'routine',
    id: options.id ?? 'routine-1',
    programId,
    programVersion: program.version,
    scope,
    source: options.source ?? 'live',
    mode: options.mode ?? 'normal',
    matcher: { version: 'follow-along-v1', available: options.matcherAvailable ?? true },
    startedAt: options.startedAt ?? Date.UTC(2026, 8, 20, 8),
    endedAt: (options.startedAt ?? Date.UTC(2026, 8, 20, 8)) + 800_000,
    activeMs: 730_000,
    outcome: options.outcome ?? 'completed',
    chapters,
  }
}
