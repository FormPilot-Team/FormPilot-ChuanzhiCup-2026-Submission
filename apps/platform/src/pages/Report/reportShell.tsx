import type { Activity } from 'lucide-react'

/** Report shell pieces shared by every mode's report (Smart Training and follow-along routines). */
export function SectionHeading({ id, icon: Icon, title, description }: {
  id: string
  icon: typeof Activity
  title: string
  description?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700" aria-hidden="true"><Icon size={18} /></span>
      <div>
        <h2 id={id} className="text-balance text-xl font-bold text-slate-950 sm:text-2xl">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-pretty text-sm leading-6 text-slate-600">{description}</p> : null}
      </div>
    </div>
  )
}

export function HeroFact({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-6 py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 lg:border-b lg:border-r-0">
      <Icon size={18} className="shrink-0 text-blue-300" aria-hidden="true" />
      <div className="min-w-0"><dt className="text-xs font-medium text-slate-400">{label}</dt><dd className="mt-1 text-sm font-semibold tabular-nums text-white">{value}</dd></div>
    </div>
  )
}
