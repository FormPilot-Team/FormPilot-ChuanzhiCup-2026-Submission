import { ArrowRight, Play, Plus } from 'lucide-react'
import { WORKSHOP_NEW_PATH, WORKSHOP_PATH, customTrainingPath } from '../../app/routes'
import { BODY_AREAS } from '../../features/workshop/catalog'
import { goalText } from '../../features/workshop/definition'
import type { CustomActionDefinition } from '../../features/workshop/types'
import { PoseSketch } from '../workshop/PoseSketch'

/**
 * "我的动作" under the five official modes: the user's own actions (most recently trained or edited first), each
 * startable directly, plus one way to create another. Compact by design; the full library lives in 动作工坊.
 */
export function MyActionsStrip({ actions, total }: { actions: readonly CustomActionDefinition[]; total: number }) {
  return (
    <div className="mt-8 sm:mt-10" role="group" aria-labelledby="my-actions-title" data-testid="home-my-actions">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 id="my-actions-title" className="text-lg font-bold tracking-tight text-slate-950 sm:text-xl">我的动作</h3>
          <p className="mt-0.5 text-pretty text-sm text-slate-500">在动作工坊教会 FormPilot 的动作，可以直接开始训练</p>
        </div>
        <a href={WORKSHOP_PATH} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid="home-my-actions-manage">
          {total > actions.length ? `查看全部 ${total} 个` : '管理动作'}<ArrowRight size={15} aria-hidden="true" />
        </a>
      </div>
      {actions.length ? (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {actions.map((action) => (
            <li key={action.id} className="min-w-0">
              <a
                href={customTrainingPath(action.id)}
                className="fp-card-link group flex h-full min-w-0 items-center gap-3 rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_10px_24px_-20px_rgb(30_64_175/0.35)]"
                aria-label={`开始训练 · ${action.name}`}
                data-testid={`home-my-action-${action.id}`}
              >
                <PoseSketch start={action.startPose.capture} finish={action.finishPose.capture} className="h-16 w-14 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-slate-950">{action.name}</span>
                  <span className="mt-0.5 block truncate text-xs tabular-nums text-slate-500">{BODY_AREAS[action.bodyArea].label} · 目标 {goalText(action.goal)}</span>
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 group-hover:bg-blue-100" aria-hidden="true">
                    <Play size={11} fill="currentColor" />开始训练
                  </span>
                </span>
              </a>
            </li>
          ))}
          <li className="min-w-0">
            <a
              href={WORKSHOP_NEW_PATH}
              className="flex h-full min-h-[5.5rem] items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/50 p-3.5 text-sm font-bold text-blue-700 hover:border-blue-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              data-testid="home-my-actions-create"
            >
              <Plus size={16} aria-hidden="true" />创建新动作
            </a>
          </li>
        </ul>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-3.5" data-testid="home-my-actions-empty">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Plus size={18} aria-hidden="true" /></span>
          <p className="text-sm font-semibold text-slate-700">还没有自定义动作</p>
          <a href={WORKSHOP_NEW_PATH} className="inline-flex items-center gap-1 text-sm font-bold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            去动作工坊创建第一个动作<ArrowRight size={15} aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  )
}
