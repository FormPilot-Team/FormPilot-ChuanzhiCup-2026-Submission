#!/usr/bin/env node
/**
 * Web V1 visual system: turns the approved #52 prototype stylesheet
 * (docs/design/chuanzhi-web/formpilot-web/styles.css) into a scoped platform stylesheet.
 *
 * The rules are copied verbatim; only three mechanical changes are made so the prototype can live next to the
 * existing Tailwind pages without leaking into them:
 *   1. every selector is scoped under `.fpw` (`:root`, `html` and `body` become `.fpw` itself);
 *   2. `@keyframes` names get an `fpw-` prefix (and the `animation` declarations that use them);
 *   3. relative asset URLs point to `/web-v1/…` (files copied to `public/web-v1/`).
 * The output is placed in Tailwind's `components` layer so that utility classes still win where a page adds them.
 *
 * Usage: node scripts/build-web-v1-styles.mjs [source.css] [output.css] [source label]
 * Since 2026-11-09 the source is the PR #54 design refresh (AI Coach orb), exported with
 *   git show 44fd623124cd8e3e2beefae2dc743eca712d8100:docs/design/chuanzhi-web/formpilot-web/styles.css > <tmp>/styles.css
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(process.argv[2] ?? resolve(here, '../../../docs/design/chuanzhi-web/formpilot-web/styles.css'))
const output = resolve(process.argv[3] ?? resolve(here, '../src/styles/web-v1.css'))
const SOURCE_LABEL = process.argv[4] ?? 'docs/design/chuanzhi-web/formpilot-web/styles.css (PR #52)'
const SCOPE = '.fpw'

const css = readFileSync(source, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const keyframes = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]))

/** Split on commas that are not inside parentheses or brackets. */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '(' || char === '[') depth += 1
    if (char === ')' || char === ']') depth -= 1
    if (char === ',' && depth === 0) { parts.push(current); current = ''; continue }
    current += char
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

function scopeSelector(selector) {
  const root = /^(:root|html|body)(?=$|[\s.:#[>+~])/.exec(selector)
  if (root) return `${SCOPE}${selector.slice(root[0].length)}`
  return `${SCOPE} ${selector}`
}

function rewriteDeclarations(body) {
  let next = body.replace(/url\((['"]?)\.\/([^'")]+)\1\)/g, (_match, quote, path) => `url(${quote}/web-v1/${path}${quote})`)
  next = next.replace(/(animation(?:-name)?\s*:)([^;}]*)/g, (_match, property, value) => {
    let rewritten = value
    for (const name of keyframes) rewritten = rewritten.replace(new RegExp(`(^|[\\s,])${name}(?=$|[\\s,;])`, 'g'), `$1fpw-${name}`)
    return property + rewritten
  })
  return next
}

/** Find the index of the `}` that closes the block opened at `open`. */
function closingBrace(text, open) {
  let depth = 0
  let quote = null
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]
    if (quote) { if (char === quote && text[index - 1] !== '\\') quote = null; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '{') depth += 1
    if (char === '}') { depth -= 1; if (depth === 0) return index }
  }
  throw new Error(`Unbalanced block at ${open}`)
}

function transform(text, indent = '') {
  const out = []
  let cursor = 0
  while (cursor < text.length) {
    const open = text.indexOf('{', cursor)
    const semicolon = text.indexOf(';', cursor)
    if (open === -1) break
    // Statement at-rules (`@import …;`, `@charset …;`) before the next block.
    if (semicolon !== -1 && semicolon < open && text.slice(cursor, semicolon).trim().startsWith('@')) {
      out.push(`${indent}${text.slice(cursor, semicolon + 1).trim()}`)
      cursor = semicolon + 1
      continue
    }
    const prelude = text.slice(cursor, open).trim()
    const close = closingBrace(text, open)
    const body = text.slice(open + 1, close)
    cursor = close + 1
    if (!prelude) continue
    if (prelude.startsWith('@keyframes')) {
      const name = prelude.replace('@keyframes', '').trim()
      out.push(`${indent}@keyframes fpw-${name} {${body}}`)
    } else if (prelude.startsWith('@media') || prelude.startsWith('@supports') || prelude.startsWith('@container')) {
      out.push(`${indent}${prelude} {\n${transform(body, `${indent}  `)}\n${indent}}`)
    } else if (prelude.startsWith('@')) {
      out.push(`${indent}${prelude} {${body}}`)
    } else if (prelude.includes(';')) {
      // A stray fragment (the prototype has a truncated font @import) makes the browser drop this rule; drop it too.
      console.warn(`web-v1 styles: dropped invalid rule prelude "${prelude.slice(0, 60).replace(/\s+/g, ' ')}…"`)
    } else {
      const selectors = splitTopLevel(prelude).map(scopeSelector).join(', ')
      out.push(`${indent}${selectors} {${rewriteDeclarations(body)}}`)
    }
  }
  return out.join('\n')
}

const header = `/*
 * GENERATED by scripts/build-web-v1-styles.mjs from ${SOURCE_LABEL}.
 * Do not edit by hand: change the design source or the generator, then run
 *   node scripts/build-web-v1-styles.mjs
 * Platform-only additions live in src/styles/web-v1-platform.css.
 */
@layer theme, base, components, utilities;
@layer components {
${SCOPE} { min-height: 100vh; }
`
writeFileSync(output, `${header}${transform(css, '')}\n}\n`, 'utf8')
console.log(`web-v1 styles: ${source} -> ${output} (${keyframes.size} keyframes)`)
