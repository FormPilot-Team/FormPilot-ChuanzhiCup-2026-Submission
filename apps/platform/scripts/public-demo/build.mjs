// Builds the public AI Coach demo (src/publicDemo) into dist-public-demo/ for server/coachAgent/demo.
// Competition mode (M1/M2 ACTIVE, as the offline package) + VITE_COACH_AGENT_MODE=public-demo. The public/ folder is
// NOT copied: no reference videos, pose tracks, MediaPipe models, coach portraits or game art go online. Only the
// project's own app icons are added from an explicit allow-list, and a SHA-256 manifest lists every published file.
import { createHash } from 'node:crypto'
import { copyFileSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = fileURLToPath(new URL('../..', import.meta.url))
const outDir = join(root, 'dist-public-demo')
/** Project-owned brand files only (FormPilot "F" icon, scripts/brand). Everything else in public/ stays offline. */
const PUBLIC_ALLOW = ['favicon.ico', 'favicon.svg', 'app-icon-192.png']

process.env.VITE_COACH_AGENT_MODE = 'public-demo'
rmSync(outDir, { recursive: true, force: true })
await build({ root, mode: 'competition', publicDir: false, logLevel: 'warn', build: { outDir, emptyOutDir: true } })
for (const name of PUBLIC_ALLOW) copyFileSync(join(root, 'public', name), join(outDir, name))

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (name !== 'PUBLIC_DEMO_MANIFEST.json') files.push({ path: relative(outDir, path).split(sep).join('/'), bytes: statSync(path).size, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })
  }
}
walk(outDir)
const media = files.filter((file) => /\.(mp4|webm|mp3|wav|task|tflite|wasm|binarypb)$/iu.test(file.path))
if (media.length) throw new Error(`public demo must not contain media or model files: ${media.map((file) => file.path).join(', ')}`)
writeFileSync(join(outDir, 'PUBLIC_DEMO_MANIFEST.json'), `${JSON.stringify({
  build: 'FormPilot public AI Coach demo', mode: 'competition + VITE_COACH_AGENT_MODE=public-demo', builtAt: new Date().toISOString(),
  data: 'synthetic demo dataset only (src/publicDemo/syntheticDataset.ts)', excluded: 'public/ (reference videos, pose tracks, MediaPipe models, wasm, coach portraits, orb video, game art)',
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), files,
}, null, 2)}\n`)
console.log(`public demo → ${outDir} (${files.length} files, ${(files.reduce((sum, file) => sum + file.bytes, 0) / 1024).toFixed(0)} kB)`)
