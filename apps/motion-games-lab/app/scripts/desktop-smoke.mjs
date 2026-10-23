// Release smoke / performance run against the INSTALLED desktop app (not a dev server).
//   node scripts/desktop-smoke.mjs --exe "<install dir>\MotionGamesLab.exe" [--video clip.mjpeg]
//        [--games apple,boating,archery] [--seconds 20] [--duration 60] [--offline] [--perf]
//        [--shots dir] [--out file.json] [--port 9333] [--query delegate=gpu] [--worker-fail] [--throttle 6]
//        [--checks fullscreen,debug]
//
// The app is launched as a normal process; only the WebView2 environment variable
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is set for it (a standard WebView2 switch, not an app feature):
//   --remote-debugging-port   so this script can drive the real window over CDP
//   --use-file-for-fake-video-capture (with --video)   a reference clip instead of the webcam; without
//                             --video the real webcam is used (no screenshots are saved then)
//   --proxy-server=<dead port> --proxy-bypass-list=<-loopback>   (--offline) every network request
//                             that would leave the machine fails, as with the network unplugged
// Per game: Hub → intro → positioning → 打开摄像头 → calibration (or the app's own skip / fallback
// buttons if a clip never shows a step's pose) → play → pause → 返回游戏选择; then the camera tracks
// must be ended. Every request URL seen by the page and the pose worker is recorded. The window is
// closed like a user would (WM_CLOSE) and no process may remain.
import { chromium } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const EXE = opt('exe', null)
const VIDEO = opt('video', null)
const GAMES = opt('games', 'apple,boating,archery').split(',')
const SECONDS = Number(opt('seconds', 20))
const DURATION = Number(opt('duration', 90))
const OFFLINE = args.includes('--offline')
const PERF = args.includes('--perf')
const SHOTS = opt('shots', null)
const OUT = opt('out', null)
const PORT = Number(opt('port', 9333))
const QUERY = opt('query', '')
const WORKER_FAIL = args.includes('--worker-fail')
const THROTTLE = Number(opt('throttle', 0))
const CHECKS = opt('checks', '').split(',').filter(Boolean)
if (!EXE || !fs.existsSync(EXE)) throw new Error(`--exe not found: ${EXE}`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const round1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)
const pct = (values, q) => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return round1(s[Math.floor((s.length - 1) * q)])
}

function processes() {
  const json = execFileSync('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,KernelModeTime,UserModeTime,WorkingSetSize,Name,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(json)
}
function processTree(rootPid) {
  const all = processes()
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
/** processes belonging to this app: the exe itself and WebView2 processes using its data folder */
function appProcesses() {
  const exeName = path.basename(EXE).toLowerCase()
  return processes().filter((p) => (p.Name ?? '').toLowerCase() === exeName || /com\.motiongameslab\.desktop/i.test(p.CommandLine ?? ''))
    .map((p) => ({ pid: p.ProcessId, name: p.Name }))
}

function installFrameRecorder() {
  const rec = { deltas: [], loaf: [], last: 0, on: true }
  window.__perfRec = rec
  const loop = (t) => {
    if (rec.last) rec.deltas.push(t - rec.last)
    rec.last = t
    if (rec.on) requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) rec.loaf.push(e.duration) }).observe({ type: 'long-animation-frame', buffered: false })
  } catch { /* unsupported */ }
}

