import { ArrowRight, ChevronRight, CircleCheck } from 'lucide-react'
import { MODE_STATUS_LABEL, WORKSHOP_FLOW, modeEntryRoute, type ModeHubEntry } from '../../app/modeCatalog'
import { REQUIREMENTS } from '../../features/workshop/catalog'
import type { RequirementId } from '../../features/workshop/types'
import { PoseSketch } from '../workshop/PoseSketch'
import { WORKSHOP_TEASER_POSES } from './workshopTeaserPoses'

const TEASER_REQUIREMENTS: ReadonlyArray<RequirementId> = ['arms-straight', 'hands-above-shoulders', 'full-return']

/**
 * What 动作工坊 looks like from the inside, drawn with its own pieces: the pose sketch of a recorded start → finish pair
 * (real landmarks) and three of its 识别重点. Decorative; the text next to it says the same in words.
 */
function WorkshopIllustration() {
  return (
    <div className="relative -mb-2 hidden h-40 w-[14.5rem] shrink-0 sm:block" aria-hidden="true">
      <div className="absolute left-0 top-0 rounded-2xl bg-white/90 p-2 shadow-[0_14px_30px_-20px_rgb(154_52_18/0.45)] ring-1 ring-orange-100">
        <PoseSketch start={WORKSHOP_TEASER_POSES.start} finish={WORKSHOP_TEASER_POSES.finish} className="h-32 w-[6.9rem]" />
      </div>
      <div className="absolute bottom-0 right-0 w-[8.75rem] rounded-xl bg-white p-2.5 shadow-[0_14px_30px_-18px_rgb(30_64_175/0.45)] ring-1 ring-slate-100">
        <p className="text-[11px] font-bold text-slate-700">识别重点</p>
        <ul className="mt-1.5 grid gap-1">
          {TEASER_REQUIREMENTS.map((id) => (
            <li key={id} className="flex items-center gap-1 text-[11px] leading-4 text-slate-600">
              <CircleCheck size={12} className="shrink-0 text-emerald-500" />
              <span className="truncate">{REQUIREMENTS[id].label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** 动作工坊 on Home: teach FormPilot your own action, in the workshop's own steps. A static card until it is available. */
export function WorkshopTeaser({ entry }: { entry: ModeHubEntry }) {
  const route = modeEntryRoute(entry)
  const Icon = entry.icon
  const [headline, detail] = entry.description.split('：')
  return (
    <section
      className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-orange-100/90 bg-gradient-to-br from-[#fff2e5] via-[#fffaf5] to-white p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_30px_-22px_rgb(154_52_18/0.35)] sm:p-6"
      aria-labelledby="workshop-title"
      data-testid="home-workshop"
      data-status={entry.status}
    >
      <div className="relative flex min-w-0 gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-orange-400 to-amber-400 text-white shadow-[0_8px_18px_-10px_rgb(249_115_22/0.9)]"><Icon size={21} aria-hidden="true" /></span>
            <h2 id="workshop-title" className="fp-section-title">{entry.title}</h2>
            {!route ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{MODE_STATUS_LABEL[entry.status]}</span> : null}
          </div>
          <p className="mt-3 text-pretty text-base font-semibold text-slate-800 sm:text-lg">{headline}</p>
          {detail ? <p className="mt-1 text-pretty text-sm leading-6 text-slate-600">{detail}</p> : null}
        </div>
        <WorkshopIllustration />
      </div>
      <ol className="relative mt-4 flex flex-wrap items-center gap-x-1 gap-y-2 text-xs font-semibold text-slate-600" aria-label="动作工坊流程">
        {WORKSHOP_FLOW.map((step, index) => (
          <li key={step} className="flex items-center gap-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 py-1 pl-1 pr-2.5 ring-1 ring-orange-100">
              <span className="grid size-4 place-items-center rounded-full bg-orange-100 text-[10px] font-bold tabular-nums text-orange-800" aria-hidden="true">{index + 1}</span>
              {step}
            </span>
            {index < WORKSHOP_FLOW.length - 1 ? <ChevronRight size={14} className="text-orange-300" aria-hidden="true" /> : null}
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
