import type { CellKind, WorkbenchCell } from './runtime'

/**
 * A workbench on disk is a plain Python file in the "percent" cell format
 * that Jupytext, VS Code and Spyder all read:
 *
 *     # %% [given] id=c1
 *     import stim
 *
 *     # %% id=c2
 *     circuit = stim.Circuit.generated(...)
 *
 *     # %% [markdown] id=c3
 *     # The crossing sits near 0.7%.
 *
 * So `python lab.py` runs the learner's work outside the app, and the file
 * diffs cleanly in git. Markdown cells are stored as `# `-prefixed comment
 * lines, as Jupytext does. The `id=` tag is Engram's own and keeps a cell's
 * last outputs attached to it across saves.
 */

const HEADER = /^# %%(?:\s+\[(given|markdown)\])?(?:\s+id=([A-Za-z0-9_-]+))?\s*$/

/**
 * A body line that would read back as a cell marker is escaped with one more
 * `# ` in front: `# %%` is written `# # %%`, `# # %%` is written `# # # %%`,
 * and so on. Reading strips exactly one. The map is one-to-one on the lines
 * it touches, so every cell round-trips, including a note whose line is `%%`
 * and code that prints a percent-format file of its own.
 */
const MARKER_LIKE = /^(# )+%%/
const ESCAPED = /^# (# )+%%/

function escapeLine(line: string): string {
  return MARKER_LIKE.test(line) ? `# ${line}` : line
}

function unescapeLine(line: string): string {
  return ESCAPED.test(line) ? line.slice(2) : line
}

const KIND_TAG: Record<CellKind, string> = { given: ' [given]', code: '', note: ' [markdown]' }

export function serializeCells(cells: WorkbenchCell[]): string {
  const parts = cells.map((c) => {
    const header = `# %%${KIND_TAG[c.kind]} id=${c.id}`
    const lines = c.source.replace(/\s+$/, '').split('\n')
    const body = (c.kind === 'note' ? lines.map((l) => (l.length ? `# ${l}` : '#')) : lines).map(escapeLine).join('\n')
    return `${header}\n${body}\n`
  })
  return parts.join('\n')
}

export function parseCells(text: string, newId: () => string): WorkbenchCell[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const cells: WorkbenchCell[] = []
  let current: { kind: CellKind; id: string; lines: string[] } | null = null
  const seen = new Set<string>()

  const flush = () => {
    if (!current) return
    let body = current.lines.map(unescapeLine)
    while (body.length && body[body.length - 1].trim() === '') body = body.slice(0, -1)
    const source =
      current.kind === 'note' ? body.map((l) => (l.startsWith('# ') ? l.slice(2) : l === '#' ? '' : l)).join('\n') : body.join('\n')
    cells.push({ id: current.id, kind: current.kind, source })
  }

  for (const line of lines) {
    const m = HEADER.exec(line)
    if (m) {
      flush()
      const kind: CellKind = m[1] === 'given' ? 'given' : m[1] === 'markdown' ? 'note' : 'code'
      let id = m[2] ?? newId()
      if (seen.has(id)) id = newId()
      seen.add(id)
      current = { kind, id, lines: [] }
      continue
    }
    if (!current) {
      // Text before the first marker: keep it as a code cell rather than drop it.
      if (line.trim() === '') continue
      const id = newId()
      seen.add(id)
      current = { kind: 'code', id, lines: [] }
    }
    current.lines.push(line)
  }
  flush()
  return cells
}
