export function freezeOwnedData<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeOwnedData(child)
    Object.freeze(value)
  }
  return value
}

export class ExecutionStopped extends Error {
  constructor(readonly code: 'CANCELLED' | 'TIMEOUT' | 'UNAVAILABLE') { super(code) }
}

/** Cooperative lifetime guard. Synchronous JS cannot be preempted by a timer. */
export async function withinLifetime<T>(operation: (check: () => void) => T | Promise<T>, options: {
  signal?: AbortSignal; timeoutMs: number; now: () => number
}): Promise<T> {
  const started = options.now()
  if (!Number.isFinite(started)) throw new ExecutionStopped('UNAVAILABLE')
  let stopped: ExecutionStopped | null = options.signal?.aborted ? new ExecutionStopped('CANCELLED') : null
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  function check() {
    if (options.signal?.aborted) stopped ??= new ExecutionStopped('CANCELLED')
    const current = options.now()
    if (!Number.isFinite(current) || current < started) stopped ??= new ExecutionStopped('UNAVAILABLE')
    else if (current - started >= options.timeoutMs) stopped ??= new ExecutionStopped('TIMEOUT')
    if (stopped) throw stopped
  }
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => { stopped ??= new ExecutionStopped('CANCELLED'); reject(stopped) }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => { stopped ??= new ExecutionStopped('TIMEOUT'); reject(stopped) }, options.timeoutMs)
  })
  try {
    check()
    const result = await Promise.race([Promise.resolve().then(() => { check(); return operation(check) }), interrupted])
    check()
    return result
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort) options.signal?.removeEventListener('abort', onAbort)
  }
}
