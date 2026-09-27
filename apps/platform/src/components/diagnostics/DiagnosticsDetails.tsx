import { useState } from 'react'
import { ChevronDown, ChevronUp, ClipboardCopy } from 'lucide-react'
import { diagnosticsText, type DiagnosticsRow } from '../../features/diagnostics/diagnosticsReport'
import { cn } from '../../lib/cn'

/** Copies without asking for the clipboard permission (the desktop app grants the camera and nothing else). */
function copyText(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  area.remove()
  return copied
}

interface DiagnosticsDetailsProps {
  /** Heading of the copied text, e.g. "FormPilot 视频诊断". */
  title: string
  /** null while the details are still being collected. */
  rows: ReadonlyArray<DiagnosticsRow> | null
  /** Called when the panel opens, for details that are only collected on demand. */
  onOpen?: () => void
  className?: string
  testId?: string
}

/**
 * The engineering details behind a friendly error: collapsed by default and not rendered at all until opened, so the
 * default screen never shows raw error names.
 */
export function DiagnosticsDetails({ title, rows, onOpen, className, testId }: DiagnosticsDetailsProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const toggle = () => {
    if (!open) onOpen?.()
    setOpen(!open)
    setCopied('idle')
  }
  return (
    <div className={cn('w-full text-left', className)} data-testid={testId} data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="mx-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {open ? '收起诊断信息' : '查看诊断信息'}
        {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {open ? (
        <div className="mt-2 rounded-xl bg-white p-3 text-xs leading-5 text-slate-700 ring-1 ring-slate-200" data-testid={testId ? `${testId}-body` : undefined}>
          {rows ? (
            <>
              <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">
                {rows.map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="font-semibold text-slate-500">{row.label}</dt>
                    <dd className="min-w-0 break-words font-mono text-[11px] text-slate-800">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCopied(copyText(diagnosticsText(title, rows)) ? 'done' : 'failed')}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <ClipboardCopy size={13} aria-hidden="true" />复制诊断信息
                </button>
                <span role="status" className="text-slate-500">{copied === 'done' ? '已复制，可以直接粘贴发给我们' : copied === 'failed' ? '复制失败，请手动选中文字复制' : ''}</span>
              </div>
            </>
          ) : (
            <p role="status">正在收集诊断信息…</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
