/**
 * M1 data: window-level pose features from the committed reference tracks (real observations, single demonstrator).
 *   node <vite-node.mjs> scripts/decision-model/cdm/export-window-features.ts
 * Writes data/m1-windows.v1.json: one row per 3 s window (1.5 s hop) inside a chapter, plus chapter tags
 * from the catalogue (team-authored human annotation, not expert). Windows never cross chapter boundaries.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROUTINE_PROGRAMS } from '../../../src/features/routines/programs'
import { parseReferenceTrack } from '../../../src/features/routines/followAlong/referenceTrack'
import { bodyFrame, LM, trunkSideLeanDegrees, type Point } from '../../../src/features/routines/analyzers/bodyFrame'
import { COACH_KNOWLEDGE } from '../../../src/features/coachAgent/recommendation/catalogue'

const ROOT = resolve(import.meta.dirname, '../../..')
const WINDOW = 3, HOP = 1.5, MIN_VALID = 0.6
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const q = (v: number[], p: number) => { if (!v.length) return Number.NaN; const s = [...v].sort((a, b) => a - b); const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) }
const mean = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : Number.NaN
const std = (v: number[]) => { const m = mean(v); return v.length ? Math.sqrt(mean(v.map(x => (x - m) ** 2))) : Number.NaN }
const angle = (a: Point, b: Point, c: Point) => { const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y }; const n = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y); return n > 0 ? Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / n))) * 180 / Math.PI : Number.NaN }
const elevation = (s: Point, e: Point) => { const dx = e.x - s.x, dy = e.y - s.y, n = Math.hypot(dx, dy); return n > 0 ? Math.acos(Math.max(-1, Math.min(1, dy / n))) * 180 / Math.PI : Number.NaN }

/** Continuous per-frame signals (scale-free: torso-normalised or degrees). Flags are derived inside windows. */
const SIGNALS = ['elevMax', 'elevMin', 'elbowMin', 'wristHeightMax', 'wristAboveNose', 'trunkLeanAbs', 'torsoVertical', 'widthLogAbs',
  'kneeMin', 'kneeMax', 'ankleDiff', 'hipHeightRel', 'headDrop', 'earRatioRel', 'wristToFloorMin', 'vWrist', 'vAnkle', 'vNose', 'vHip'] as const
/** v2 (opt-in --v2): extra signals added for M1 v1.1 research; v1 output stays byte-identical. */
const V2 = process.argv.includes('--v2')
const SIGNALS_V2 = ['elevAsym', 'elbowAboveShoulder', 'wristSep', 'wristLateral', 'kneeLift', 'handsCross', 'headTilt'] as const
type Signal = typeof SIGNALS[number] | typeof SIGNALS_V2[number]
const ACTIVE: readonly Signal[] = V2 ? [...SIGNALS, ...SIGNALS_V2] : SIGNALS

