// Copies the MediaPipe WASM runtime from this app's own pinned dependency into public/wasm.
// No file is read from FormPilot_v3; the runtime always matches the installed package version.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = path.join(app, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const target = path.join(app, 'public', 'wasm')
fs.mkdirSync(target, { recursive: true })
let copied = 0
for (const name of fs.readdirSync(source)) {
  const from = path.join(source, name)
  const to = path.join(target, name)
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue
  fs.copyFileSync(from, to)
  copied += 1
}
console.log(`mediapipe wasm: ${copied} file(s) copied to public/wasm`)
