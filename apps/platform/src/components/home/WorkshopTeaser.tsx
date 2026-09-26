import { ArrowRight, ChevronRight } from 'lucide-react'
import { MODE_STATUS_LABEL, WORKSHOP_FLOW, modeEntryRoute, type ModeHubEntry } from '../../app/modeCatalog'
import { ModeMotifArt } from './ModeMotifArt'

/** 动作工坊 on Home: what it does and its flow. Until the workshop is available it is a static card without links. */
export function WorkshopTeaser({ entry }: { entry: ModeHubEntry }) {
  const route = modeEntryRoute(entry)
  const Icon = entry.icon
  return (
    <section className="fp-card relative flex min-w-0 flex-col overflow-hidden bg-gradient-to-br from-white via-white to-teal-50/70 p-5 sm:p-6" aria-labelledby="workshop-title" data-testid="home-workshop" data-status={entry.status}>
      <ModeMotifArt motif="leap" className="absolute -bottom-3 -right-4 hidden h-24 w-44 text-teal-400/50 sm:block" />
      <div className="relative flex min-w-0 items-center gap-3">
        <span className="fp-energy-gradient grid size-10 shrink-0 place-items-center rounded-2xl text-white"><Icon size={20} aria-hidden="true" /></span>
        <h2 id="workshop-title" className="fp-section-title">{entry.title}</h2>
        {!route ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{MODE_STATUS_LABEL[entry.status]}</span> : null}
      </div>
      <p className="relative mt-3 max-w-md text-pretty text-sm leading-6 text-slate-600">{entry.description}</p>
      <ol className="relative mt-4 flex flex-wrap items-center gap-x-1 gap-y-2 text-xs font-semibold text-slate-600" aria-label="动作工坊流程">
        {WORKSHOP_FLOW.map((step, index) => (
          <li key={step} className="flex items-center gap-1">
            <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">{step}</span>
            {index < WORKSHOP_FLOW.length - 1 ? <ChevronRight size={14} className="text-slate-300" aria-hidden="true" /> : null}
          </li>
        ))}
      </ol>
      {route ? (
        <a href={route} className="primary-button relative mt-5 inline-flex items-center justify-center gap-2 self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" data-testid="home-workshop-link">
          {entry.cta ?? '进入动作工坊'}<ArrowRight size={17} aria-hidden="true" />
        </a>
      ) : null}
    </section>
  )
}
