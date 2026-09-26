import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, CircleDashed, Download, FileUp, History, PencilLine, Plus, Trash2, WandSparkles,
} from 'lucide-react'
import { HOME_PATH, WORKSHOP_NEW_PATH, workshopActionPath } from '../../app/routes'
import { WORKSHOP_FLOW } from '../../app/modeCatalog'
import { AppHeader } from '../../components/layout/AppHeader'
import { PoseSketch } from '../../components/workshop/PoseSketch'
import { BODY_AREAS, SIGNAL_SOURCE_OPTIONS } from '../../features/workshop/catalog'
import { goalText } from '../../features/workshop/definition'
import { downloadJson, readTextFile } from '../../features/workshop/download'
import { LocalStorageCustomActionRepository, type CustomActionRepository } from '../../features/workshop/store'
import { CustomActionImportError, buildExport, exportFileName, importSummary, planImport, readLegacyLibrary } from '../../features/workshop/transfer'
import { LEGACY_ACTION_LIBRARY_KEY, type CustomActionDefinition } from '../../features/workshop/types'
import { cn } from '../../lib/cn'

const localRepository = new LocalStorageCustomActionRepository()

type Notice = { tone: 'success' | 'error'; text: string } | null

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function TestStatusBadge({ action }: { action: CustomActionDefinition }) {
  const status = action.test.status
  if (status === 'passed') return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800"><Check size={13} aria-hidden="true" />测试通过</span>
  if (status === 'needs-adjustment') return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900"><AlertTriangle size={13} aria-hidden="true" />需要调整</span>
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"><CircleDashed size={13} aria-hidden="true" />未测试</span>
}

function recognitionLabel(action: CustomActionDefinition): string {
  return action.recognition.source === 'pose-match' ? '按示范姿势识别' : `模板 · ${SIGNAL_SOURCE_OPTIONS[action.recognition.source].label}`
}

function ActionCard({ action, onExport, onDelete }: { action: CustomActionDefinition; onExport: () => void; onDelete: () => void }) {
  const area = BODY_AREAS[action.bodyArea]
  return (
    <li className="min-w-0" data-testid={`workshop-action-${action.id}`}>
      <article className="fp-card flex h-full min-w-0 flex-col p-4 sm:p-5" aria-labelledby={`action-${action.id}-name`}>
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 id={`action-${action.id}-name`} className="min-w-0 truncate text-lg font-bold text-slate-950">{action.name}</h3>
              <TestStatusBadge action={action} />
            </div>
            <p className="mt-1 text-sm tabular-nums text-slate-500">{area.label} · 目标 {goalText(action.goal)} · {recognitionLabel(action)}</p>
            {action.description ? <p className="mt-2 line-clamp-2 text-pretty text-sm leading-6 text-slate-600">{action.description}</p> : null}
            {action.source.kind !== 'workshop' ? <p className="mt-2 text-xs font-semibold text-slate-500">{action.source.kind === 'legacy-library' ? '来自旧版动作库' : '来自导入的动作文件'}</p> : null}
          </div>
          <PoseSketch start={action.startPose.capture} finish={action.finishPose.capture} className="h-24 w-20 shrink-0" />
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          <a href={workshopActionPath(action.id)} className="secondary-button inline-flex items-center gap-1.5 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`编辑 ${action.name}`}><PencilLine size={15} aria-hidden="true" />编辑</a>
          <button type="button" onClick={onExport} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100" aria-label={`导出 ${action.name}`}><Download size={15} aria-hidden="true" />导出</button>
          <AlertDialog.Root>
            <AlertDialog.Trigger asChild>
              <button type="button" className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-coral-50 hover:text-coral-600" aria-label={`删除 ${action.name}`}><Trash2 size={15} aria-hidden="true" />删除</button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
              <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 shadow-xl">
                <AlertDialog.Title className="text-balance text-lg font-bold text-slate-900">删除「{action.name}」？</AlertDialog.Title>
                <AlertDialog.Description className="mt-2 text-pretty text-sm leading-6 text-slate-500">删除后无法恢复。已经保存的训练记录不会被删除。</AlertDialog.Description>
                <div className="mt-6 flex justify-end gap-3">
                  <AlertDialog.Cancel asChild><button type="button" className="secondary-button">取消</button></AlertDialog.Cancel>
                  <AlertDialog.Action asChild><button type="button" onClick={onDelete} className="danger-button">删除</button></AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </div>
      </article>
    </li>
  )
}

