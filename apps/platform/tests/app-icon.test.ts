import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FORMPILOT_MARK } from '../src/components/layout/FormPilotMark'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url))

function icoSizes(ico: Buffer): number[] {
  expect(ico.readUInt16LE(0)).toBe(0)
  expect(ico.readUInt16LE(2)).toBe(1)
  return Array.from({ length: ico.readUInt16LE(4) }, (_, index) => ico.readUInt8(6 + index * 16) || 256)
}

describe('FormPilot app icon', () => {
  it('header mark and favicon share one geometry', () => {
    const svg = read('public/favicon.svg').toString('utf8')
    expect(svg).toContain(`d="${FORMPILOT_MARK.stroke}"`)
    expect(svg).toContain(`<circle cx="${FORMPILOT_MARK.dot.cx}" cy="${FORMPILOT_MARK.dot.cy}" r="${FORMPILOT_MARK.dot.r}"`)
    expect(svg).toContain(`rx="${FORMPILOT_MARK.tileRadius}"`)
    for (const color of FORMPILOT_MARK.gradient) expect(svg).toContain(color)
    expect(read('reviewer_exe/build/icon.svg').toString('utf8')).toBe(svg)
  })

  it('ships every Windows size in the EXE icon and the small ones in favicon.ico', () => {
    expect(icoSizes(read('reviewer_exe/build/icon.ico'))).toEqual([16, 24, 32, 48, 64, 128, 256])
    expect(icoSizes(read('public/favicon.ico'))).toEqual([16, 32, 48])
  })

  it('is wired into the page, the window and electron-builder', () => {
    const html = read('index.html').toString('utf8')
    expect(html).toContain('href="/favicon.ico"')
    expect(html).toContain('href="/favicon.svg"')
    const pkg = JSON.parse(read('reviewer_exe/package.json').toString('utf8')) as { build: { win: { icon: string }; files: string[]; asarUnpack: string[] } }
    expect(pkg.build.win.icon).toBe('build/icon.ico')
    expect(pkg.build.files).toContain('build/icon.ico')
    expect(pkg.build.asarUnpack).toContain('build/icon.ico')
    expect(read('reviewer_exe/src/main.cjs').toString('utf8')).toMatch(/icon: windowIcon/)
  })
})
