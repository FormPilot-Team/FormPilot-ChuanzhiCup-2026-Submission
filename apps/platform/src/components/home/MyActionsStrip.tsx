import { ArrowRight, Play, Plus } from 'lucide-react'
import { WORKSHOP_NEW_PATH, WORKSHOP_PATH, customTrainingPath } from '../../app/routes'
import { BODY_AREAS } from '../../features/workshop/catalog'
import { goalText } from '../../features/workshop/definition'
import type { CustomActionDefinition } from '../../features/workshop/types'
import { PoseSketch } from '../workshop/PoseSketch'

/**
 * "我的动作" under the five official modes: the user's own actions (most recently trained or edited first), each
 * startable directly. Compact by design; the full library lives in 动作工坊.
 */
export function MyActionsStrip({ actions, total }: { actions: readonly CustomActionDefinition[]; total: number }) {
  return (
    <div className="mt-5 rounded-2xl border border-slate-200/70 bg-white/70 p-4 sm:p-5" role="group" aria-labelledby="my-actions-title" data-testid="home-my-actions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="my-actions-title" className="font-bold text-slate-950">我的动作</h3>
        <a href={WORKSHOP_PATH} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid="home-my-actions-manage">
          {total > actions.length ? `查看全部 ${total} 个` : '管理动作'}<ArrowRight size={15} aria-hidden="true" />
        </a>
      </div>
      {actions.length ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map((action) => (
            <li key={action.id} className="min-w-0">
              <a
                href={customTrainingPath(action.id)}
                className="fp-card-link group flex min-w-0 items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200"
                aria-label={`开始训练 · ${action.name}`}
                data-testid={`home-my-action-${action.id}`}
              >
                <PoseSketch start={action.startPose.capture} finish={action.finishPose.capture} className="h-12 w-10 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-slate-950">{action.name}</span>
                  <span className="block truncate text-xs tabular-nums text-slate-500">{BODY_AREAS[action.bodyArea].label} · 目标 {goalText(action.goal)}</span>
                </span>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-700 group-hover:bg-blue-100" aria-hidden="true"><Play size={14} fill="currentColor" /></span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600" data-testid="home-my-actions-empty">
          还没有自定义动作
          <a href={WORKSHOP_NEW_PATH} className="inline-flex items-center gap-1 font-bold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Plus size={15} aria-hidden="true" />去动作工坊创建第一个动作</a>
        </p>
      )}
    </div>
  )
}
