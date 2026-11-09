/**
 * The code runtime's wire types, shared by main, preload and renderer.
 *
 * The runtime is an app-managed Python environment (built by uv from a pinned
 * lockfile) plus a small notebook kernel. None of it is learning state: it
 * lives in app userData, and nothing here reads or writes the learning home.
 * See docs/code-runtime.md.
 */

/**
 * One installable set of packages, pinned by a lockfile. The base layer ships
 * with the app; a content pack can bring its own (see docs/content-packs.md).
 * Each layer is its own venv, built beside the others under one uv.
 */
export interface RuntimeLayerInfo {
  id: string
  label: string
  description: string
  /** 'app' for the base layer, otherwise the content pack's id. */
  source: string
  /** A human name for the source: "Engram" or the pack's title. */
  sourceTitle: string
  /** First 12 hex of the current lockfile's SHA-256; also names the env directory. */
  lockHash: string
  state: RuntimeState
  /** The packages worth showing, with the versions installed (empty until ready). */
  packages: Record<string, string>
  /** Distribution names to list in Settings, in order. */
  watch: string[]
  pythonVersion: string | null
  envDir: string | null
  /** The lockfile changed since the env was built. The old env keeps serving
   * cells until the learner installs the update. */
  updateAvailable: boolean
  /** Plain-language reason, when state is 'failed'. */
  error: string | null
}

export type RuntimeState = 'missing' | 'installing' | 'ready' | 'failed'

/** The whole runtime. The top-level fields describe the base layer, which
 * every workbench without a pack runs on. */
export interface RuntimeStatus {
  state: RuntimeState
  /** Path of the uv binary in use, if one was found or installed. */
  uvPath: string | null
  uvVersion: string | null
  /** The base environment's interpreter, once built. */
  pythonPath: string | null
  pythonVersion: string | null
  envDir: string | null
  layers: RuntimeLayerInfo[]
  /** Versions of the base layer's packages, keyed by distribution name. */
  packages: Record<string, string>
  /** Plain-language reason, when state is 'failed'. */
  error: string | null
  updateAvailable: boolean
  /** False on a machine the runtime has no builds for. */
  supported: boolean
  /** The layer being built right now, if any. One install runs at a time. */
  installing: string | null
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
  | {
      type: 'error'
      ename: string
      evalue: string
      traceback: string[]
      line: number | null
    }

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
  | {
      kind: 'done'
      workbenchId: string
      cellId: string
      ok: boolean
      ms: number
      count: number
    }

export interface KernelVar {
  name: string
  type: string
  repr: string
}

/** Cell time limits offered in Settings, in seconds; 0 means no limit. */
export const CELL_LIMIT_CHOICES = [60, 120, 600, 0] as const
export const DEFAULT_CELL_LIMIT_S = 120

const SLUG = '[a-z0-9][a-z0-9-]{0,63}'
const PLAIN_ID = new RegExp(`^${SLUG}$`)
const LAB_ID = new RegExp(`^(${SLUG})/(${SLUG})$`)

/** A slug for a pack, a lab, a milestone or a free-standing workbench. */
export function isValidSlug(id: string): boolean {
  return PLAIN_ID.test(id)
}

/**
 * Workbench ids come in two forms. A plain slug is a free-standing workbench
 * (labs/workbenches/<id>); "<pack>/<lab>" is the learner's copy of a pack's
 * lab (labs/packs/<pack>/<lab>). Ids are re-validated wherever they become a path.
 */
export function isValidWorkbenchId(id: string): boolean {
  return PLAIN_ID.test(id) || LAB_ID.test(id)
}

export function labWorkbenchId(packId: string, labId: string): string {
  return `${packId}/${labId}`
}

/** The pack and lab of a lab workbench id, or null for a free-standing one. */
export function parseLabWorkbenchId(id: string): { packId: string; labId: string } | null {
  const m = LAB_ID.exec(id)
  return m ? { packId: m[1], labId: m[2] } : null
}