async function main() {
  if (appProcesses().length) throw new Error('the app is already running — close it first')
  const browserArgs = [`--remote-debugging-port=${PORT}`]
  if (VIDEO) browserArgs.push('--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${VIDEO}`)
  if (OFFLINE) browserArgs.push('--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>')
  const launchedAt = Date.now()
  const child = spawn(EXE, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArgs.join(' ') }, stdio: 'ignore', detached: false })
  let browser = null
  for (let i = 0; i < 60 && !browser; i += 1) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`) } catch { await sleep(500) }
  }
  if (!browser) throw new Error('could not attach to the app over CDP')
  const context = browser.contexts()[0]
  let page = context.pages()[0]
  for (let i = 0; i < 40 && !page; i += 1) { await sleep(250); page = context.pages()[0] }
  await page.waitForLoadState('domcontentloaded')
  const firstPaintMs = Date.now() - launchedAt
  const origin = new URL(page.url()).origin
  const requests = new Set()
  const errors = []
  page.on('request', (r) => requests.add(r.url()))
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('worker', (w) => requests.add(`worker:${w.url()}`))
  // test-only: make the Worker constructor fail, as on a system where module workers cannot start
  if (WORKER_FAIL) await context.addInitScript(() => { window.Worker = class { constructor() { throw new Error('worker blocked for the fallback test') } } })

  const report = {
    exe: EXE, exeBytes: fs.statSync(EXE).size, video: VIDEO ? path.basename(VIDEO) : 'real webcam', offline: OFFLINE,
    date: new Date().toISOString(),
    machine: { cpu: os.cpus()[0].model, logicalCores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1073741824) },
    origin, firstPaintMs, games: [],
  }

  // the Hub as a first-time user sees it
  await page.goto(`${origin}/`)
  await page.getByTestId('card-apple').waitFor({ timeout: 20_000 })
  const hubText = await page.locator('body').innerText()
  report.hub = {
    title: await page.title(),
    productName: await page.locator('h1').first().innerText(),
    fullscreenButton: await page.getByTestId('fullscreen-button').count() === 1,
    bannedWordsFound: ['Vite', 'localhost', '127.0.0.1', 'Phase', 'Playwright', 'debug', 'Debug', 'JSON', 'landmark'].filter((w) => hubText.includes(w)),
    webgl: await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl')
      const ext = gl?.getExtension('WEBGL_debug_renderer_info')
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
    }),
  }
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, 'desktop-00-hub.png') })
  }

  for (const game of GAMES) {
    await page.goto(`${origin}/?duration=${DURATION}${QUERY ? `&${QUERY}` : ''}`)
    if (THROTTLE > 1) {
      const cdp = await context.newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })
    }
    const click = (label) => page.getByRole('button', { name: label, exact: true }).first().click()
    await page.getByTestId(`card-${game}`).getByRole('button', { name: '开始' }).click()
    await click('下一步')
    const privacy = await page.locator('body').innerText()
    await click('打开摄像头')
    const started = Date.now()
    let startPath = 'calibrated'
    while (Date.now() - started < 90_000) {
      if (await page.evaluate(() => window.__mgl?.controller?.status === 'playing')) break
      if (await page.getByRole('button', { name: '仍然开始' }).isVisible().catch(() => false)) { startPath = 'fallback-default-reach'; await click('仍然开始') }
      if (Date.now() - started > 20_000 && await page.getByRole('button', { name: '跳过这一步' }).isVisible().catch(() => false)) { startPath = 'skipped-calibration-step'; await click('跳过这一步') }
      await sleep(500)
    }
    const cameraError = await page.locator('.camera-error, [data-testid="camera-error"]').first().innerText().catch(() => null)
    const playing = await page.evaluate(() => window.__mgl?.controller?.status === 'playing')
    const g = { game, startPath, playing, cameraError, privacyNoticeShown: privacy.includes('不会录像或上传') }
    if (playing) {
      await page.evaluate(() => { window.__smokeTracks = window.__mgl.session.source.stream()?.getTracks() ?? [] })
      g.cameraTrack = await page.evaluate(() => window.__smokeTracks.map((t) => ({ kind: t.kind, state: t.readyState, label: t.label ? 'present' : '', settings: (({ width, height, frameRate }) => ({ width, height, frameRate }))(t.getSettings()) })))
      await sleep(3000) // warm-up
      const tree0 = processTree(child.pid)
      if (PERF) await page.evaluate(installFrameRecorder)
      const seen = new Map()
      const samples = []
      const memory = []
      for (let i = 0; i < SECONDS; i += 1) {
        await sleep(1000)
        const s = await page.evaluate(() => {
          const d = window.__mgl.diagnostics()
          return {
            fps: d.inferenceFps, thread: d.inferenceThread, delegate: d.source.delegate, workerFallback: d.source.workerFallback,
            tracked: d.tracking.body, events: d.recentEvents.map((e) => `${e.at}|${e.type}`), score: window.__mgl.controller?.round?.score ?? null,
            msP50: d.inferenceMsP50, msP95: d.inferenceMsP95, camera: `${d.source.cameraWidth}x${d.source.cameraHeight}@${d.source.cameraFrameRate}`,
          }
        })
        for (const e of s.events) seen.set(e, e.split('|')[1])
        samples.push(s)
        if (i % 5 === 4) memory.push(processTree(child.pid).workingSetMB)
      }
      const tree1 = processTree(child.pid)
      const last = samples[samples.length - 1]
      const counts = {}
      for (const type of seen.values()) counts[type] = (counts[type] ?? 0) + 1
      Object.assign(g, {
        inferenceThread: last.thread, delegate: last.delegate, workerFallback: last.workerFallback, camera: last.camera,
        inferenceFpsMean: round1(samples.reduce((a, s) => a + s.fps, 0) / samples.length),
        inferenceMsP50: round1(last.msP50), inferenceMsP95: round1(last.msP95),
        bodyTrackedShare: samples.filter((s) => s.tracked).length / samples.length,
        motionEvents: counts, score: last.score,
        cpuPercentOfMachine: Math.round(((tree1.cpu100ns - tree0.cpu100ns) / 1e4 / (tree1.at - tree0.at) / os.cpus().length) * 1000) / 10,
        cpuPercentOfOneCore: Math.round(((tree1.cpu100ns - tree0.cpu100ns) / 1e4 / (tree1.at - tree0.at)) * 1000) / 10,
        workingSetMB: { start: Math.round(tree0.workingSetMB), samples: memory.map(Math.round), end: Math.round(tree1.workingSetMB), processes: tree1.processes },
      })
      if (PERF) {
        const rec = await page.evaluate(() => { const r = window.__perfRec; r.on = false; return { deltas: r.deltas, loaf: r.loaf, heapMB: window.__mgl.perf.heapMB() } })
        const d = rec.deltas
        const total = d.reduce((a, b) => a + b, 0)
        g.frames = {
          count: d.length, averageFps: round1((d.length * 1000) / total), p50Ms: pct(d, 0.5), p95Ms: pct(d, 0.95), p99Ms: pct(d, 0.99),
          maxMs: round1(Math.max(...d)), over20ms: d.filter((x) => x > 20).length, over33ms: d.filter((x) => x > 33).length,
          longAnimationFrames: rec.loaf.length, jsHeapMB: round1(rec.heapMB),
        }
      }
      if (SHOTS && VIDEO) {
        // the camera mini-window would show the reference clip (licence unknown): hide it for the picture
        if (await page.getByRole('button', { name: '隐藏小窗' }).isVisible().catch(() => false)) await click('隐藏小窗')
        await sleep(600)
        await page.screenshot({ path: path.join(SHOTS, `desktop-${game}-playing.png`) })
      }
      // leave the game like a player: pause → 返回游戏选择
      await page.getByTestId('pause-button').click()
      await page.getByRole('dialog', { name: '已暂停' }).getByRole('button', { name: '返回游戏选择' }).click()
      await page.getByTestId('card-apple').waitFor({ timeout: 10_000 })
      await sleep(500)
      g.tracksEndedAfterReturningToHub = await page.evaluate(() => window.__smokeTracks.length > 0 && window.__smokeTracks.every((t) => t.readyState === 'ended'))
    }
    report.games.push(g)
    console.log(JSON.stringify(g))
  }

  if (CHECKS.includes('fullscreen')) report.fullscreen = await fullscreenCheck(page, origin)
  if (CHECKS.includes('debug')) report.debugEntry = await debugCheck(page, origin)

  // resources the pose worker loaded (its own requests)
  for (const w of page.workers()) {
    try { for (const u of await w.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name))) requests.add(u) } catch { /* worker gone */ }
  }
  for (const u of await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name))) requests.add(u)
  const all = [...requests]
  report.requests = {
    total: all.length,
    external: all.filter((u) => {
      const raw = u.replace(/^worker:/, '')
      if (/^(data|blob):/.test(raw)) return false
      try { return !['tauri.localhost', 'ipc.localhost'].includes(new URL(raw).hostname) } catch { return true }
    }),
    sample: all.slice(0, 40),
  }
  report.pageErrors = errors

  // close the window like a user (WM_CLOSE), then nothing of the app may remain
  await browser.close().catch(() => undefined)
  execFileSync('powershell', ['-NoProfile', '-Command', `$p = Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow() }`])
  const closeStart = Date.now()
  while (appProcesses().length && Date.now() - closeStart < 15_000) await sleep(300)
  report.closeMs = Date.now() - closeStart
  report.processesLeftAfterClose = appProcesses()
  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
  }
  console.log(JSON.stringify({ origin, firstPaintMs, hub: report.hub, external: report.requests.external, pageErrors: errors, closeMs: report.closeMs, left: report.processesLeftAfterClose }))
}

/** 全屏 button → the window covers the whole screen; Esc leaves; F11 toggles. */
async function fullscreenCheck(page, origin) {
  await page.goto(`${origin}/`)
  await page.getByTestId('fullscreen-button').waitFor()
  const size = () => page.evaluate(() => ({ inner: [innerWidth, innerHeight], screen: [screen.width, screen.height], label: document.querySelector('[data-testid="fullscreen-button"]').textContent }))
  const before = await size()
  await page.getByTestId('fullscreen-button').click()
  await sleep(1200)
  const full = await size()
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop-01-fullscreen-hub.png') })
  await page.keyboard.press('Escape')
  await sleep(1200)
  const afterEsc = await size()
  await page.keyboard.press('F11')
  await sleep(1200)
  const f11 = await size()
  await page.keyboard.press('F11')
  await sleep(1200)
  const afterF11 = await size()
  const covers = (s) => s.inner[0] === s.screen[0] && s.inner[1] === s.screen[1]
  return { before, full, afterEsc, f11, afterF11, pass: !covers(before) && covers(full) && !covers(afterEsc) && covers(f11) && !covers(afterF11) }
}

/** Ctrl+Shift+D → reload with ?debug=1 → the developer panel shows the inference path; again → gone. */
async function debugCheck(page, origin) {
  await page.goto(`${origin}/`)
  await page.getByTestId('card-apple').waitFor()
  await page.keyboard.press('Control+Shift+D')
  await page.waitForURL(/debug=1/, { timeout: 10_000 })
  await page.getByTestId('card-apple').getByRole('button', { name: '开始' }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '打开摄像头', exact: true }).click()
  await page.getByTestId('debug-panel').waitFor({ timeout: 20_000 })
  await sleep(6000)
  const panel = await page.getByTestId('debug-panel').innerText()
  if (SHOTS) {
    await page.addStyleTag({ content: 'video, .mirror, .camera-preview, [data-mirror-mode] { visibility: hidden !important; }' })
    await page.screenshot({ path: path.join(SHOTS, 'desktop-02-debug-panel.png') })
  }
  await page.keyboard.press('Control+Shift+D')
  await page.waitForURL((u) => !u.searchParams.has('debug'), { timeout: 10_000 })
  await page.getByTestId('card-apple').waitFor()
  const hiddenAgain = await page.getByTestId('debug-panel').count() === 0
  const pick = (re) => (panel.match(re) ?? [])[0] ?? null
  return { panelShown: true, hiddenAgain, thread: pick(/worker|main/), delegate: pick(/\b(CPU|GPU)\b/), excerpt: panel.split(/\r?\n/).filter((l) => /infer|deleg|thread|fps|frame/i.test(l)).slice(0, 12) }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
