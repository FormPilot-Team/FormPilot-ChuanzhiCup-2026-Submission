import type { RoutineChapter, RoutineProgram, RoutineScope } from './types'

/** `?form=<chapterId>` selects one numbered form; anything else (missing, unknown, opening/closing) is the full routine. */
export function parseRoutineScope(program: RoutineProgram, formParam: string | null | undefined): RoutineScope {
  const chapter = formParam ? program.chapters.find((item) => item.id === formParam) : undefined
  return chapter?.kind === 'form' ? { kind: 'form', chapterId: chapter.id } : { kind: 'full' }
}

export function scopeChapters(program: RoutineProgram, scope: RoutineScope): ReadonlyArray<RoutineChapter> {
  if (scope.kind === 'full') return program.chapters
  const chapter = program.chapters.find((item) => item.id === scope.chapterId)
  return chapter ? [chapter] : program.chapters
}

export interface ScopeBounds {
  startSeconds: number
  endSeconds: number
}

export function scopeBounds(program: RoutineProgram, scope: RoutineScope): ScopeBounds {
  const chapters = scopeChapters(program, scope)
  return { startSeconds: chapters[0].startSeconds, endSeconds: chapters[chapters.length - 1].endSeconds }
}

/** The chapter playing at `seconds`; times before the first or after the last chapter clamp to it. */
export function chapterAt(program: RoutineProgram, seconds: number): RoutineChapter {
  const chapters = program.chapters
  if (!(seconds >= chapters[0].startSeconds)) return chapters[0]
  for (let index = chapters.length - 1; index >= 0; index -= 1) {
    if (seconds >= chapters[index].startSeconds) return chapters[index]
  }
  return chapters[0]
}

export function chapterDisplayName(chapter: RoutineChapter): string {
  return chapter.label === chapter.name ? chapter.name : `${chapter.label} · ${chapter.name}`
}

export function scopeTitle(program: RoutineProgram, scope: RoutineScope): string {
  if (scope.kind === 'full') return `${program.title} · 整套跟练`
  const chapter = scopeChapters(program, scope)[0]
  return `${program.title} · ${chapterDisplayName(chapter)}`
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formCount(program: RoutineProgram): number {
  return program.chapters.filter((chapter) => chapter.kind === 'form').length
}
