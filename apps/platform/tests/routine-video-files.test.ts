import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROUTINE_PROGRAMS } from '../src/features/routines/programs'

/** Reads just enough of an MP4 (box headers + moov) to name its codecs the way canPlayType expects them. */
function describeMp4(path: string) {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const header = Buffer.alloc(16)
    const top: Array<{ type: string; start: number; size: number }> = []
    for (let position = 0; position < size;) {
      readSync(fd, header, 0, 16, position)
      let boxSize = header.readUInt32BE(0)
      if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8))
      if (boxSize === 0) boxSize = size - position
      top.push({ type: header.toString('latin1', 4, 8), start: position, size: boxSize })
      position += boxSize
    }
    const moovBox = top.find((box) => box.type === 'moov')!
    const moov = Buffer.alloc(moovBox.size)
    readSync(fd, moov, 0, moovBox.size, moovBox.start)
    const find = (type: string, from = 0) => moov.indexOf(Buffer.from(type, 'latin1'), from)

    const avcC = find('avcC')
    const video = `avc1.${moov.subarray(avcC + 5, avcC + 8).toString('hex').toUpperCase()}`
    // esds → ES_Descriptor → DecoderConfigDescriptor (0x04) → DecoderSpecificInfo (0x05): 5 bits of audio object type.
    const esds = find('esds')
    const specificInfo = moov.indexOf(0x05, moov.indexOf(0x04, esds + 8))
    let cursor = specificInfo + 1
    while (moov[cursor] & 0x80) cursor += 1
    const audioObjectType = moov[cursor + 1] >> 3
    const mvhd = find('mvhd')
    const version = moov[mvhd + 4]
    const timescale = version === 1 ? moov.readUInt32BE(mvhd + 4 + 20) : moov.readUInt32BE(mvhd + 4 + 12)
    const duration = version === 1 ? Number(moov.readBigUInt64BE(mvhd + 4 + 24)) : moov.readUInt32BE(mvhd + 4 + 16)
    return {
      brand: top[0].type === 'ftyp' ? (() => { const b = Buffer.alloc(4); readSync(fd, b, 0, 4, 8); return b.toString('latin1') })() : null,
      moovFirst: top.findIndex((box) => box.type === 'moov') < top.findIndex((box) => box.type === 'mdat'),
      codecs: `${video}, mp4a.40.${audioObjectType}`,
      level: moov[avcC + 7],
      audioObjectType,
      durationSeconds: duration / timescale,
    }
  } finally {
    closeSync(fd)
  }
}

describe('routine standard video files', () => {
  it.each(ROUTINE_PROGRAMS.map((program) => [program.id, program] as const))('%s: the file matches the codecs and length the program declares', (_id, program) => {
    const file = describeMp4(`public${program.video.src}`)
    expect(file.codecs).toBe(program.video.codecs)
    // Chapters (and their end) must lie inside the file.
    expect(file.durationSeconds).toBeGreaterThanOrEqual(program.video.durationSeconds)
    expect(program.chapters.at(-1)!.endSeconds).toBeLessThanOrEqual(file.durationSeconds)
  })
})
