// Copies the NSIS installer produced by `tauri build` to <lab>/release/ under an ASCII file name and
// records its size and SHA-256 (release/SHA256SUMS.txt). Run after `pnpm desktop:build`.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const conf = JSON.parse(fs.readFileSync(path.join(app, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const bundle = path.join(app, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const built = fs.readdirSync(bundle).filter((f) => f.endsWith('-setup.exe') && f.includes(`_${conf.version}_`))
if (built.length !== 1) throw new Error(`expected one installer for ${conf.version} in ${bundle}, found: ${built.join(', ') || 'none'}`)
const release = path.join(app, '..', 'release')
fs.mkdirSync(release, { recursive: true })
const name = `MotionGamesLab-Setup-${conf.version}.exe`
const target = path.join(release, name)
fs.copyFileSync(path.join(bundle, built[0]), target)
const data = fs.readFileSync(target)
const sha = crypto.createHash('sha256').update(data).digest('hex')
const line = `${sha}  ${name}  (${data.length} bytes, ${conf.productName} ${conf.version})`
const sums = path.join(release, 'SHA256SUMS.txt')
const old = fs.existsSync(sums) ? fs.readFileSync(sums, 'utf8').split('\n').filter((l) => l.trim() && !l.includes(name)) : []
fs.writeFileSync(sums, [...old, line].join('\n') + '\n')
console.log(`${target}\n${line}`)
