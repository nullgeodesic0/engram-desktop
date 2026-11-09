import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CellResult, WorkbenchCell, WorkbenchDoc, WorkbenchSummary } from '../../shared/runtime'
import { isValidWorkbenchId, parseLabWorkbenchId } from '../../shared/runtime'
import { parseCells, serializeCells } from '../../shared/workbenchFile'

/**
 * Workbenches on disk, in app userData:
 *
 *     labs/workbenches/<id>/lab.py        the cells, in the percent format (see shared/workbenchFile.ts)
 *     labs/workbenches/<id>/meta.json     title and updatedAt
 *     labs/workbenches/<id>/results.json  each cell's last outputs, so a reopened workbench shows them
 *
 * A content pack's lab is a workbench too, with the id "<pack>/<lab>", kept
 * in labs/packs/<pack>/<lab>/ with the same three files (main/labs/labStore.ts
 * seeds it from the pack's starter and adds its submissions beside them).
 *
 * The folder is also the kernel's working directory, so a file the learner's
 * code saves lands beside lab.py. This is the learner's own work, not
 * learning state: no rating, receipt or schedule reads it. Pinned under D2.
 */

export const SCRATCH_ID = 'scratch'
/** Figures dominate results.json; past this size their SVG copies are dropped (the PNG stays). */
const MAX_RESULTS_BYTES = 8 * 1024 * 1024

export function workbenchRoot(): string {
  return join(app.getPath('userData'), 'labs', 'workbenches')
}

export function workbenchDir(id: string): string {
  if (!isValidWorkbenchId(id)) throw new Error(`Invalid workbench id: ${id}`)
  const lab = parseLabWorkbenchId(id)
  return lab ? join(app.getPath('userData'), 'labs', 'packs', lab.packId, lab.labId) : join(workbenchRoot(), id)
}

export function newCellId(): string {
  return 'c' + randomBytes(4).toString('hex')
}

async function writeAtomic(path: string, text: string): Promise<void> {
  // A unique temp name: two saves in flight must not rename each other's file.
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, text, 'utf-8')
  await rename(tmp, path)
}

interface Meta {
  title: string
  updatedAt: string
}

async function readMeta(id: string): Promise<Meta | null> {
  try {
    const m = JSON.parse(await readFile(join(workbenchDir(id), 'meta.json'), 'utf-8')) as Partial<Meta>
    return {
      title: typeof m.title === 'string' ? m.title : id,
      updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : '',
    }
  } catch {
    return null
  }
}

const SCRATCH_CELLS = (): WorkbenchCell[] => [
  {
    id: newCellId(),
    kind: 'note',
    source:
      'A scratch workbench. Cells run in one Python process, top to bottom or one at a time; **Shift+Enter** runs a cell.',
  },
  {
    id: newCellId(),
    kind: 'code',
    source: 'import numpy as np\n\nrng = np.random.default_rng(7)\nflips = rng.random(10_000) < 0.1\nflips.mean()',
  },
]

export async function seedWorkbench(id: string, title: string, cells: WorkbenchCell[]): Promise<WorkbenchDoc> {
  const dir = workbenchDir(id)
  await mkdir(dir, { recursive: true })
  const updatedAt = new Date().toISOString()
  await writeAtomic(join(dir, 'lab.py'), serializeCells(cells))
  await writeAtomic(join(dir, 'meta.json'), JSON.stringify({ title, updatedAt }, null, 2))
  return { id, title, cells, results: {}, updatedAt }
}

