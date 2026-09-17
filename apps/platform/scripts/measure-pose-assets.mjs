import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const LANDMARK_INDEX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

function metrics(frame) {
  const at = (name) => frame.landmarks[LANDMARK_INDEX[name]]
  const shoulderMid = midpoint(at('leftShoulder'), at('rightShoulder'))
  const hipMid = midpoint(at('leftHip'), at('rightHip'))
  const kneeMid = midpoint(at('leftKnee'), at('rightKnee'))
  const shoulderWidth = distance(at('leftShoulder'), at('rightShoulder'))
  const hipWidth = distance(at('leftHip'), at('rightHip'))
  const kneeWidth = distance(at('leftKnee'), at('rightKnee'))
  const ankleWidth = distance(at('leftAnkle'), at('rightAnkle'))
  const torsoLength = distance(shoulderMid, hipMid)
  const leftLegLength = distance(at('leftHip'), at('leftKnee')) + distance(at('leftKnee'), at('leftAnkle'))
  const rightLegLength = distance(at('rightHip'), at('rightKnee')) + distance(at('rightKnee'), at('rightAnkle'))
  return {
    poseConfidence: frame.confidence,
    minimumRequiredVisibility: Math.min(...['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'].map((name) => at(name).visibility)),
    shoulderWidth,
    hipWidth,
    kneeWidth,
    ankleWidth,
    kneeSpreadRatio: kneeWidth / hipWidth,
    kneeWidthShoulderRatio: kneeWidth / shoulderWidth,
    ankleWidthShoulderRatio: ankleWidth / shoulderWidth,
    hipKneeSeparation: (kneeMid.y - hipMid.y) / torsoLength,
    kneeHeightDiff: Math.abs(at('leftKnee').y - at('rightKnee').y) / torsoLength,
    kneeHeightDiffShoulder: Math.abs(at('leftKnee').y - at('rightKnee').y) / shoulderWidth,
    torsoLean: Math.atan2(Math.abs(shoulderMid.x - hipMid.x), Math.max(Math.abs(shoulderMid.y - hipMid.y), 1e-8)) * 180 / Math.PI,
    torsoCenterOffset: Math.abs((shoulderMid.x + hipMid.x) / 2 - 0.5) / shoulderWidth,
    kneeAnkleHorizontalOffset: (Math.abs(at('leftKnee').x - at('leftAnkle').x) + Math.abs(at('rightKnee').x - at('rightAnkle').x)) / (2 * shoulderWidth),
    legSymmetryDiff: Math.abs(leftLegLength - rightLegLength) / Math.max((leftLegLength + rightLegLength) / 2, 1e-8),
  }
}

async function main() {
  const args = process.argv.slice(2)
  let anchorOut
  let canonicalPoseId = 'squat.BOTTOM'
  const sources = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--anchor-out') anchorOut = args[++index]
    else if (args[index] === '--canonical-pose') canonicalPoseId = args[++index]
    else sources.push(args[index])
  }
  if (!sources.length) throw new Error('Pass one or more public asset paths, for example /assets/coach-squat.png')
  if (anchorOut && sources.length !== 1) throw new Error('--anchor-out requires exactly one asset source')
  const baseUrl = process.env.AI_COACH_BASE_URL ?? 'http://127.0.0.1:4173'
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    await page.goto(`${baseUrl}/?demo=1&debug=1&exercise=squat`)
    await page.waitForFunction(() => {
      const detector = globalThis.__poseDetector
      return detector && (detector.initializationCount > 0 || detector.initializeCalls > 0)
    }, undefined, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: '暂停训练' }).click()
    for (const source of sources) {
      const detected = await page.evaluate(async (assetSource) => {
        const detector = globalThis.__poseDetector
        if (!detector) throw new Error('Pose detector is not exposed in development mode')
        const image = new Image()
        image.src = assetSource
        await image.decode()
        let frame = null
        globalThis.__poseMeasurementTimestamp = (globalThis.__poseMeasurementTimestamp ?? performance.now() + 10_000) + 200
        for (let index = 0; index < 3; index += 1) {
          frame = detector.detect(image, globalThis.__poseMeasurementTimestamp + index * 40)
        }
        globalThis.__poseMeasurementTimestamp += 120
        if (!frame) throw new Error(`No pose detected for ${assetSource}`)
        return { width: image.naturalWidth, height: image.naturalHeight, ...frame }
      }, source)
      process.stdout.write(`${JSON.stringify({ source, width: detected.width, height: detected.height, metrics: metrics(detected), landmarks: detected.landmarks })}\n`)
      if (anchorOut) {
        const named = Object.fromEntries(Object.entries(LANDMARK_INDEX).map(([name, index]) => {
          const point = detected.landmarks[index]
          return [name, { x: point.x, y: point.y, z: point.z, visibility: point.visibility }]
        }))
        await writeFile(anchorOut, `${JSON.stringify({
          schemaVersion: 1,
          asset: source,
          image: { width: detected.width, height: detected.height },
          canonicalPoseId,
          detector: 'MediaPipe Pose Landmarker Lite',
          poseConfidence: detected.confidence,
          capturedAt: new Date().toISOString().slice(0, 10),
          landmarks: named,
        }, null, 2)}\n`, 'utf8')
      }
    }
  } finally {
    await browser.close()
  }
}

await main()
