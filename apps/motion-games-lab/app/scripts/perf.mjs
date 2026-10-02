// Performance run for Apple Picking against the production build (vite preview on :5181).
//   node scripts/perf.mjs --video <file.mjpeg|file.y4m> [--seconds 30] [--headed]
// Scenario "camera-model": Chromium fake camera fed from the video file → real MediaPipe model +
// Phaser rendering together. Scenario "synthetic": scripted player (many picks → pick latency).
// OS CPU / memory are sampled for the launched browser's own process tree only (Win32_Process).
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const VIDEO = opt('video', null)
const SECONDS = Number(opt('seconds', 30))
const HEADED = args.includes('--headed')
const OUT = path.resolve(opt('out', '../docs/stage-ab/perf.json'))
const BASE = 'http://127.0.0.1:5181'

function processTree(rootPid) {
  const json = execFileSync('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,KernelModeTime,UserModeTime,WorkingSetSize,Name | ConvertTo-Json -Compress'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const all = JSON.parse(json)
  const tree = new Set([rootPid])
  let grew = true
  while (grew) {
    grew = false
    for (const p of all) if (!tree.has(p.ProcessId) && tree.has(p.ParentProcessId)) { tree.add(p.ProcessId); grew = true }
  }
  const mine = all.filter((p) => tree.has(p.ProcessId))
  return {
    at: Date.now(),
    cpu100ns: mine.reduce((s, p) => s + Number(p.KernelModeTime) + Number(p.UserModeTime), 0),
    workingSetMB: mine.reduce((s, p) => s + Number(p.WorkingSetSize), 0) / 1048576,
    processes: mine.length,
  }
}

const pct = (values, q) => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return Math.round(s[Math.floor((s.length - 1) * q)] * 10) / 10
}