function main() {
  const rows: Array<Record<string, unknown>> = []
  const tracks: Array<{ programId: string; sha256: string }> = []
  for (const program of ROUTINE_PROGRAMS) {
    const bytes = readFileSync(resolve(ROOT, `public${program.video.poseTrackSrc}`))
    tracks.push({ programId: program.id, sha256: sha256(bytes) })
    const track = parseReferenceTrack(JSON.parse(bytes.toString('utf8')))!
    const aspect = track.width / track.height
    const bodies = track.frames.map(f => ({ t: f.t, b: f.confidence > 0 ? bodyFrame(f.landmarks, aspect) : null }))
    const valid = bodies.filter(x => x.b) as Array<{ t: number; b: NonNullable<ReturnType<typeof bodyFrame>> }>
    const S = q(valid.map(x => x.b.torsoLength), 0.75)
    const medWidth = q(valid.map(x => x.b.shoulderWidth / x.b.hipWidth), 0.5)
    const medHip = q(valid.map(x => x.b.hipMid.y), 0.5)
    const earRatios = valid.map(({ b }) => { const l = b.point(LM.leftEar), r = b.point(LM.rightEar); return l && r ? Math.hypot(l.x - r.x, l.y - r.y) / b.shoulderWidth : Number.NaN }).filter(Number.isFinite)
    const medEar = q(earRatios, 0.5)
    let prev: { t: number; pts: Record<string, Point | null> } | null = null
    const frames = valid.map(({ t, b }) => {
      const p = (i: number) => b.point(i)
      const nose = p(LM.nose)
      const sides = [[LM.leftShoulder, LM.leftElbow, LM.leftWrist, LM.leftHip, LM.leftKnee, LM.leftAnkle], [LM.rightShoulder, LM.rightElbow, LM.rightWrist, LM.rightHip, LM.rightKnee, LM.rightAnkle]]
        .map(([s, e, w, h, k, a]) => ({ s: p(s), e: p(e), w: p(w), h: p(h), k: p(k), a: p(a) }))
      const elev = sides.map(x => x.s && x.e ? elevation(x.s, x.e) : Number.NaN).filter(Number.isFinite)
      const elbow = sides.map(x => x.s && x.e && x.w ? angle(x.s, x.e, x.w) : Number.NaN).filter(Number.isFinite)
      const knee = sides.map(x => x.h && x.k && x.a ? angle(x.h, x.k, x.a) : Number.NaN).filter(Number.isFinite)
      const wristH = sides.map(x => x.w ? (b.shoulderMid.y - x.w.y) / S : Number.NaN).filter(Number.isFinite)
      const la = p(LM.leftAnkle), ra = p(LM.rightAnkle)
      const floor = la && ra ? Math.max(la.y, ra.y) : la?.y ?? ra?.y
      const toFloor = sides.map(x => x.w && floor !== undefined ? (floor - x.w.y) / S : Number.NaN).filter(Number.isFinite)
      const le = p(LM.leftEar), re = p(LM.rightEar)
      const pts = { lw: p(LM.leftWrist), rw: p(LM.rightWrist), la, ra, nose, hip: b.hipMid }
      const speed = (keys: string[]) => {
        if (!prev || t - prev.t <= 0 || t - prev.t > 0.5) return Number.NaN
        const d = keys.map(k => { const a = pts[k as keyof typeof pts], c = prev!.pts[k]; return a && c ? Math.hypot(a.x - c.x, a.y - c.y) / S / (t - prev!.t) : Number.NaN }).filter(Number.isFinite)
        return d.length ? Math.max(...d) : Number.NaN
      }
      const value: Record<Signal, number> = {
        elevMax: elev.length ? Math.max(...elev) : Number.NaN, elevMin: elev.length ? Math.min(...elev) : Number.NaN,
        elbowMin: elbow.length ? Math.min(...elbow) : Number.NaN,
        wristHeightMax: wristH.length ? Math.max(...wristH) : Number.NaN,
        wristAboveNose: nose && sides.some(x => x.w && x.w.y < nose.y) ? 1 : 0,
        trunkLeanAbs: Math.abs(trunkSideLeanDegrees(b)),
        torsoVertical: (b.hipMid.y - b.shoulderMid.y) / S,
        widthLogAbs: Math.abs(Math.log((b.shoulderWidth / b.hipWidth) / medWidth)),
        kneeMin: knee.length ? Math.min(...knee) : Number.NaN, kneeMax: knee.length ? Math.max(...knee) : Number.NaN,
        ankleDiff: la && ra ? Math.abs(la.y - ra.y) / S : Number.NaN,
        hipHeightRel: (medHip - b.hipMid.y) / S,
        headDrop: nose ? (nose.y - b.shoulderMid.y) / S : Number.NaN,
        earRatioRel: le && re ? (Math.hypot(le.x - re.x, le.y - re.y) / b.shoulderWidth) / medEar : Number.NaN,
        wristToFloorMin: toFloor.length ? Math.min(...toFloor) : Number.NaN,
        vWrist: speed(['lw', 'rw']), vAnkle: speed(['la', 'ra']), vNose: speed(['nose']), vHip: speed(['hip']),
        elevAsym: elev.length === 2 ? Math.abs(elev[0] - elev[1]) : Number.NaN,
        elbowAboveShoulder: sides.some(x => x.s && x.e && x.e.y < x.s.y) ? 1 : 0,
        wristSep: pts.lw && pts.rw ? Math.hypot(pts.lw.x - pts.rw.x, pts.lw.y - pts.rw.y) / S : Number.NaN,
        wristLateral: Math.max(...sides.map(x => x.w ? Math.abs(x.w.x - b.shoulderMid.x) / S : 0)),
        kneeLift: Math.max(...sides.map(x => x.k && x.h ? (x.k.y < b.hipMid.y + 0.5 * S ? (b.hipMid.y + 0.5 * S - x.k.y) / S : 0) : 0)),
        handsCross: pts.lw && pts.rw && p(LM.leftShoulder) && p(LM.rightShoulder) ? Number(Math.sign(pts.lw.x - pts.rw.x) !== Math.sign(p(LM.leftShoulder)!.x - p(LM.rightShoulder)!.x)) : Number.NaN,
        headTilt: le && re ? Math.abs(Math.atan2(re.y - le.y, Math.abs(re.x - le.x))) : Number.NaN,
      }
      prev = { t, pts }
      return { t, value }
    })
    for (const chapter of program.chapters) {
      for (let start = chapter.startSeconds; start + WINDOW <= chapter.endSeconds + 1e-9; start += HOP) {
        const inWin = frames.filter(f => f.t >= start && f.t < start + WINDOW)
        const expected = track.frames.filter(f => f.t >= start && f.t < start + WINDOW).length
        if (!expected || inWin.length / expected < MIN_VALID) continue
        const feat: Record<string, number> = {}
        for (const s of ACTIVE) {
          const v = inWin.map(f => f.value[s]).filter(Number.isFinite)
          feat[`${s}_mean`] = mean(v); feat[`${s}_p10`] = q(v, 0.1); feat[`${s}_p90`] = q(v, 0.9); feat[`${s}_std`] = std(v)
        }
        rows.push({ programId: program.id, chapterId: chapter.id, chapterKind: chapter.kind, start: Number(start.toFixed(2)), validFrames: inWin.length, features: Object.fromEntries(Object.entries(feat).map(([k, v]) => [k, Number.isFinite(v) ? Number(v.toFixed(5)) : null])) })
      }
    }
  }
  const chapters = COACH_KNOWLEDGE.filter(e => e.kind === 'chapter').map(e => ({ chapterId: e.id, programId: e.programId, regions: e.regions, caution: e.caution, focuses: e.focuses, launchable: e.href !== null }))
  const out = {
    schemaVersion: 1, id: V2 ? 'fp-cdm-m1-windows/v2' : 'fp-cdm-m1-windows/v1', generatedBy: 'scripts/decision-model/cdm/export-window-features.ts',
    dataOrigin: 'real observations: reference pose tracks of standard demonstration videos (single demonstrator, MediaPipe Pose Lite 2D)',
    labelOrigin: 'catalogue regions/caution tags authored by the FormPilot team (human annotation, not expert or clinical)',
    window: { seconds: WINDOW, hopSeconds: HOP, minValidFraction: MIN_VALID }, tracks, featureNames: Object.keys(rows[0].features as object), chapters, rows,
  }
  const text = JSON.stringify(out)
  writeFileSync(resolve(import.meta.dirname, V2 ? 'data/m1-windows.v2.json' : 'data/m1-windows.v1.json'), text)
  console.log(JSON.stringify({ windows: rows.length, features: out.featureNames.length, chapters: new Set(rows.map(r => r.chapterId)).size, sha256: sha256(text), bytes: text.length }))
}
main()
