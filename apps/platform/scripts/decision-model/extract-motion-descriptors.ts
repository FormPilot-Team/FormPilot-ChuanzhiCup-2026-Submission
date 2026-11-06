/**
 * Offline extractor: standard-video reference pose tracks -> per-chapter motion descriptors.
 *
 * Run (from apps/platform):
 *   node node_modules/.pnpm/vite-node@3.2.4_@types+node_de474a0b50d035fb47eb67fa144202a3/node_modules/vite-node/vite-node.mjs scripts/decision-model/extract-motion-descriptors.ts
 *
 * Reads only repository files (reference tracks + programme chapter windows + the frozen config).
 * It deliberately never reads catalogue caution/region tags, so tag agreement can be evaluated
 * as an independent comparison later. Output is a deterministic JSON file committed to the repo.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROUTINE_PROGRAMS } from '../../src/features/routines/programs'
import { parseReferenceTrack, type ReferenceFrame } from '../../src/features/routines/followAlong/referenceTrack'
import { bodyFrame, LM, trunkSideLeanDegrees, type BodyFrame, type Point } from '../../src/features/routines/analyzers/bodyFrame'

export const EXTRACTOR_VERSION = '1.0.1'
const ROOT = resolve(import.meta.dirname, '../..')
const CONFIG_PATH = resolve(import.meta.dirname, 'descriptor-config.json')
const OUTPUT_PATH = resolve(ROOT, 'src/features/coachAgent/decisionModel/motionDescriptors.json')

type FlagName = 'overhead' | 'bending' | 'balance' | 'twist' | 'deepKnee' | 'weightBearing'
type RegionName = 'shoulders' | 'arms' | 'neck' | 'trunk' | 'legs'
const FLAGS: FlagName[] = ['overhead', 'bending', 'balance', 'twist', 'deepKnee', 'weightBearing']
const REGIONS: RegionName[] = ['shoulders', 'arms', 'neck', 'trunk', 'legs']

interface Config {
  id: string
  minVisibility: number
  thresholds: { bendingTorsoRatio: number; balanceAnkleDiff: number; twistLogRatio: number; deepKneeDegrees: number; weightBearingAnkleMargin: number; overheadNoNoseMargin: number }
  chapterFlagRule: { minRunSeconds: number; minTotalSeconds: number; maxGapSeconds: number }
  reliability: { minValidFrameFraction: number; minValidSeconds: number }
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const round = (value: number, digits = 4) => Number(value.toFixed(digits))

function quantile(values: number[], q: number): number {
  if (!values.length) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position), upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}
const spread = (values: number[]) => values.length >= 3 ? quantile(values, 0.9) - quantile(values, 0.1) : Number.NaN

function angleDegrees(a: Point, b: Point, c: Point): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y }
  const norm = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)
  if (!(norm > 0)) return Number.NaN
  return (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / norm))) * 180) / Math.PI
}
/** Angle between shoulder->elbow and the downward vertical (0 = arm hanging, 180 = straight up). */
function upperArmElevation(shoulder: Point, elbow: Point): number {
  const dx = elbow.x - shoulder.x, dy = elbow.y - shoulder.y
  const norm = Math.hypot(dx, dy)
  if (!(norm > 0)) return Number.NaN
  return (Math.acos(Math.max(-1, Math.min(1, dy / norm))) * 180) / Math.PI
}

interface FrameMeasure {
  t: number
  flags: Record<FlagName, boolean>
  shoulderElevation: number
  elbowAngle: number
  earRatio: number
  earTilt: number
  trunkLean: number
  torsoVertical: number
  widthLogRatio: number
  kneeAngle: number
  hipHeight: number
}