export function WorkshopHomePage({ repository = localRepository }: { repository?: CustomActionRepository }) {
  const [library, setLibrary] = useState(() => repository.load())
  const legacy = useMemo(() => readLegacyLibrary(safeStorage()), [])
  const [notice, setNotice] = useState<Notice>(() => {
    const saved = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('saved')
    const action = saved ? repository.get(saved) : undefined
    return action ? { tone: 'success', text: `已保存「${action.name}」。` } : null
  })
  const fileRef = useRef<HTMLInputElement>(null)
  const actions = library.actions
  const legacyPending = legacy.candidates.filter((item) => !actions.some((action) => action.source.legacyId === item.id))

  const refresh = () => setLibrary(repository.load())

  const applyImport = (text: string) => {
    try {
      const plan = planImport(text, actions)
      const saved = plan.actions.filter((action) => repository.save(action))
      if (saved.length < plan.actions.length) {
        setNotice({ tone: 'error', text: `只保存了 ${saved.length} 个动作，本地存储空间可能已满。` })
      } else {
        setNotice({ tone: 'success', text: importSummary(plan) })
      }
      refresh()
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof CustomActionImportError ? error.message : '导入失败，请检查文件后重试。' })
    }
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 5_000_000) {
      setNotice({ tone: 'error', text: '文件太大，动作文件通常只有几十 KB。' })
      return
    }
    applyImport(await readTextFile(file))
  }

  const importLegacy = () => {
    const raw = safeStorage()?.getItem(LEGACY_ACTION_LIBRARY_KEY)
    if (raw) applyImport(raw)
  }

  const exportAll = () => {
    downloadJson(exportFileName(), buildExport(actions))
    setNotice({ tone: 'success', text: `已导出 ${actions.length} 个动作。` })
  }

  return (
    <div className="fp-page min-h-dvh min-w-0 overflow-x-clip text-slate-900">
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-[1200px] px-4 pb-14 pt-5 sm:px-6 lg:px-8">
        <a href={HOME_PATH} className="mb-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeft size={17} aria-hidden="true" />返回首页</a>
        <header className="fp-hero relative overflow-hidden rounded-3xl border border-white/80 p-5 shadow-[0_18px_40px_-28px_rgb(30_64_175/0.35)] sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="fp-energy-gradient grid size-12 shrink-0 place-items-center rounded-2xl text-white shadow-[0_8px_18px_-10px_rgb(14_165_233/0.9)]"><WandSparkles size={23} aria-hidden="true" /></span>
              <div className="min-w-0">
                <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">动作工坊</h1>
                <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-slate-600 sm:text-base">教 FormPilot 学会你的动作：记录开始和完成姿势，选好识别重点，测试一下，保存后就能像其他训练一样开始练。</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href={WORKSHOP_NEW_PATH} className="primary-button inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" data-testid="workshop-create"><Plus size={17} aria-hidden="true" />创建动作</a>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={library.readOnly} className="secondary-button inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"><FileUp size={16} aria-hidden="true" />导入动作文件</button>
              <button type="button" onClick={exportAll} disabled={!actions.length} className="secondary-button inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"><Download size={16} aria-hidden="true" />导出全部</button>
              <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label="选择要导入的动作文件" onChange={onFile} data-testid="workshop-import-input" />
            </div>
          </div>
          <ol className="mt-6 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm font-semibold text-slate-700" aria-label="动作工坊流程">
            {WORKSHOP_FLOW.map((step, index) => (
              <li key={step} className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 ring-1 ring-slate-200"><span className="grid size-5 place-items-center rounded-full bg-blue-600 text-[11px] font-bold tabular-nums text-white">{index + 1}</span>{step}</span>
                {index < WORKSHOP_FLOW.length - 1 ? <ChevronRight size={15} className="text-slate-300" aria-hidden="true" /> : null}
              </li>
            ))}
          </ol>
        </header>

        <div className="mt-5 space-y-3" aria-live="polite">
          {notice ? <p className={cn('rounded-xl px-4 py-3 text-sm font-semibold', notice.tone === 'success' ? 'bg-emerald-50 text-emerald-900' : 'bg-coral-50 text-coral-600')} role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="workshop-notice">{notice.tone === 'error' ? <AlertTriangle size={16} className="mr-1.5 inline" aria-hidden="true" /> : <Check size={16} className="mr-1.5 inline" aria-hidden="true" />}{notice.text}</p> : null}
          {library.readOnly ? <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status">本地的动作数据来自更新版本或无法读取，为避免覆盖，本页暂时只读。</p> : null}
          {library.skipped ? <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status">有 {library.skipped} 个动作的数据不完整，已跳过显示。</p> : null}
          {legacyPending.length && !library.readOnly ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="workshop-legacy-banner">
              <p className="flex items-start gap-2 text-pretty text-sm font-semibold leading-6 text-blue-900"><History size={17} className="mt-0.5 shrink-0" aria-hidden="true" />发现旧版动作库中有 {legacyPending.length} 个带识别规则的动作，可以导入到我的动作。旧版动作库本身不会被修改。</p>
              <button type="button" onClick={importLegacy} className="primary-button shrink-0 self-start sm:self-auto">导入旧版动作</button>
            </div>
          ) : null}
        </div>

        <section className="mt-6" aria-labelledby="my-actions-title">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="my-actions-title" className="fp-section-title">我的动作</h2>
            <p className="text-sm text-slate-500">{actions.length ? `共 ${actions.length} 个` : ''}</p>
          </div>
          {actions.length ? (
            <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="workshop-actions">
              {actions.map((action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  onExport={() => {
                    downloadJson(exportFileName(action), buildExport([action]))
                    setNotice({ tone: 'success', text: `已导出「${action.name}」。` })
                  }}
                  onDelete={() => {
                    const removed = repository.remove(action.id)
                    setNotice(removed ? { tone: 'success', text: `已删除「${action.name}」。` } : { tone: 'error', text: '删除失败，请稍后重试。' })
                    refresh()
                  }}
                />
              ))}
            </ul>
          ) : (
            <div className="fp-card mt-4 flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" data-testid="workshop-empty">
              <div>
                <p className="font-bold text-slate-950">还没有自定义动作</p>
                <p className="mt-1 text-pretty text-sm leading-6 text-slate-600">选一个你常做的动作，几分钟就能教会 FormPilot。</p>
              </div>
              <a href={WORKSHOP_NEW_PATH} className="primary-button inline-flex shrink-0 items-center gap-2"><Plus size={17} aria-hidden="true" />创建第一个动作</a>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
