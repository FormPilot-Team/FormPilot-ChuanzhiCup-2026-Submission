// FormPilot app icon: one SVG source, rasterised by Edge (Playwright) and packed into the Windows .ico.
//
//   node scripts/brand/generate-app-icon.mjs
//
// Writes:
//   public/favicon.svg                  web tab icon (the full mark)
//   public/favicon.ico                  16/32/48 fallback for hosts without SVG favicons
//   public/app-icon-192.png             in-app / touch icon
//   reviewer_exe/build/icon.svg         source copy next to the packaging assets
//   reviewer_exe/build/icon.ico         Windows EXE, taskbar and window icon (16–256)
//   reviewer_exe/build/icon.png         512 px, electron-builder fallback
//   reviewer_exe/build/png/<n>.png      every raster size, for review
//
// The mark: a rounded blue tile with a white “F” whose top stroke rises into a tracking dot — movement and a pose
// landmark leading it. Sizes ≤ 24 px use the same shape with heavier strokes and no gap before the dot, so it stays a
// clean silhouette in the taskbar and title bar.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(path.join(root, 'package.json'))
const { chromium } = require('@playwright/test')

const TILE = '<defs><linearGradient id="fp-tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#fp-tile)"/>'

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${TILE}<path d="M19 50V29.5Q19 21 27.5 19.8L35 18.8M19 36H30.5" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="46" cy="16.8" r="5.6" fill="#fff"/></svg>\n`

const SMALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${TILE}<path d="M20 50V29.5Q20 21 28.5 19.8L38 18.5M20 36H32" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><circle cx="45.5" cy="17.2" r="6.8" fill="#fff"/></svg>\n`

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

function svgFor(size) {
  return size <= 24 ? SMALL_SVG : ICON_SVG
}

/** ICO with PNG-compressed entries (Windows Vista+ reads PNG entries at every size). */
function packIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + 16 * images.length
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

async function render(browser, svg, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`)
  await page.locator('img').evaluate((img) => img.decode())
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  await page.close()
  return png
}

const write = (relative, data) => {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
  console.log(`${relative}  ${fs.statSync(file).size} B`)
}

const browser = await chromium.launch({ channel: 'msedge' })
try {
  const rendered = new Map()
  for (const size of PNG_SIZES) rendered.set(size, await render(browser, svgFor(size), size))
  write('public/favicon.svg', ICON_SVG)
  write('public/favicon.ico', packIco([16, 32, 48].map((size) => ({ size, png: rendered.get(size) }))))
  write('public/app-icon-192.png', await render(browser, ICON_SVG, 192))
  write('reviewer_exe/build/icon.svg', ICON_SVG)
  write('reviewer_exe/build/icon.ico', packIco(ICO_SIZES.map((size) => ({ size, png: rendered.get(size) }))))
  write('reviewer_exe/build/icon.png', rendered.get(512))
  for (const size of PNG_SIZES) write(`reviewer_exe/build/png/${size}.png`, rendered.get(size))
} finally {
  await browser.close()
}