function measureVideo(frames: ReadonlyArray<ReferenceFrame>, aspect: number, config: Config) {
  const bodies = frames.map(frame => ({ t: frame.t, body: frame.confidence > 0 ? bodyFrame(frame.landmarks, aspect, config.minVisibility) : null }))
  const valid = bodies.filter((item): item is { t: number; body: BodyFrame } => item.body !== null)
  const torsoScale = quantile(valid.map(item => item.body.torsoLength), 0.75)
  const widthRatios = valid.map(item => item.body.shoulderWidth / item.body.hipWidth).filter(Number.isFinite)
  const medianWidthRatio = quantile(widthRatios, 0.5)
  const earRatios: number[] = []
  for (const { body } of valid) {
    const le = body.point(LM.leftEar), re = body.point(LM.rightEar)
    if (le && re && body.shoulderWidth > 0) earRatios.push(Math.hypot(le.x - re.x, le.y - re.y) / body.shoulderWidth)
  }
  const medianEarRatio = quantile(earRatios, 0.5)
  const th = config.thresholds
  const measures: FrameMeasure[] = valid.map(({ t, body }) => {
    const p = (index: number) => body.point(index)
    const nose = p(LM.nose)
    const sides = [
      { shoulder: p(LM.leftShoulder), elbow: p(LM.leftElbow), wrist: p(LM.leftWrist), hip: p(LM.leftHip), knee: p(LM.leftKnee), ankle: p(LM.leftAnkle) },
      { shoulder: p(LM.rightShoulder), elbow: p(LM.rightElbow), wrist: p(LM.rightWrist), hip: p(LM.rightHip), knee: p(LM.rightKnee), ankle: p(LM.rightAnkle) },
    ]
    const overhead = sides.some(side => {
      if (!side.shoulder || !side.elbow || !side.wrist) return false
      const wristHigh = nose ? side.wrist.y < nose.y : side.wrist.y < side.shoulder.y - th.overheadNoNoseMargin * torsoScale
      return wristHigh && side.elbow.y < side.shoulder.y
    })
    const torsoVertical = (body.hipMid.y - body.shoulderMid.y) / torsoScale
    const bending = torsoVertical < th.bendingTorsoRatio || (nose !== null && nose.y > body.shoulderMid.y)
    const la = p(LM.leftAnkle), ra = p(LM.rightAnkle)
    const balance = la !== null && ra !== null && Math.abs(la.y - ra.y) > th.balanceAnkleDiff * torsoScale
    const widthLogRatio = Math.log((body.shoulderWidth / body.hipWidth) / medianWidthRatio)
    const twist = Number.isFinite(widthLogRatio) && Math.abs(widthLogRatio) > th.twistLogRatio
    const kneeAngles = sides.map(side => side.hip && side.knee && side.ankle ? angleDegrees(side.hip, side.knee, side.ankle) : Number.NaN).filter(Number.isFinite)
    const deepKnee = kneeAngles.some(angle => angle < th.deepKneeDegrees)
    const ankleLevel = la && ra ? Math.max(la.y, ra.y) : la?.y ?? ra?.y
    const weightBearing = ankleLevel !== undefined && sides.some(side => side.wrist !== null && side.wrist.y > ankleLevel - th.weightBearingAnkleMargin * torsoScale)
    const elevations = sides.map(side => side.shoulder && side.elbow ? upperArmElevation(side.shoulder, side.elbow) : Number.NaN).filter(Number.isFinite)
    const elbows = sides.map(side => side.shoulder && side.elbow && side.wrist ? angleDegrees(side.shoulder, side.elbow, side.wrist) : Number.NaN).filter(Number.isFinite)
    const le = p(LM.leftEar), re = p(LM.rightEar)
    return {
      t,
      flags: { overhead, bending, balance, twist, deepKnee, weightBearing },
      shoulderElevation: elevations.length ? Math.max(...elevations) : Number.NaN,
      elbowAngle: elbows.length ? Math.min(...elbows) : Number.NaN,
      earRatio: le && re ? (Math.hypot(le.x - re.x, le.y - re.y) / body.shoulderWidth) / medianEarRatio : Number.NaN,
      // 1.0.1: |dx| keeps the ear line in (-pi/2, pi/2]; 1.0.0 wrapped between +pi and -pi for a camera-facing head.
      earTilt: le && re ? Math.atan2(re.y - le.y, Math.abs(re.x - le.x)) : Number.NaN,
      trunkLean: trunkSideLeanDegrees(body),
      torsoVertical,
      widthLogRatio: Number.isFinite(widthLogRatio) ? widthLogRatio : Number.NaN,
      kneeAngle: kneeAngles.length ? Math.min(...kneeAngles) : Number.NaN,
      hipHeight: body.hipMid.y / torsoScale,
    }
  })
  return { measures, torsoScale, medianWidthRatio, medianEarRatio, totalFrames: frames.length }
}

/** Total seconds spent in runs of consecutive flagged frames that last at least minRun (gaps <= maxGap bridge). */
function sustainedSeconds(measures: FrameMeasure[], flag: FlagName, rule: Config['chapterFlagRule'], frameSeconds: number) {
  let total = 0, runStart: number | null = null, lastFlagged: number | null = null
  const close = () => {
    if (runStart !== null && lastFlagged !== null) {
      const duration = lastFlagged - runStart + frameSeconds
      if (duration >= rule.minRunSeconds) total += duration
    }
    runStart = null; lastFlagged = null
  }
  for (const measure of measures) {
    if (!measure.flags[flag]) continue
    if (lastFlagged !== null && measure.t - lastFlagged > rule.maxGapSeconds + frameSeconds) close()
    if (runStart === null) runStart = measure.t
    lastFlagged = measure.t
  }
  close()
  return total
}

