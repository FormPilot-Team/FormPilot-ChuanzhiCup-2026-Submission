import { ArrowRight, CircleCheck } from 'lucide-react'
import { MODE_STATUS_LABEL, WORKSHOP_FLOW, modeEntryRoute, type ModeHubEntry } from '../../app/modeCatalog'
import { REQUIREMENTS } from '../../features/workshop/catalog'
import type { RequirementId } from '../../features/workshop/types'
import { PoseSketch } from '../workshop/PoseSketch'
import { WORKSHOP_TEASER_POSES } from './workshopTeaserPoses'

const TEASER_REQUIREMENTS: ReadonlyArray<RequirementId> = ['arms-straight', 'hands-above-shoulders', 'full-return']

/**
 * What 动作工坊 looks like from the inside, drawn with its own pieces: the pose sketch of a recorded start → finish pair
 * (real landmarks) and three of its 识别重点, in one small panel like 我的训练's. Decorative; the text says the same in
 * words, so it only appears when the card is wide enough to keep the words roomy.
 */
function WorkshopIllustration() {
  return (
    <div className="hidden w-36 shrink-0 flex-col items-center gap-2.5 self-start rounded-2xl bg-white p-3 ring-1 ring-slate-100 shadow-[0_10px_24px_-22px_rgb(30_64_175/0.45)] @min-[30rem]:flex" aria-hidden="true" data-testid="home-workshop-illustration">
      <PoseSketch start={WORKSHOP_TEASER_POSES.start} finish={WORKSHOP_TEASER_POSES.finish} className="h-24 w-[5.2rem]" />
      <ul className="grid w-full gap-1">
        {TEASER_REQUIREMENTS.map((id) => (
          <li key={id} className="flex min-w-0 items-center gap-1 text-[11px] leading-4 text-slate-600">
            <CircleCheck size={12} className="shrink-0 text-cyan-600" />
            <span className="truncate">{REQUIREMENTS[id].label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The workshop's five steps as one light path: small numbered dots on a hairline, the words under them, never wider
 * than 26rem. It needs about 17rem; below that the steps wrap 3 + 2 and the line goes away.
 */
function WorkshopFlow() {
  return (
    <ol className="relative mt-4 grid max-w-[26rem] grid-cols-3 gap-y-2 text-xs font-medium text-slate-600 @min-[17rem]:flex @min-[17rem]:justify-between" aria-label="动作工坊流程" data-testid="home-workshop-flow">
      <span className="absolute left-[2em] right-[2em] top-2.5 hidden h-px bg-orange-200 @min-[17rem]:block" aria-hidden="true" />
      {WORKSHOP_FLOW.map((step, index) => (
        <li key={step} className="relative flex flex-col items-center gap-1 whitespace-nowrap">
          <span className="grid size-5 place-items-center rounded-full bg-orange-50 text-[10px] font-bold tabular-nums text-orange-700 ring-1 ring-orange-200" aria-hidden="true">{index + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  )
}

/**
 * 动作工坊 on Home: teach FormPilot your own action, in the workshop's own steps. The same card as 我的训练 next to it,
 * with a warm-white wash and orange only on the icon and step numbers. A static card until it is available.
 */
export function WorkshopTeaser({ entry }: { entry: ModeHubEntry }) {
  const route = modeEntryRoute(entry)
  const Icon = entry.icon
  const [headline, detail] = entry.description.split('：')
  return (
    <section
      className="fp-card @container relative flex min-w-0 flex-col overflow-hidden bg-gradient-to-br from-[#fff5eb] via-[#fffbf6] to-white p-5 sm:p-6"
      aria-labelledby="workshop-title"
      data-testid="home-workshop"
      data-status={entry.status}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-orange-400 to-amber-400 text-white shadow-[0_8px_18px_-10px_rgb(249_115_22/0.9)]"><Icon size={21} aria-hidden="true" /></span>
        <h2 id="workshop-title" className="fp-section-title">{entry.title}</h2>
        {!route ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{MODE_STATUS_LABEL[entry.status]}</span> : null}
      </div>
      <div className="mt-3 flex min-w-0 flex-1 gap-5">
        <div className="@container flex min-w-0 flex-1 flex-col">
          <p className="text-pretty text-base font-semibold text-slate-800 sm:text-lg">{headline}</p>
          {detail ? <p className="mt-1 text-pretty text-sm leading-6 text-slate-500">{detail}</p> : null}
          <WorkshopFlow />
          {route ? (
            <a href={route} className="primary-button mt-5 inline-flex items-center justify-center gap-2 self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" data-testid="home-workshop-link">
              {entry.cta ?? '进入动作工坊'}<ArrowRight size={17} aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <WorkshopIllustration />
      </div>
    </section>
  )
}
