import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseReferenceTrack } from '../src/features/routines/followAlong/referenceTrack'
import { buildChapters, chineseNumeral, findRoutineProgram, getRoutineProgram, isRoutineId, ROUTINE_PROGRAMS } from '../src/features/routines/programs'
import { chapterAt, chapterDisplayName, formatClock, formCount, parseRoutineScope, scopeBounds, scopeChapters, scopeTitle } from '../src/features/routines/scope'

const PUBLIC = path.resolve(__dirname, '..', 'public')

describe('routine programs', () => {
  it('registers the four routines found in the teammate version under their real names', () => {
    expect(ROUTINE_PROGRAMS.map((program) => [program.id, program.title, program.subtitle])).toEqual([
      ['baduanjin', '八段锦', '健身气功 · 八式'],
      ['taijiquan', '太极拳', '二十四式'],
      ['wuqinxi', '五禽戏', '健身气功 · 五戏十动'],
      ['yijinjing', '易筋经', '健身气功 · 十二势'],
    ])
    expect(isRoutineId('wuqinxi')).toBe(true)
    expect(isRoutineId('taichi')).toBe(false)
    expect(findRoutineProgram('nope')).toBeUndefined()
    expect(() => getRoutineProgram('nope' as 'baduanjin')).toThrow()
  })

  it('uses the chapters captioned in each standard video', () => {
    const names = (id: Parameters<typeof getRoutineProgram>[0]) => getRoutineProgram(id).chapters.map((chapter) => chapter.name)
    expect(names('baduanjin')).toEqual([
      '预备势', '两手托天理三焦', '左右开弓似射雕', '调理脾胃须单举', '五劳七伤往后瞧',
      '摇头摆尾去心火', '两手攀足固肾腰', '攒拳怒目增气力', '背后七颠百病消', '收势',
    ])
    // The footage is the 24-form sequence; the teammate's metadata listed an unrelated 8-form outline.
    expect(names('taijiquan')).toEqual([
      '起势', '左右野马分鬃', '白鹤亮翅', '搂膝拗步', '手挥琵琶', '倒卷肱', '左揽雀尾', '右揽雀尾',
      '单鞭', '云手', '单鞭', '高探马', '右蹬脚', '双峰贯耳', '转身左蹬脚', '左下势独立',
      '右下势独立', '左右穿梭', '海底针', '闪通臂', '转身搬拦捶', '如封似闭', '十字手', '收势',
    ])
    expect(getRoutineProgram('wuqinxi').chapters.map((chapter) => chapterDisplayName(chapter))).toEqual([
      '起势 · 起势调息', '虎戏 · 虎举', '虎戏 · 虎扑', '鹿戏 · 鹿抵', '鹿戏 · 鹿奔', '熊戏 · 熊运',
      '熊戏 · 熊晃', '猿戏 · 猿提', '猿戏 · 猿摘', '鸟戏 · 鸟伸', '鸟戏 · 鸟飞', '收势 · 引气归元',
    ])
    expect(names('yijinjing')).toEqual([
      '预备势', '韦驮献杵第一势', '韦驮献杵第二势', '韦驮献杵第三势', '摘星换斗势', '倒拽九牛尾势', '出爪亮翅势',
      '九鬼拔马刀势', '三盘落地势', '青龙探爪势', '卧虎扑食势', '打躬势', '掉尾势', '收势',
    ])
    expect(ROUTINE_PROGRAMS.map(formCount)).toEqual([8, 24, 10, 12])
  })

  it('keeps chapters contiguous from the start of the video to its end', () => {
    for (const program of ROUTINE_PROGRAMS) {
      const chapters = program.chapters
      expect(chapters[0].startSeconds, program.id).toBe(0)
      expect(chapters.at(-1)?.endSeconds, program.id).toBe(program.video.durationSeconds)
      chapters.forEach((chapter, index) => {
        expect(chapter.index).toBe(index)
        expect(chapter.endSeconds).toBeGreaterThan(chapter.startSeconds)
        if (index > 0) expect(chapter.startSeconds, chapter.id).toBe(chapters[index - 1].endSeconds)
      })
      const numbers = chapters.filter((chapter) => chapter.kind === 'form').map((chapter) => chapter.formNumber)
      expect(numbers).toEqual(numbers.map((_value, index) => index + 1))
      expect(new Set(chapters.map((chapter) => chapter.id)).size).toBe(chapters.length)
    }
  })

  it('pins caption-measured boundaries that the teammate timings had wrong', () => {
    const start = (id: Parameters<typeof getRoutineProgram>[0], chapterId: string) => getRoutineProgram(id).chapters.find((chapter) => chapter.id === chapterId)?.startSeconds
    // Teammate: 203 s / 230 s / 298 s — the captions change at 222 s / 295.5 s / 366 s.
    expect(start('baduanjin', 'bdj-3')).toBe(222)
    expect(start('baduanjin', 'bdj-4')).toBe(295.5)
    expect(start('baduanjin', 'bdj-5')).toBe(366)
    expect(start('wuqinxi', 'wqx-1')).toBe(66.5)
    expect(start('yijinjing', 'yjj-12')).toBe(614.5)
    expect(start('taijiquan', 'tjq-24')).toBe(337.5)
  })

  it('writes Chinese form numbers up to 二十四', () => {
    expect([1, 9, 10, 11, 19, 20, 24].map(chineseNumeral)).toEqual(['一', '九', '十', '十一', '十九', '二十', '二十四'])
    expect(getRoutineProgram('taijiquan').chapters[23].label).toBe('第二十四式')
    expect(getRoutineProgram('yijinjing').chapters[12].label).toBe('第十二势')
    expect(() => chineseNumeral(0)).toThrow()
  })

  it('rejects chapter tables that overlap or run past the video', () => {
    const chapter = (id: string, startSeconds: number) => ({ id, kind: 'form' as const, label: id, name: id, startSeconds, cue: '' })
    expect(() => buildChapters([chapter('a', 0), chapter('b', 0)], 10)).toThrow()
    expect(() => buildChapters([chapter('a', 0), chapter('b', 12)], 10)).toThrow()
    expect(buildChapters([chapter('a', 0), chapter('b', 4)], 10).map((item) => item.endSeconds)).toEqual([4, 10])
  })

  it('ships every referenced video, poster and pose track, and each track covers its video', () => {
    for (const program of ROUTINE_PROGRAMS) {
      for (const src of [program.video.src, program.video.posterSrc, program.video.poseTrackSrc]) {
        expect(existsSync(path.join(PUBLIC, src)), src).toBe(true)
      }
      const track = parseReferenceTrack(JSON.parse(readFileSync(path.join(PUBLIC, program.video.poseTrackSrc), 'utf8')))
      expect(track, program.id).toBeDefined()
      expect(track?.asset).toBe(program.video.src)
      expect(track?.fps).toBe(10)
      expect(Math.abs((track?.duration ?? 0) - program.video.durationSeconds), program.id).toBeLessThan(0.5)
      const posed = track?.frames.filter((frame) => frame.confidence > 0).length ?? 0
      expect(posed / (track?.frames.length ?? 1), program.id).toBeGreaterThan(0.98)
    }
    expect(getRoutineProgram('taijiquan').video.contentAspect).toBeCloseTo(4 / 3)
    expect(getRoutineProgram('baduanjin').video.contentAspect).toBeCloseTo(16 / 9)
  })
})

