import { ArrowRight, BadgeCheck, Bot, CircleCheck, Sparkles } from 'lucide-react'
import { MODE_STATUS_LABEL, WORKSHOP_FLOW, modeEntryRoute, type ModeHubEntry } from '../../app/modeCatalog'
import { FigureGradient, FigureSilhouette } from './ModeFigure'
import { WORKSHOP_NEUTRAL_FIGURE } from './workshopTeaserArt'

/** What FormPilot knows once it has learned an action. True of any action, so no body part or pose is named. */
const TEASER_REQUIREMENTS = ['姿态', '动作范围', '完成条件'] as const

/** Viewfinder corners around the 50 x 58 camera frame. */
const CAMERA_CORNERS = 'M1.5 10V5.5a4 4 0 0 1 4-4H10M40 1.5h4.5a4 4 0 0 1 4 4V10M48.5 48v4.5a4 4 0 0 1-4 4H40M10 56.5H5.5a4 4 0 0 1-4-4V48'

/**
 * What 动作工坊 does, in one small picture that holds for any action: the camera records you (记录动作), FormPilot learns
 * the action (理解动作), it knows what to check (three 识别要求) and the test passes (测试通过). The person is someone
 * standing at ease, drawn by hand (workshopTeaserArt.ts): never a pose from 八段锦, 太极拳, 五禽戏, 易筋经 or 热身训练,
 * and never the landmark skeleton of the workshop's debug views, so the card is about teaching FormPilot your own action,
 * not about one move. Decorative; the text says the same in words, so it only appears when the card is wide enough to
 * keep the words roomy.
 */
function WorkshopIllustration() {
  return (
    <div className="hidden w-40 shrink-0 flex-col gap-2 self-start rounded-2xl bg-white p-3 ring-1 ring-slate-100 shadow-[0_10px_24px_-22px_rgb(30_64_175/0.45)] @min-[30rem]:flex" aria-hidden="true" data-testid="home-workshop-illustration">
      <div className="rounded-xl bg-gradient-to-b from-sky-50 to-white p-1.5">
        <div className="flex items-center gap-1">
          <svg viewBox="0 0 50 58" className="block h-auto w-[3.25rem] shrink-0" focusable="false" data-part="workshop-record">
            <defs>
              <FigureGradient id="workshop-figure" top="text-sky-200" bottom="text-blue-400" />
            </defs>
            <rect x="1.5" y="1.5" width="47" height="55" rx="4" className="fill-white/80" />
            <path d={CAMERA_CORNERS} className="fill-none stroke-sky-300" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="9" cy="9" r="3.2" className="fill-rose-100" />
            <circle cx="9" cy="9" r="1.7" className="fill-rose-500" />
            <g data-figure="workshop-neutral"><FigureSilhouette figure={WORKSHOP_NEUTRAL_FIGURE} paint="url(#workshop-figure)" /></g>
          </svg>
          <div className="flex min-w-0 flex-1 items-center gap-1" data-part="workshop-learn">
            <svg viewBox="0 0 24 8" className="block h-auto min-w-0 flex-1" focusable="false">
              <g className="fill-none stroke-cyan-400" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1.5 4H20.5" strokeDasharray="2.2 2.4" />
                <path d="M19.2 1.2 22.3 4 19.2 6.8" />
              </g>
            </svg>
            <span className="relative grid size-8 shrink-0 place-items-center rounded-[0.625rem] bg-white text-blue-600 ring-1 ring-sky-200 shadow-[0_6px_14px_-10px_rgb(37_99_235/0.8)]">
              <Bot size={17} />
              <Sparkles size={10} className="absolute -right-1 -top-1.5 text-cyan-500" />
            </span>
          </div>
        </div>
        {/* Each caption sits under its own picture: centred under the camera, flush right under FormPilot. */}
        <div className="mt-1 flex justify-between text-[10px] font-medium leading-3.5 text-slate-500">
          <span className="flex w-[3.25rem] justify-center whitespace-nowrap">记录动作</span>
          <span className="whitespace-nowrap text-blue-700">理解动作</span>
        </div>
      </div>
      <ul className="grid w-full gap-0.5" data-part="workshop-requirements">
        {TEASER_REQUIREMENTS.map((label) => (
          <li key={label} className="flex min-w-0 items-center gap-1 text-[11px] leading-4 text-slate-600">
            <CircleCheck size={12} className="shrink-0 text-cyan-600" />
            <span className="truncate">{label}</span>
          </li>
        ))}
      </ul>
      <p className="inline-flex items-center gap-1 self-start rounded-full bg-emerald-50 px-2 text-[10px] font-semibold leading-[1.125rem] text-emerald-700 ring-1 ring-emerald-100" data-part="workshop-tested">
        <BadgeCheck size={12} className="shrink-0" />测试通过
      </p>
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