async function runScenario(name, launchArgs, query) {
  const server = await chromium.launchServer({ channel: 'msedge', headless: !HEADED, args: launchArgs })
  const browser = await chromium.connect(server.wsEndpoint())
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${BASE}/${query}`)
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  const click = (label) => page.getByRole('button', { name: label, exact: true }).first().click()
  await click('开始')
  await click('下一步')
  await click('打开摄像头')
  if (name.startsWith('camera-model-gpu') && !name.includes('cap')) {
    await page.waitForTimeout(6000)
    await page.screenshot({ path: path.join(path.dirname(OUT), 'screenshots', '12-camera-real-model.png') })
  }
  // get into the round: normal path, or the page's own fallbacks if the clip never satisfies framing
  const started = Date.now()
  let startPath = 'calibrated'
  while (Date.now() - started < 60_000) {
    if (await page.evaluate(() => window.__mgl?.controller?.status === 'playing')) break
    if (await page.getByRole('button', { name: '仍然开始' }).isVisible().catch(() => false)) { startPath = 'fallback-default-reach'; await click('仍然开始') }
    // the clip may never show a step's pose (e.g. arms always up): skip after a fair wait, like a player would
    if (Date.now() - started > 25_000 && await page.getByRole('button', { name: '跳过这一步' }).isVisible().catch(() => false)) { startPath = 'skipped-calibration-step'; await click('跳过这一步') }
    await page.waitForTimeout(500)
  }
  const calibration = await page.evaluate(() => window.__mgl?.session?.adapter.calibration().profile ?? null)
  await page.waitForFunction(() => window.__mgl?.controller?.status === 'playing', undefined, { timeout: 30_000 })
  await page.waitForTimeout(5000) // warm-up
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const rootPid = server.process().pid
  const os0 = processTree(rootPid)
  const m0 = await metric()
  const t0 = Date.now()
  const before = await page.evaluate(() => ({ longTasks: window.__mgl.perf.longTasks, longTaskMs: window.__mgl.perf.longTaskMs, frames: window.__mgl.perf.frameCount }))
  const samples = []
  const memory = []
  for (let i = 0; i < SECONDS; i += 1) {
    await page.waitForTimeout(1000)
    samples.push(await page.evaluate(() => {
      const d = window.__mgl.diagnostics()
      return { renderFps: window.__mgl.perf.renderFps(), inferenceFps: d.inferenceFps, tracked: d.tracking.body, status: window.__mgl.controller?.status ?? null }
    }))
    if (i % 10 === 9) memory.push(processTree(rootPid).workingSetMB)
  }
  const wallMs = Date.now() - t0
  const m1 = await metric()
  const os1 = processTree(rootPid)
  const end = await page.evaluate(() => {
    const c = window.__mgl.controller
    const d = window.__mgl.diagnostics()
    return {
      frameLatencies: c.frameLatencies, feedbackLatencies: c.feedbackLatencies, inferenceMsP95: d.inferenceMsP95,
      delegate: d.source.delegate, camera: `${d.source.cameraWidth}x${d.source.cameraHeight}@${d.source.cameraFrameRate}`,
      longTasks: window.__mgl.perf.longTasks, longTaskMs: window.__mgl.perf.longTaskMs, frames: window.__mgl.perf.frameCount,
      heapMB: window.__mgl.perf.heapMB(), picks: c.round.completed,
    }
  })
  await page.screenshot({ path: path.join(path.dirname(OUT), 'screenshots', `perf-${name}.png`) })
  await browser.close()
  await server.close()
  const fps = samples.map((s) => s.renderFps)
  const inf = samples.map((s) => s.inferenceFps)
  return {
    scenario: name,
    gpuRenderer: gpu,
    howRoundStarted: startPath,
    calibration: calibration ? { usedDefaults: calibration.usedDefaults, leftMaxDeg: Math.round(calibration.reach.left.maxElevationDeg), rightMaxDeg: Math.round(calibration.reach.right.maxElevationDeg) } : null,
    seconds: Math.round(wallMs / 1000),
    renderFps: { mean: Math.round((fps.reduce((a, b) => a + b, 0) / fps.length) * 10) / 10, p05: pct(fps, 0.05), min: Math.round(Math.min(...fps) * 10) / 10 },
    renderedFrames: end.frames - before.frames,
    inferenceFps: { mean: Math.round((inf.reduce((a, b) => a + b, 0) / inf.length) * 10) / 10, p05: pct(inf, 0.05) },
    inferenceMsP95: end.inferenceMsP95 && Math.round(end.inferenceMsP95 * 10) / 10,
    delegate: end.delegate,
    camera: end.camera,
    bodyTrackedShare: samples.filter((s) => s.tracked).length / samples.length,
    frameToRenderMs: { p50: pct(end.frameLatencies, 0.5), p95: pct(end.frameLatencies, 0.95), n: end.frameLatencies.length },
    pickToRenderMs: { p50: pct(end.feedbackLatencies, 0.5), p95: pct(end.feedbackLatencies, 0.95), n: end.feedbackLatencies.length },
    picks: end.picks,
    mainThreadBusyShare: Math.round(((m1.TaskDuration - m0.TaskDuration) / (wallMs / 1000)) * 1000) / 1000,
    scriptShare: Math.round(((m1.ScriptDuration - m0.ScriptDuration) / (wallMs / 1000)) * 1000) / 1000,
    longTasks: { count: end.longTasks - before.longTasks, ms: Math.round(end.longTaskMs - before.longTaskMs) },
    jsHeapMB: Math.round((m1.JSHeapUsedSize / 1048576) * 10) / 10,
    browserCpuPercentOfOneCore: Math.round(((os1.cpu100ns - os0.cpu100ns) / 1e4 / (os1.at - os0.at)) * 1000) / 10,
    browserCpuPercentOfMachine: Math.round(((os1.cpu100ns - os0.cpu100ns) / 1e4 / (os1.at - os0.at) / os.cpus().length) * 1000) / 10,
    browserWorkingSetMB: { start: Math.round(os0.workingSetMB), samples: memory.map(Math.round), end: Math.round(os1.workingSetMB) },
    browserProcesses: os1.processes,
    pageErrors: errors,
  }
}

const power = (() => {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Battery).BatteryStatus'], { encoding: 'utf8' }).trim()
  } catch { return 'unknown' }
})()
const report = {
  date: new Date().toISOString(),
  machine: { cpu: os.cpus()[0].model, logicalCores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1073741824), power: power === '2' ? 'AC' : power === '1' ? 'battery' : power },
  headed: HEADED,
  note: 'Fake camera = Chromium --use-file-for-fake-video-capture; it skips real sensor/USB latency, so frameToRender excludes camera exposure/transport. CPU% is the launched browser process tree only.',
  scenarios: [],
}
if (VIDEO) {
  report.video = path.basename(VIDEO)
  const fake = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${VIDEO}`]
  report.scenarios.push(await runScenario('camera-model-gpu', fake, ''))
  report.scenarios.push(await runScenario('camera-model-cpu', fake, '?delegate=cpu'))
  if (args.includes('--compare-cap')) report.scenarios.push(await runScenario('camera-model-gpu-cap60', fake, '?fpsLimit=60'))
}
report.scenarios.push(await runScenario('synthetic', [], '?source=synthetic&duration=180&seed=5'))
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
