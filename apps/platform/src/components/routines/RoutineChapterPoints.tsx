import { ListChecks } from 'lucide-react'
import { chapterPoints } from '../../features/routines/followAlong/liveChecks'
import { chapterDisplayName } from '../../features/routines/scope'
import type { RoutineChapter, RoutineProgram } from '../../features/routines/types'
import { cn } from '../../lib/cn'
import { ROUTINE_ACCENT } from './routineTheme'

/**
 * 本段要点, under the standard video: the chapter's cue and its main movement requirements from the Scoring v2.1
 * registry. Chapters without their own requirements (opening, closing) show the cue and what the page watches.
 */
export function RoutineChapterPoints({ program, chapter }: { program: RoutineProgram; chapter: RoutineChapter }) {
  const accent = ROUTINE_ACCENT[program.accent]
  const { source, points } = chapterPoints(program.id, chapter)
  return (
    <section className="panel min-w-0 p-4 xl:flex-1" aria-labelledby="routine-points-title" data-testid="routine-chapter-points" data-points-source={source} data-points-chapter={chapter.id}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-xl', accent.soft, accent.text)}><ListChecks size={18} aria-hidden="true" /></span>
        <h2 id="routine-points-title" className="shrink-0 font-bold text-slate-900">本段要点</h2>
        <span className={cn('ml-auto min-w-0 truncate rounded-md px-2 py-0.5 text-xs font-semibold', accent.chip)}>{chapterDisplayName(chapter)}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-pretty text-sm leading-6 text-slate-600">{chapter.cue}</p>
      {points.length ? (
        <ul className="mt-2 grid gap-1.5" aria-label="本段动作要点">
          {points.map((point) => (
            <li key={point.id} className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-3 py-1.5 text-sm leading-5" data-testid="routine-chapter-point" title={point.cue}>
              <span className={cn('size-1.5 shrink-0 rounded-full', accent.fill)} aria-hidden="true" />
              <span className="shrink-0 font-semibold text-slate-900">{point.name}</span>
              {point.cue && point.cue !== point.name ? <span className="min-w-0 truncate text-xs text-slate-500">{point.cue}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">本段以跟随示范为主，将重点观察整体姿态与节奏同步。</p>
      )}
    </section>
  )
}
