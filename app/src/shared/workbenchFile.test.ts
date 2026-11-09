import { describe, expect, it } from 'vitest'
import { parseCells, serializeCells } from './workbenchFile'
import type { WorkbenchCell } from './runtime'

function ids() {
  let n = 0
  return () => `n${++n}`
}

describe('workbench percent-format file', () => {
  const cells: WorkbenchCell[] = [
    { id: 'c1', kind: 'given', source: 'import stim\nimport numpy as np' },
    { id: 'c2', kind: 'code', source: 'def f(d):\n\n    return d + 1\n\nf(3)' },
    { id: 'c3', kind: 'note', source: 'The crossing sits near **0.7%**.\n\nSecond paragraph, $p_{th}$.' },
  ]

  it('round-trips kinds, ids and sources, blank lines inside cells included', () => {
    expect(parseCells(serializeCells(cells), ids())).toEqual(cells)
  })

  it('writes markers Jupytext and VS Code recognise', () => {
    const text = serializeCells(cells)
    expect(text).toContain('# %% [given] id=c1\n')
    expect(text).toContain('# %% id=c2\n')
    expect(text).toContain('# %% [markdown] id=c3\n# The crossing')
    expect(text).toContain('\n#\n# Second paragraph')
  })

  it('reads a plain percent file with no ids, and keeps text before the first marker', () => {
    const parsed = parseCells('x = 1\n\n# %%\ny = 2\n# %% [markdown]\n# hello\n', ids())
    expect(parsed).toEqual([
      { id: 'n1', kind: 'code', source: 'x = 1' },
      { id: 'n2', kind: 'code', source: 'y = 2' },
      { id: 'n3', kind: 'note', source: 'hello' },
    ])
  })

  it('re-ids a duplicated id instead of merging two cells', () => {
    const parsed = parseCells('# %% id=a\n1\n# %% id=a\n2\n', ids())
    expect(parsed.map((c) => c.id)).toEqual(['a', 'n1'])
  })

  it('handles CRLF line endings', () => {
    expect(parseCells('# %% id=a\r\nx = 1\r\n', ids())).toEqual([{ id: 'a', kind: 'code', source: 'x = 1' }])
  })

  it('escapes body lines that look like cell markers, so they round-trip', () => {
    const tricky: WorkbenchCell[] = [
      { id: 'a', kind: 'code', source: 'x = 1\n# %%\n# %% [markdown] id=zz\n# # %% already escaped-looking\ny = 2' },
      { id: 'b', kind: 'note', source: '%%\n%% id=c9\n# %% heading-ish\nplain' },
      { id: 'c', kind: 'code', source: 's = \"\"\"\n# %% [markdown]\n\"\"\"' },
    ]
    const text = serializeCells(tricky)
    expect(text.split('\n').filter((l) => /^# %%/.test(l))).toHaveLength(3)
    expect(parseCells(text, ids())).toEqual(tricky)
  })
})
