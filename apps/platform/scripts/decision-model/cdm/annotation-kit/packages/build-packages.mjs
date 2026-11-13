// Builds the two independent annotation packages (A1, A2) for the minimum human check on the 6 frozen test families.
//   node scripts/decision-model/cdm/annotation-kit/packages/build-packages.mjs --out <dir>      (run from apps/platform)
// Each package: the offline test-families kit, GUIDELINES.md, its own README and SHA256SUMS.txt. Packages differ only in the
// annotator ID (the kit derives its item order from the ID). Nothing here creates, edits or simulates labels.
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const out = argv.includes('--out') ? resolve(argv[argv.indexOf('--out') + 1]) : null
if (!out) throw new Error('--out <dir> required')
const KIT = resolve(import.meta.dirname, '..')
const template = readFileSync(resolve(import.meta.dirname, 'ANNOTATOR_README.template.md'), 'utf8')
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const result = []
for (const id of ['A1', 'A2']) {
  const dir = resolve(out, `fp-cdm-annotation-package-${id}`)
  mkdirSync(dir, { recursive: true })
  const files = ['fp-cdm-annotation-v1-testfamilies.html', 'GUIDELINES.md']
  for (const f of files) copyFileSync(resolve(KIT, f), resolve(dir, f))
  writeFileSync(resolve(dir, `README-${id}.md`), template.replaceAll('{{ID}}', id))
  const all = [...files, `README-${id}.md`]
  writeFileSync(resolve(dir, 'SHA256SUMS.txt'), all.map(f => `${sha(resolve(dir, f))}  ${f}`).join('\n') + '\n')
  result.push({ id, dir, files: Object.fromEntries(all.map(f => [f, sha(resolve(dir, f))])) })
}
writeFileSync(resolve(out, 'packages.json'), `${JSON.stringify({ builtAt: new Date().toISOString(), kitSha256: sha(resolve(KIT, 'fp-cdm-annotation-v1-testfamilies.html')), guidelinesSha256: sha(resolve(KIT, 'GUIDELINES.md')), packages: result }, null, 2)}\n`)
console.log(JSON.stringify(result.map(r => [r.id, r.dir])))
