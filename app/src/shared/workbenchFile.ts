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

const KIND_TAG: Record<CellKind, string> = { given: ' [given]', code: '', note: ' [markdown]' }

export function serializeCells(cells: WorkbenchCell[]): string {
  const parts = cells.map((c) => {
    const header = `# %%${KIND_TAG[c.kind]} id=${c.id}`
    const body =
      c.kind === 'note'
        ? c.source
            .split('\n')
            .map((l) => (l.length ? `# ${l}` : '#'))
            .join('\n')
        : c.source
    return `${header}\n${body.replace(/\s+$/, '')}\n`
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
    let body = current.lines
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
