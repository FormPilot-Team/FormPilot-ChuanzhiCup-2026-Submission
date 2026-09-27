/** One line of a "查看诊断信息" panel. */
export interface DiagnosticsRow {
  label: string
  value: string
}

/** Plain text for copying into a chat: one "label：value" per line. */
export function diagnosticsText(title: string, rows: ReadonlyArray<DiagnosticsRow>): string {
  return [title, ...rows.map((row) => `${row.label}：${row.value}`)].join('\n')
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '未知'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/** Error text safe to show and log: bounded, single line. */
export function errorText(error: unknown): string {
  let text: string
  if (error instanceof Error) text = `${error.name}: ${error.message}`
  else if (error && typeof error === 'object' && 'name' in error) {
    const named = error as { name: unknown; message?: unknown }
    text = `${String(named.name)}: ${String(named.message ?? '')}`
  } else text = String(error)
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}
