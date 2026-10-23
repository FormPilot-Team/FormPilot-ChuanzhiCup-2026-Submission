// Performance run for one game against a production build served by `vite preview`.
//   node scripts/perf.mjs --game apple|boating|archery --video <file.mjpeg> [--seconds 30] [--headed]
//        [--scenarios default,workergpu,main,synthetic] [--base http://127.0.0.1:5181] [--label after] [--out file.json]
// Scenarios (Chromium fake camera fed from the video file → real MediaPipe model + Phaser rendering):
//   "default"   = the shipped path: inference in a Worker, CPU delegate first (AUTO);
//   "workergpu" = Worker with the GPU delegate (?delegate=gpu);
//   "main"      = ?inference=main: inference on the main thread, GPU→CPU — the pre-fix path;
//   "synthetic" = scripted player, no model.
// Old builds ignore the unknown query flags, so "default" on an old build measures that build's path.
//
// Frame pacing is measured from the page itself, independent of the app's own counters, so the same
// script measures old and new builds: every requestAnimationFrame interval (→ average FPS, p50/p95/p99/
// max frame time, frames over 20/33/50 ms) and every long animation frame (LoAF, ≥ 50 ms) / long task.
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
const GAME = opt('game', 'apple')
const LABEL = opt('label', 'current')
const OUT = path.resolve(opt('out', `../docs/round-1-fixes/perf-${GAME}-${LABEL}.json`))
const SCENARIOS = opt('scenarios', 'default,synthetic').split(',')
const BASE = opt('base', 'http://127.0.0.1:5181')
const SHOTS = path.join(path.dirname(OUT), 'screenshots')

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

const round1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)
const pct = (values, q) => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return round1(s[Math.floor((s.length - 1) * q)])
}

/** Installed after the warm-up: records every rAF interval and every long animation frame / task. */
function installFrameRecorder() {
  const rec = { deltas: [], loaf: [], longTasks: [], last: 0, on: true }
  window.__perfRec = rec
  const loop = (t) => {
    if (rec.last) rec.deltas.push(t - rec.last)
    rec.last = t
    if (rec.on) requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const scripts = (e.scripts ?? []).map((s) => `${s.invokerType}:${s.invoker || s.sourceFunctionName || '?'}`.slice(0, 80))
        rec.loaf.push({ duration: e.duration, blocking: e.blockingDuration ?? 0, scripts: scripts.slice(0, 3) })
      }
    }).observe({ type: 'long-animation-frame', buffered: false })
  } catch { /* LoAF unsupported */ }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) rec.longTasks.push(e.duration)
    }).observe({ type: 'longtask', buffered: false })
  } catch { /* unsupported */ }
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
  await page.getByTestId(`card-${GAME}`).getByRole('button', { name: '开始' }).click()
  await click('下一步')
  await click('打开摄像头')
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
  await page.waitForFunction(() => window.__mgl?.controller?.status === 'playing', undefined, { timeout: 30_000 })
  await page.waitForTimeout(5000) // warm-up
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const rootPid = server.process().pid
  const os0 = processTree(rootPid)
  const m0 = await metric()
  await page.evaluate(installFrameRecorder)
  const t0 = Date.now()
  const samples = []
  const memory = []
  for (let i = 0; i < SECONDS; i += 1) {
    await page.waitForTimeout(1000)
    samples.push(await page.evaluate(() => {
      const d = window.__mgl.diagnostics()
      return { inferenceFps: d.inferenceFps, tracked: d.tracking.body, status: window.__mgl.controller?.status ?? null }
    }))
    if (i % 10 === 9) memory.push(processTree(rootPid).workingSetMB)
  }
  const wallMs = Date.now() - t0
  const m1 = await metric()
  const os1 = processTree(rootPid)
  const end = await page.evaluate(() => {
    const rec = window.__perfRec
    rec.on = false
    const c = window.__mgl.controller
    const d = window.__mgl.diagnostics()
    return {
      deltas: rec.deltas, loaf: rec.loaf, longTasks: rec.longTasks,
      frameLatencies: c.frameLatencies, feedbackLatencies: c.feedbackLatencies,
      inferenceMsP50: d.inferenceMsP50 ?? null, inferenceMsP95: d.inferenceMsP95, inferenceThread: d.inferenceThread ?? 'main (pre-fix build)',
      motionMsP95: d.motionMsP95 ?? null, framesDropped: d.framesDropped ?? null,
      delegate: d.source.delegate, camera: `${d.source.cameraWidth}x${d.source.cameraHeight}@${d.source.cameraFrameRate}`,
      heapMB: window.__mgl.perf.heapMB(), score: c.round.score,
    }
  })
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `perf-${GAME}-${LABEL}-${name}.png`) })
  await browser.close()
  await server.close()
  const d = end.deltas
  const total = d.reduce((a, b) => a + b, 0)
  const inf = samples.map((s) => s.inferenceFps)
  const over = (ms) => d.filter((x) => x > ms).length
  return {
    scenario: name,
    gpuRenderer: gpu,
    howRoundStarted: startPath,
    seconds: Math.round(wallMs / 1000),
    frames: {
      count: d.length,
      averageFps: round1((d.length * 1000) / total),
      p50Ms: pct(d, 0.5),
      p95Ms: pct(d, 0.95),
      p99Ms: pct(d, 0.99),
      maxMs: round1(Math.max(...d)),
      over20ms: over(20),
      over33ms: over(33),
      over50ms: over(50),
      /** share of frames taking more than twice the median interval (visible hitches) */
      hitchShare: Math.round((d.filter((x) => x > 2 * (pct(d, 0.5) ?? 0)).length / Math.max(1, d.length)) * 1000) / 1000,
    },
    longAnimationFrames: {
      count: end.loaf.length,
      maxMs: end.loaf.length ? round1(Math.max(...end.loaf.map((l) => l.duration))) : 0,
      blockingMs: round1(end.loaf.reduce((a, l) => a + l.blocking, 0)),
      topScripts: [...new Set(end.loaf.flatMap((l) => l.scripts))].slice(0, 6),
    },
    longTasks: { count: end.longTasks.length, ms: Math.round(end.longTasks.reduce((a, b) => a + b, 0)) },
    inference: {
      thread: end.inferenceThread,
      fpsMean: round1(inf.reduce((a, b) => a + b, 0) / inf.length),
      fpsP05: pct(inf, 0.05),
      msP50: round1(end.inferenceMsP50),
      msP95: round1(end.inferenceMsP95),
      mainThreadMotionMsP95: round1(end.motionMsP95),
      framesDroppedWhileBusy: end.framesDropped,
    },
    delegate: end.delegate,
    camera: end.camera,
    bodyTrackedShare: samples.filter((s) => s.tracked).length / samples.length,
    frameToRenderMs: { p50: pct(end.frameLatencies, 0.5), p95: pct(end.frameLatencies, 0.95), n: end.frameLatencies.length },
    eventToRenderMs: { p50: pct(end.feedbackLatencies, 0.5), p95: pct(end.feedbackLatencies, 0.95), n: end.feedbackLatencies.length },
    score: end.score,
    mainThreadBusyShare: Math.round(((m1.TaskDuration - m0.TaskDuration) / (wallMs / 1000)) * 1000) / 1000,
    scriptShare: Math.round(((m1.ScriptDuration - m0.ScriptDuration) / (wallMs / 1000)) * 1000) / 1000,
    jsHeapMB: round1(m1.JSHeapUsedSize / 1048576),
    browserCpuPercentOfOneCore: Math.round(((os1.cpu100ns - os0.cpu100ns) / 1e4 / (os1.at - os0.at)) * 1000) / 10,
    browserCpuPercentOfMachine: Math.round(((os1.cpu100ns - os0.cpu100ns) / 1e4 / (os1.at - os0.at) / os.cpus().length) * 1000) / 10,
    browserWorkingSetMB: { start: Math.round(os0.workingSetMB), samples: memory.map(Math.round), end: Math.round(os1.workingSetMB) },
    pageErrors: errors,
  }
}

