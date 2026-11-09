/**
 * The code runtime's wire types, shared by main, preload and renderer.
 *
 * The runtime is an app-managed Python environment (built by uv from a pinned
 * lockfile) plus a small notebook kernel. None of it is learning state: it
 * lives in app userData, and nothing here reads or writes the learning home.
 * See docs/code-runtime.md.
 */

/** One installable set of packages, pinned by a lockfile that ships with the app. */
export interface RuntimeLayerInfo {
  id: string
  label: string
  description: string
  /** First 12 hex of the lockfile's SHA-256; also names the env directory. */
  lockHash: string
  installed: boolean
}

export type RuntimeState = 'missing' | 'installing' | 'ready' | 'failed'

export interface RuntimeStatus {
  state: RuntimeState
  /** Path of the uv binary in use, if one was found or installed. */
  uvPath: string | null
  uvVersion: string | null
  /** The environment's interpreter, once built. */
  pythonPath: string | null
  pythonVersion: string | null
  envDir: string | null
  layers: RuntimeLayerInfo[]
  /** Versions of the packages the kernel reports, keyed by distribution name. */
  packages: Record<string, string>
  /** Plain-language reason, when state is 'failed'. */
  error: string | null
}

export interface RuntimeProgress {
  phase: 'uv' | 'python' | 'venv' | 'packages' | 'verify' | 'done' | 'failed'
  /** One human line, e.g. "Downloading uv 0.11.32". */
  message: string
  /** 0–1 when the phase can measure itself, otherwise null. */
  fraction: number | null
}

// ---------------------------------------------------------------------------
// Workbench cells
// ---------------------------------------------------------------------------

/** given = scaffolding from a pack, read-only; code = the learner's; note = Markdown scratch. */
export type CellKind = 'given' | 'code' | 'note'

export interface WorkbenchCell {
  id: string
  kind: CellKind
  source: string
}

export type CellOutput =
  | { type: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | { type: 'value'; text: string }
  | { type: 'figure'; svg: string; png: string }
  | { type: 'error'; ename: string; evalue: string; traceback: string[]; line: number | null }

export type CellRunState = 'idle' | 'queued' | 'running' | 'ok' | 'error'

export interface CellResult {
  state: CellRunState
  outputs: CellOutput[]
  /** Execution counter shown in the gutter, like a notebook's [n]. */
  count: number | null
  ms: number | null
}

export interface WorkbenchDoc {
  id: string
  title: string
  cells: WorkbenchCell[]
  /** Last outputs per cell id, so a reopened workbench shows what it last showed. */
  results: Record<string, CellResult>
  updatedAt: string
}

export interface WorkbenchSummary {
  id: string
  title: string
  cellCount: number
  updatedAt: string
}

export type KernelState = 'starting' | 'idle' | 'busy' | 'dead'

/** Pushed from main to the renderer for every kernel message. */
export type KernelEvent =
  | { kind: 'state'; workbenchId: string; state: KernelState; detail?: string }
  | { kind: 'output'; workbenchId: string; cellId: string; output: CellOutput }
  | { kind: 'done'; workbenchId: string; cellId: string; ok: boolean; ms: number; count: number }

export interface KernelVar {
  name: string
  type: string
  repr: string
}

/** Cell time limits offered in Settings, in seconds; 0 means no limit. */
export const CELL_LIMIT_CHOICES = [60, 120, 600, 0] as const
export const DEFAULT_CELL_LIMIT_S = 120

/** Ids are re-validated wherever they become a path. */
export function isValidWorkbenchId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
}