function main() {
  const configText = readFileSync(CONFIG_PATH, 'utf8')
  const config = JSON.parse(configText) as Config
  const tracks: Array<{ programId: string; path: string; sha256: string; frames: number; fps: number }> = []
  const chapters: Array<Record<string, unknown> & { raw: Record<RegionName, number>; reliable: boolean }> = []
  for (const program of ROUTINE_PROGRAMS) {
    const relativePath = `public${program.video.poseTrackSrc}`
    const bytes = readFileSync(resolve(ROOT, relativePath))
    const track = parseReferenceTrack(JSON.parse(bytes.toString('utf8')))
    if (!track) throw new Error(`Unreadable reference track: ${relativePath}`)
    tracks.push({ programId: program.id, path: `apps/platform/${relativePath}`, sha256: sha256(bytes), frames: track.frames.length, fps: track.fps })
    const video = measureVideo(track.frames, track.width / track.height, config)
    const frameSeconds = 1 / track.fps
    for (const chapter of program.chapters) {
      const windowFrames = track.frames.filter(frame => frame.t >= chapter.startSeconds && frame.t < chapter.endSeconds).length
      const measures = video.measures.filter(item => item.t >= chapter.startSeconds && item.t < chapter.endSeconds)
      const validSeconds = measures.length * frameSeconds
      const validFraction = windowFrames ? measures.length / windowFrames : 0
      const reliable = validFraction >= config.reliability.minValidFrameFraction && validSeconds >= config.reliability.minValidSeconds
      const flags = Object.fromEntries(FLAGS.map(flag => {
        const seconds = sustainedSeconds(measures, flag, config.chapterFlagRule, frameSeconds)
        const fraction = measures.length ? measures.filter(item => item.flags[flag]).length / measures.length : 0
        return [flag, { sustainedSeconds: round(seconds, 2), frameFraction: round(fraction), flagged: reliable && seconds >= config.chapterFlagRule.minTotalSeconds }]
      }))
      const finite = (pick: (item: FrameMeasure) => number) => measures.map(pick).filter(Number.isFinite)
      const raw: Record<RegionName, number> = {
        shoulders: spread(finite(item => item.shoulderElevation)),
        arms: spread(finite(item => item.elbowAngle)),
        neck: spread(finite(item => item.earRatio)) + spread(finite(item => item.earTilt)),
        trunk: spread(finite(item => item.trunkLean)) / 90 + spread(finite(item => item.torsoVertical)) + spread(finite(item => Math.abs(item.widthLogRatio))),
        legs: spread(finite(item => item.kneeAngle)) / 180 + spread(finite(item => item.hipHeight)),
      }
      chapters.push({
        chapterId: chapter.id, programId: program.id, kind: chapter.kind,
        window: { startSeconds: chapter.startSeconds, endSeconds: chapter.endSeconds },
        trackFrames: windowFrames, validFrames: measures.length, validFraction: round(validFraction), reliable,
        flags, raw,
      })
    }
  }
  // Normalise raw region spreads against the catalogue's own distribution (p90 over reliable chapters).
  const scale = Object.fromEntries(REGIONS.map(region => [region, quantile(chapters.filter(item => item.reliable && Number.isFinite(item.raw[region])).map(item => item.raw[region]), 0.9)])) as Record<RegionName, number>
  const output = {
    schemaVersion: 1,
    id: 'fp-motion-descriptors/v1',
    extractorVersion: EXTRACTOR_VERSION,
    configId: config.id,
    configSha256: sha256(configText),
    dataOrigin: 'project reference pose tracks of the standard demonstration videos (single demonstrator, MediaPipe Pose Lite, 2D); not user data',
    validity: 'engineering 2D proxies for catalogue auditing and ranking refinement; not clinical range-of-motion or load measurements',
    tracks,
    regionScale: Object.fromEntries(REGIONS.map(region => [region, round(scale[region])])),
    chapters: chapters.map(item => ({
      ...item,
      raw: Object.fromEntries(REGIONS.map(region => [region, Number.isFinite(item.raw[region]) ? round(item.raw[region]) : null])),
      involvement: Object.fromEntries(REGIONS.map(region => [region, item.reliable && Number.isFinite(item.raw[region]) && scale[region] > 0 ? round(Math.min(1, item.raw[region] / scale[region]), 3) : null])),
    })),
  }
  const text = `${JSON.stringify(output, null, 1)}\n`
  writeFileSync(OUTPUT_PATH, text)
  console.log(JSON.stringify({ output: OUTPUT_PATH, sha256: sha256(text), chapters: chapters.length, reliable: chapters.filter(item => item.reliable).length }))
}

main()
