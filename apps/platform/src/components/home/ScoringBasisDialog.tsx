import { Activity, BookCheck, SlidersHorizontal, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { SCORING_BASIS } from '../../features/scoring/scoringBasis'

function Layer({ index, icon: Icon, title, children }: { index: number; icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-slate-50 px-4 py-3.5 sm:px-5" aria-labelledby={`scoring-basis-${index}`}>
      <h3 id={`scoring-basis-${index}`} className="flex items-center gap-2 text-base font-bold text-slate-900">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white text-blue-600 shadow-sm"><Icon size={16} aria-hidden="true" /></span>
        <span className="text-xs font-semibold tabular-nums text-blue-600">{index}</span>{title}
      </h3>
      <div className="mt-2 text-pretty text-sm leading-6 text-slate-600">{children}</div>
    </section>
  )
}

/** The three layers of 评分依据; rendered on its own so it can be checked without a dialog. */
export function ScoringBasisContent() {
  const { standards, metrics, calibration } = SCORING_BASIS
  return (
    <div className="space-y-3" data-testid="scoring-basis-content">
      <Layer index={1} icon={BookCheck} title={standards.title}>
        <p>{standards.intro}</p>
        <ul className="mt-2 space-y-1.5">
          {standards.sources.map((source) => (
            <li key={source.name} className="flex gap-2">
              <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-blue-400" aria-hidden="true" />
              <span><b className="font-semibold text-slate-800">{source.name}</b>：{source.detail}</span>
            </li>
          ))}
        </ul>
      </Layer>
      <Layer index={2} icon={Activity} title={metrics.title}>
        <p>{metrics.intro}</p>
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="分析指标">
          {metrics.items.map((item) => <li key={item} className="rounded-full bg-white px-2.5 py-0.5 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-200">{item}</li>)}
        </ul>
        <p className="mt-2">{metrics.research}</p>
      </Layer>
      <Layer index={3} icon={SlidersHorizontal} title={calibration.title}>
        <p className="rounded-xl bg-white px-3 py-2 font-semibold text-slate-800 ring-1 ring-blue-100" data-testid="scoring-basis-statement">{calibration.statement}</p>
        <p className="mt-2">{calibration.example}</p>
        <p className="mt-1 text-xs text-slate-500">{calibration.note}</p>
      </Layer>
    </div>
  )
}

/**
 * 评分依据 on Home: a light modal next to 使用说明 (native <dialog>: focus trap, Escape and focus return come from
 * the browser). No new page; the full registry lives in docs/scoring/SCORING_V2.md.
 */
export function ScoringBasisDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      closeRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="scoring-basis-title"
      aria-describedby="scoring-basis-lead"
      data-testid="scoring-basis-dialog"
      onClose={() => { if (open) onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close() }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),600px)] overflow-y-auto rounded-3xl border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/45"
    >
      {open ? (
        <div className="px-5 pb-5 pt-4 sm:px-7 sm:pb-6 sm:pt-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="scoring-basis-title" className="mt-1.5 text-balance text-2xl font-bold text-slate-950">{SCORING_BASIS.title}</h2>
            <button ref={closeRef} type="button" onClick={() => dialogRef.current?.close()} aria-label="关闭评分依据" className="grid size-10 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <p id="scoring-basis-lead" className="mb-4 mt-2 text-pretty text-[15px] leading-7 text-slate-700">{SCORING_BASIS.lead}</p>
          <ScoringBasisContent />
        </div>
      ) : null}
    </dialog>
  )
}
