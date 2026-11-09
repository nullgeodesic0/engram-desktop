import type { CellOutput, KernelVar } from '../../shared/runtime'

/**
 * The kernel's JSON-lines wire format (see resources/runtime/engram_kernel.py),
 * parsed without any process or Electron in sight so it can be tested alone.
 */

export type KernelMessage =
  | { type: 'ready'; python: string; packages: Record<string, string> }
  | { type: 'output'; id: number; output: CellOutput }
  | { type: 'done'; id: number; ok: boolean; ms: number }
  | { type: 'vars'; id: number; vars: KernelVar[] }
  | { type: 'pong'; id: number }
  | { type: 'protocol_error'; id: number | null; text: string }

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

export function parseKernelLine(line: string): KernelMessage | null {
  let m: Record<string, unknown>
  try {
    const v = JSON.parse(line)
    if (!v || typeof v !== 'object') return null
    m = v as Record<string, unknown>
  } catch {
    return null
  }
  const id = typeof m.id === 'number' ? m.id : null
  switch (m.type) {
    case 'ready':
      return {
        type: 'ready',
        python: str(m.python),
        packages: m.packages && typeof m.packages === 'object' ? (m.packages as Record<string, string>) : {},
      }
    case 'stream':
      if (id === null) return null
      return {
        type: 'output',
        id,
        output: { type: 'stream', name: m.name === 'stderr' ? 'stderr' : 'stdout', text: str(m.text) },
      }
    case 'value':
      if (id === null) return null
      return { type: 'output', id, output: { type: 'value', text: str(m.text) } }
    case 'figure':
      if (id === null) return null
      return { type: 'output', id, output: { type: 'figure', svg: str(m.svg), png: str(m.png) } }
    case 'error':
      if (id === null) return null
      return {
        type: 'output',
        id,
        output: {
          type: 'error',
          ename: str(m.ename, 'Error'),
          evalue: str(m.evalue),
          traceback: Array.isArray(m.traceback) ? m.traceback.map((t) => str(t)) : [],
          line: typeof m.line === 'number' ? m.line : null,
        },
      }
    case 'done':
      if (id === null) return null
      return { type: 'done', id, ok: m.ok === true, ms: typeof m.ms === 'number' ? m.ms : 0 }
    case 'vars':
      if (id === null) return null
      return { type: 'vars', id, vars: Array.isArray(m.vars) ? (m.vars as KernelVar[]) : [] }
    case 'pong':
      if (id === null) return null
      return { type: 'pong', id }
    case 'protocol_error':
      return { type: 'protocol_error', id, text: str(m.text) }
    default:
      return null
  }
}

/** Splits a byte stream into complete lines, keeping the unfinished tail. */
export class LineSplitter {
  private buf = ''
  push(chunk: string): string[] {
    this.buf += chunk
    const parts = this.buf.split('\n')
    this.buf = parts.pop() ?? ''
    return parts.filter((p) => p.trim().length > 0)
  }
}
