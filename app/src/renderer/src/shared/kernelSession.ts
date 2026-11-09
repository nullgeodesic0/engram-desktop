import type { CellResult, KernelEvent, KernelState } from '../../../shared/runtime'
import { appendOutput } from '../../../shared/cellOutputs'

/**
 * The renderer's one listener for kernel events, alive for the whole app
 * rather than for one mounted Workbench. A cell that finishes while its
 * workbench is not on screen still has its outputs and result recorded here,
 * and the Workbench folds them in when it is shown again. "Run all" waits on
 * this store too, so it keeps going when the learner looks elsewhere.
 */

const EMPTY: CellResult = { state: 'idle', outputs: [], count: null, ms: null }

const live = new Map<string, Record<string, CellResult>>()
const kernels = new Map<string, { state: KernelState; detail: string | null }>()
const waiters = new Map<string, Array<(ok: boolean) => void>>()
const listeners = new Map<string, Set<() => void>>()
let started = false

const key = (wb: string, cell: string) => `${wb}\u0000${cell}`

function notify(wb: string): void {
  listeners.get(wb)?.forEach((fn) => fn())
}

function setResult(wb: string, cellId: string, r: CellResult): void {
  live.set(wb, { ...(live.get(wb) ?? {}), [cellId]: r })
}

function handle(ev: KernelEvent): void {
  const wb = ev.workbenchId
  if (ev.kind === 'state') {
    kernels.set(wb, { state: ev.state, detail: ev.detail ?? null })
  } else if (ev.kind === 'output') {
    const cur = live.get(wb)?.[ev.cellId] ?? { ...EMPTY, state: 'running' as const }
    setResult(wb, ev.cellId, { ...cur, state: 'running', outputs: appendOutput(cur.outputs, ev.output) })
  } else {
    const cur = live.get(wb)?.[ev.cellId] ?? EMPTY
    setResult(wb, ev.cellId, { ...cur, state: ev.ok ? 'ok' : 'error', count: ev.count || cur.count, ms: ev.ms })
    const k = key(wb, ev.cellId)
    const ws = waiters.get(k)
    waiters.delete(k)
    ws?.forEach((w) => w(ev.ok))
  }
  notify(wb)
}

function ensureStarted(): void {
  if (started) return
  started = true
  window.engram.onKernelEvent(handle)
}

export function subscribe(wb: string, fn: () => void): () => void {
  ensureStarted()
  let set = listeners.get(wb)
  if (!set) listeners.set(wb, (set = new Set()))
  set.add(fn)
  return () => set!.delete(fn)
}

/** Results recorded since the app started, for cells of this workbench. */
export function liveResults(wb: string): Record<string, CellResult> {
  return live.get(wb) ?? {}
}

export function kernelStatus(wb: string): { state: KernelState; detail: string | null } | null {
  return kernels.get(wb) ?? null
}

export function isRunning(wb: string, cellId: string): boolean {
  return waiters.has(key(wb, cellId))
}

/** Sends a cell to its kernel; resolves with whether it ran clean. */
export function runCellCode(wb: string, cellId: string, code: string): Promise<boolean> {
  ensureStarted()
  const prev = live.get(wb)?.[cellId]
  setResult(wb, cellId, { state: 'running', outputs: [], count: prev?.count ?? null, ms: null })
  notify(wb)
  const k = key(wb, cellId)
  const done = new Promise<boolean>((resolve) => {
    waiters.set(k, [...(waiters.get(k) ?? []), resolve])
  })
  window.engram.kernelRun(wb, cellId, code).catch((e: Error) => {
    setResult(wb, cellId, {
      state: 'error',
      outputs: [{ type: 'error', ename: 'Error', evalue: e.message, traceback: [], line: null }],
      count: null,
      ms: null,
    })
    const ws = waiters.get(k)
    waiters.delete(k)
    ws?.forEach((w) => w(false))
    notify(wb)
  })
  return done
}

/** Forgets a deleted cell's live result. */
export function dropResult(wb: string, cellId: string): void {
  const r = live.get(wb)
  if (r && cellId in r) {
    const { [cellId]: _gone, ...rest } = r
    live.set(wb, rest)
  }
}
