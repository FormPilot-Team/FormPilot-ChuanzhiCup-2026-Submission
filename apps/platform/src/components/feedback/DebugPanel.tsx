import { Download } from 'lucide-react'
import type { DebugDatum, ExerciseDefinition } from '../../features/exercises/contract'
import type { ExerciseState, RuleResult } from '../../features/exercises/types'
import type { BaseMotionFeatures } from '../../features/motion/types'
import type { PerformanceSnapshot } from '../../features/diagnostics/PerformanceTracker'

interface DebugPanelProps {
  definition: ExerciseDefinition<BaseMotionFeatures, ExerciseState>
  features?: BaseMotionFeatures
  state: ExerciseState
  result: RuleResult
  performance: PerformanceSnapshot
  onExportJson: () => void
  onExportCsv: () => void
  showCoachReference: boolean
  onShowCoachReferenceChange: (show: boolean) => void
  runtimeData?: ReadonlyArray<DebugDatum>
}

export function DebugPanel({ definition, features, state, result, performance, onExportJson, onExportCsv, showCoachReference, onShowCoachReferenceChange, runtimeData = [] }: DebugPanelProps) {
  const items: DebugDatum[] = [
    { label: 'Camera FPS', value: performance.cameraFps.toFixed(1) },
    { label: 'Inference FPS', value: performance.inferenceFps.toFixed(1) },
    { label: 'Avg inference', value: `${performance.averageInferenceMs.toFixed(1)} ms` },
    { label: 'p95 inference', value: `${performance.p95InferenceMs.toFixed(1)} ms` },
    { label: 'UI FPS', value: performance.uiFps.toFixed(1) },
    { label: 'Dropped / skipped', value: `${performance.droppedFrames} / ${performance.skippedFrames}` },
    { label: 'Input', value: performance.inputResolution },
    { label: 'Pose confidence', value: (features?.confidence ?? 0).toFixed(2) },
    { label: 'Phase', value: result.phase },
    { label: 'Rep count', value: String(state.repCount) },
    { label: 'Score', value: String(result.currentScore) },
    { label: 'Active errors', value: result.errors.map((item) => item.code).join(', ') || 'none' },
    { label: 'Primary feedback', value: result.primaryFeedback?.message ?? 'none' },
    ...runtimeData,
    ...definition.getDebugData({ features, state, result }),
  ]
  return (
    <aside className="rounded-2xl bg-slate-900 p-4 text-slate-100 shadow-lg" aria-label="开发调试信息">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div><h2 className="font-mono text-sm font-bold">Developer Calibration Mode</h2><p className="mt-1 text-pretty text-xs text-slate-400">仅记录匿名派生指标与规则结果，不保存视频画面。</p></div>
        <span className="ml-auto rounded-md bg-emerald-400/15 px-2 py-1 font-mono text-xs text-emerald-300">?debug=1</span>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100">
          <input type="checkbox" checked={showCoachReference} onChange={(event) => onShowCoachReferenceChange(event.target.checked)} className="size-4 accent-orange-500" />
          Show Coach Reference Skeleton
        </label>
        <button type="button" onClick={onExportJson} className="inline-flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-600"><Download size={14} />导出 JSON</button>
        <button type="button" onClick={onExportCsv} className="inline-flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-600"><Download size={14} />导出 CSV</button>
      </div>
      <dl className="grid gap-x-6 gap-y-2 font-mono text-xs sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ label, value }) => <div key={label} className="min-w-0"><dt className="text-slate-400">{label}</dt><dd className="mt-0.5 truncate tabular-nums text-slate-100" title={value}>{value}</dd></div>)}
      </dl>
    </aside>
  )
}