const power = (() => {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Battery).BatteryStatus'], { encoding: 'utf8' }).trim()
  } catch { return 'unknown' }
})()
const report = {
  game: GAME,
  label: LABEL,
  date: new Date().toISOString(),
  machine: { cpu: os.cpus()[0].model, logicalCores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1073741824), power: power === '2' ? 'AC' : power === '1' ? 'battery' : power },
  headed: HEADED,
  note: 'Frame times are requestAnimationFrame intervals measured in the page (display refresh 240 Hz → 4.2 ms ideal). Fake camera = Chromium --use-file-for-fake-video-capture; it skips real sensor/USB latency, so frameToRender excludes camera exposure/transport. CPU% is the launched browser process tree only.',
  scenarios: [],
}
const fake = VIDEO ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${VIDEO}`] : null
if (VIDEO) report.video = path.basename(VIDEO)
for (const scenario of SCENARIOS) {
  if (scenario === 'synthetic') report.scenarios.push(await runScenario('synthetic', [], '?source=synthetic&duration=180&seed=5'))
  else if (!fake) continue
  else if (scenario === 'default') report.scenarios.push(await runScenario('camera-model-default', fake, ''))
  else if (scenario === 'workergpu') report.scenarios.push(await runScenario('camera-model-worker-gpu', fake, '?delegate=gpu'))
  else if (scenario === 'main') report.scenarios.push(await runScenario('camera-model-main-thread', fake, '?inference=main'))
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
for (const s of report.scenarios) {
  console.log(`${GAME} ${LABEL} ${s.scenario}: fps ${s.frames.averageFps} p95 ${s.frames.p95Ms} p99 ${s.frames.p99Ms} max ${s.frames.maxMs} >20ms ${s.frames.over20ms} >33ms ${s.frames.over33ms} hitch ${s.frames.hitchShare} | inf ${s.inference.thread} ${s.inference.fpsMean} fps p95 ${s.inference.msP95} ms | LoAF ${s.longAnimationFrames.count}`)
}
