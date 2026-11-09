import { describe, expect, it } from 'vitest'
import { commandFor, definedNames, outlineOf } from './notebook'

const cell = (kind: 'code' | 'note' | 'given', source: string, id = source.slice(0, 6)) => ({ id, kind, source })

describe('notebook helpers', () => {
  it('outlines note headings and top-level defs, skipping fenced code', () => {
    const o = outlineOf([
      cell('note', '# Setup\nText\n```\n# not a heading\n```\n## Data', 'n1'),
      cell('code', 'def fit(x):\n    def inner(): pass\nclass Model:\n    pass', 'c1'),
    ])
    expect(o.map((e) => [e.level, e.text, e.kind])).toEqual([
      [1, 'Setup', 'heading'],
      [2, 'Data', 'heading'],
      [4, 'fit', 'def'],
      [4, 'Model', 'class'],
    ])
  })

  it('finds the names cells define', () => {
    const n = definedNames([
      cell('given', 'import numpy as np\nfrom scipy import linalg, optimize as opt\nx, y = 1, 2\nN: int = 4'),
      cell('code', 'def fit(): pass\nclass M: pass\nif x == 1: pass'),
    ])
    expect(n).toEqual([
      { label: 'np', type: 'module' },
      { label: 'linalg', type: 'module' },
      { label: 'opt', type: 'module' },
      { label: 'x', type: 'variable' },
      { label: 'y', type: 'variable' },
      { label: 'N', type: 'variable' },
      { label: 'fit', type: 'function' },
      { label: 'M', type: 'class' },
    ])
  })

  it('maps command-mode keys, doubling D, I and 0', () => {
    const k = (key: string, o: Partial<{ shift: boolean; mod: boolean; alt: boolean }> = {}) => ({
      key,
      shift: false,
      mod: false,
      alt: false,
      ...o,
    })
    expect(commandFor(k('j'), null, 0)).toBe('down')
    expect(commandFor(k('Enter', { shift: true }), null, 0)).toBe('runAdvance')
    expect(commandFor(k('d'), null, 0)).toBeNull()
    expect(commandFor(k('d'), { key: 'd', at: 100 }, 500)).toBe('delete')
    expect(commandFor(k('d'), { key: 'd', at: 100 }, 1000)).toBeNull()
    expect(commandFor(k('ArrowUp', { alt: true }), null, 0)).toBe('moveUp')
    expect(commandFor(k('c', { mod: true }), null, 0)).toBeNull()
    expect(commandFor(k('V'), null, 0)).toBe('pasteAbove')
  })
})