export async function listWorkbenches(): Promise<WorkbenchSummary[]> {
  let names: string[] = []
  try {
    names = (await readdir(workbenchRoot(), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  const out: WorkbenchSummary[] = []
  for (const id of names) {
    // Only free-standing workbenches live here; pack labs are listed with their pack.
    if (!isValidWorkbenchId(id) || parseLabWorkbenchId(id)) continue
    const meta = await readMeta(id)
    if (!meta) continue
    let cellCount = 0
    try {
      cellCount = parseCells(await readFile(join(workbenchDir(id), 'lab.py'), 'utf-8'), newCellId).length
    } catch {
      // A missing lab.py reads as an empty workbench.
    }
    out.push({ id, title: meta.title, cellCount, updatedAt: meta.updatedAt })
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Opens a workbench. The scratch workbench is created on first open. */
export async function openWorkbench(id: string): Promise<WorkbenchDoc> {
  const dir = workbenchDir(id)
  const meta = await readMeta(id)
  if (!meta) {
    if (id === SCRATCH_ID) return seedWorkbench(SCRATCH_ID, 'Scratch', SCRATCH_CELLS())
    throw new Error(`No workbench named ${id}`)
  }
  let cells: WorkbenchCell[] = []
  try {
    cells = parseCells(await readFile(join(dir, 'lab.py'), 'utf-8'), newCellId)
  } catch {
    cells = []
  }
  if (cells.length === 0) cells = [{ id: newCellId(), kind: 'code', source: '' }]
  let results: Record<string, CellResult> = {}
  try {
    const raw = JSON.parse(await readFile(join(dir, 'results.json'), 'utf-8'))
    if (raw && typeof raw === 'object') results = raw as Record<string, CellResult>
  } catch {
    results = {}
  }
  // Results for cells that no longer exist are dropped, and nothing reopens as still running.
  const live = new Set(cells.map((c) => c.id))
  const kept: Record<string, CellResult> = {}
  for (const [cellId, r] of Object.entries(results)) {
    if (!live.has(cellId)) continue
    kept[cellId] = r.state === 'running' || r.state === 'queued' ? { ...r, state: 'idle' } : r
  }
  return {
    id,
    title: meta.title,
    cells,
    results: kept,
    updatedAt: meta.updatedAt,
  }
}

function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return s || 'workbench'
}

export async function createWorkbench(title: string): Promise<WorkbenchDoc> {
  const clean = title.trim().slice(0, 120) || 'Untitled workbench'
  const base = slugify(clean)
  const existing = new Set((await listWorkbenches()).map((w) => w.id))
  let id = base
  for (let n = 2; existing.has(id) || id === SCRATCH_ID; n++) id = `${base}-${n}`
  return seedWorkbench(id, clean, [{ id: newCellId(), kind: 'code', source: '' }])
}

function capResults(results: Record<string, CellResult>): Record<string, CellResult> {
  if (JSON.stringify(results).length <= MAX_RESULTS_BYTES) return results
  const out: Record<string, CellResult> = {}
  for (const [k, r] of Object.entries(results)) {
    out[k] = {
      ...r,
      outputs: r.outputs.map((o) => (o.type === 'figure' ? { ...o, svg: '' } : o)),
    }
  }
  return out
}

const CELL_ID = /^[A-Za-z0-9_-]{1,64}$/
const KINDS = new Set(['given', 'code', 'note'])

/** The renderer is trusted, but what reaches lab.py is checked anyway: a
 * malformed id or kind would corrupt the file's cell markers. */
function validCells(cells: unknown): WorkbenchCell[] {
  if (!Array.isArray(cells)) throw new Error('cells must be a list')
  return cells.map((c) => {
    const cell = c as Partial<WorkbenchCell>
    if (typeof cell.id !== 'string' || !CELL_ID.test(cell.id)) throw new Error('invalid cell id')
    if (typeof cell.kind !== 'string' || !KINDS.has(cell.kind)) throw new Error('invalid cell kind')
    if (typeof cell.source !== 'string') throw new Error('invalid cell source')
    return { id: cell.id, kind: cell.kind, source: cell.source }
  })
}

export async function saveWorkbench(
  id: string,
  doc: {
    title: string
    cells: WorkbenchCell[]
    results: Record<string, CellResult>
  },
): Promise<string> {
  const dir = workbenchDir(id)
  const cells = validCells(doc.cells)
  const results = doc.results && typeof doc.results === 'object' ? doc.results : {}
  await mkdir(dir, { recursive: true })
  const updatedAt = new Date().toISOString()
  await writeAtomic(join(dir, 'lab.py'), serializeCells(cells))
  await writeAtomic(join(dir, 'results.json'), JSON.stringify(capResults(results)))
  const title = typeof doc.title === 'string' ? doc.title.trim().slice(0, 120) : ''
  await writeAtomic(join(dir, 'meta.json'), JSON.stringify({ title: title || id, updatedAt }, null, 2))
  return updatedAt
}