describe('routine scope', () => {
  const program = getRoutineProgram('baduanjin')

  it('selects one numbered form and falls back to the full routine otherwise', () => {
    expect(parseRoutineScope(program, 'bdj-3')).toEqual({ kind: 'form', chapterId: 'bdj-3' })
    expect(parseRoutineScope(program, 'bdj-open')).toEqual({ kind: 'full' })
    expect(parseRoutineScope(program, 'tjq-1')).toEqual({ kind: 'full' })
    expect(parseRoutineScope(program, null)).toEqual({ kind: 'full' })
  })

  it('bounds a scope by its chapters', () => {
    expect(scopeBounds(program, { kind: 'full' })).toEqual({ startSeconds: 0, endSeconds: 728.3 })
    expect(scopeBounds(program, { kind: 'form', chapterId: 'bdj-3' })).toEqual({ startSeconds: 222, endSeconds: 295.5 })
    expect(scopeChapters(program, { kind: 'form', chapterId: 'missing' })).toBe(program.chapters)
    expect(scopeTitle(program, { kind: 'form', chapterId: 'bdj-3' })).toBe('八段锦 · 第三式 · 调理脾胃须单举')
    expect(scopeTitle(program, { kind: 'full' })).toBe('八段锦 · 整套跟练')
  })

  it('finds the chapter playing at a time, clamping outside the video', () => {
    expect(chapterAt(program, -3).id).toBe('bdj-open')
    expect(chapterAt(program, 41.99).id).toBe('bdj-open')
    expect(chapterAt(program, 42).id).toBe('bdj-1')
    expect(chapterAt(program, 700).id).toBe('bdj-8')
    expect(chapterAt(program, 9999).id).toBe('bdj-close')
    expect(chapterAt(program, Number.NaN).id).toBe('bdj-open')
  })

  it('formats clock times', () => {
    expect([0, 59.9, 60, 728.3, -4].map(formatClock)).toEqual(['0:00', '0:59', '1:00', '12:08', '0:00'])
  })
})
