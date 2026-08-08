import { describe, it, expect } from 'vitest'
import { onInsert, onBackspace, onCompletion, countUnicodeMath, unicodeToLatex } from './latexEditing'

/** Compact fixture syntax: `|` marks the caret, `[…]` marks a selection.
 * A selection needs BOTH markers in order — otherwise `$\left[|` would read
 * its LaTeX bracket as a selection start. */
function parse(spec: string): { text: string; selStart: number; selEnd: number } {
  if (spec.includes('[') && spec.indexOf(']') > spec.indexOf('[') && !spec.includes('|')) {
    const a = spec.indexOf('[')
    const b = spec.indexOf(']')
    const text = spec.slice(0, a) + spec.slice(a + 1, b) + spec.slice(b + 1)
    return { text, selStart: a, selEnd: b - 1 }
  }
  const i = spec.indexOf('|')
  return { text: spec.slice(0, i) + spec.slice(i + 1), selStart: i, selEnd: i }
}

function show(r: { text: string; selStart: number; selEnd: number } | null): string | null {
  if (!r) return null
  if (r.selEnd > r.selStart) {
    return r.text.slice(0, r.selStart) + '[' + r.text.slice(r.selStart, r.selEnd) + ']' + r.text.slice(r.selEnd)
  }
  return r.text.slice(0, r.selStart) + '|' + r.text.slice(r.selStart)
}

describe('onInsert — wrapping a selection', () => {
  it('wraps in each pair and keeps the selection inside', () => {
    expect(show(onInsert(parse('a [x+1] b'), '('))).toBe('a ([x+1]) b')
    expect(show(onInsert(parse('a [x+1] b'), '['))).toBe('a [[x+1]] b')
    expect(show(onInsert(parse('a [x+1] b'), '{'))).toBe('a {[x+1]} b')
    expect(show(onInsert(parse('a [x+1] b'), '$'))).toBe('a $[x+1]$ b')
  })

  it('wraps a selection in a group for ^ and _', () => {
    expect(show(onInsert(parse('x[10]'), '^'))).toBe('x^{[10]}')
    expect(show(onInsert(parse('k[B]'), '_'))).toBe('k_{[B]}')
  })
})

describe('onInsert — auto-closing', () => {
  it('closes at end of input', () => {
    expect(show(onInsert(parse('$f|'), '('))).toBe('$f(|)')
  })

  it('closes before whitespace and closers, not before a letter', () => {
    expect(show(onInsert(parse('$f| x$'), '('))).toBe('$f(|) x$')
    expect(show(onInsert(parse('$f|)$'), '('))).toBe('$f(|))$')
    // Before a letter, do nothing — `(xyz` is what was meant, not `()xyz`.
    expect(onInsert(parse('$f|xyz$'), '(')).toBeNull()
  })

  it('types over a closer instead of doubling it', () => {
    expect(show(onInsert(parse('$f(x|)$'), ')'))).toBe('$f(x)|$')
  })

  it('pairs $ only when opening a span', () => {
    expect(show(onInsert(parse('prose |'), '$'))).toBe('prose $|$')
    // Already inside a span: closing by hand must not produce `$$`.
    expect(onInsert(parse('$x = 1|'), '$')).toBeNull()
  })
})

describe('onInsert — the x^10 bug', () => {
  it('always gives ^ and _ a group', () => {
    expect(show(onInsert(parse('$x|$'), '^'))).toBe('$x^{|}$')
    expect(show(onInsert(parse('$k|$'), '_'))).toBe('$k_{|}$')
  })
})

describe('onBackspace', () => {
  it('removes both halves of an empty pair', () => {
    expect(show(onBackspace(parse('$f(|)$')))).toBe('$f|$')
    expect(show(onBackspace(parse('a $|$ b')))).toBe('a | b')
  })

  it('removes a whole empty sub/superscript group', () => {
    expect(show(onBackspace(parse('$x^{|}$')))).toBe('$x|$')
    expect(show(onBackspace(parse('$k_{|}$')))).toBe('$k|$')
  })

  it('does nothing to a non-empty pair', () => {
    expect(onBackspace(parse('$f(x|)$'))).toBeNull()
  })

  it('does nothing at the start or with a selection', () => {
    expect(onBackspace(parse('|abc'))).toBeNull()
    expect(onBackspace(parse('a[bc]d'))).toBeNull()
  })
})

describe('onCompletion', () => {
  it('closes \\left with the matching \\right', () => {
    expect(show(onCompletion(parse('$\\left(|'), '('))).toBe('$\\left(| \\right)')
    expect(show(onCompletion(parse('$\\left[|'), '['))).toBe('$\\left[| \\right]')
    expect(show(onCompletion(parse('$\\left\\{|'), '{'))).toBe('$\\left\\{| \\right\\}')
  })

  it('closes an environment', () => {
    const r = onCompletion(parse('$$\\begin{pmatrix}|'), '}')
    expect(r?.text).toContain('\\end{pmatrix}')
  })

  it('leaves ordinary text alone', () => {
    expect(onCompletion(parse('just prose|'), 'e')).toBeNull()
    expect(onCompletion(parse('$\\leftarrow|'), 'w')).toBeNull()
  })
})

describe('unicode → LaTeX', () => {
  it('counts what it can convert', () => {
    expect(countUnicodeMath('plain text')).toBe(0)
    expect(countUnicodeMath('∂ψ/∂t')).toBe(3)
  })

  it('converts the characters a qual paper actually drops in', () => {
    expect(unicodeToLatex('iħ ∂ψ/∂t = Ĥψ')).toContain('\\hbar')
    expect(unicodeToLatex('iħ ∂ψ/∂t')).toContain('\\partial')
    expect(unicodeToLatex('E ≥ 0')).toBe('E \\geq 0')
    expect(unicodeToLatex('⟨ψ|φ⟩')).toBe('\\langle\\psi|\\phi\\rangle')
    expect(unicodeToLatex('α + β = Ω')).toBe('\\alpha + \\beta = \\Omega')
  })

  it('leaves text with no unicode math untouched', () => {
    const src = 'The value of $x$ is 3.'
    expect(unicodeToLatex(src)).toBe(src)
  })
})

describe('escaped braces are literals, not pairs', () => {
  it('does not auto-close an escaped brace', () => {
    // `\{` prints a brace glyph; pairing it produced `\{}`.
    expect(onInsert(parse('$a\\|'), '{')).toBeNull()
  })

  it('still auto-closes a real group opener after an escaped backslash', () => {
    // `\\{` is an escaped BACKSLASH followed by a genuine opener.
    expect(show(onInsert(parse('$a\\\\|'), '{'))).toBe('$a\\\\{|}')
  })

  it('does not delete both halves of \\{}', () => {
    expect(onBackspace(parse('$\\{|}$'))).toBeNull()
  })

  it('still deletes both halves of a real empty group', () => {
    expect(show(onBackspace(parse('$x{|}$')))).toBe('$x|$')
  })
})

describe('\\left takes its delimiter as an argument', () => {
  it('declines to auto-close, so the \\right completion can fire', () => {
    // The regression: auto-close matched `(` first and returned early, so
    // onCompletion never ran and `\left(` never wrapped.
    expect(onInsert(parse('$\\left|'), '(')).toBeNull()
    expect(onInsert(parse('$\\left|'), '[')).toBeNull()
    expect(onInsert(parse('$\\left |'), '(')).toBeNull()
  })

  it('and the completion then supplies the matching \\right', () => {
    expect(show(onCompletion(parse('$\\left(|'), '('))).toBe('$\\left(| \\right)')
  })

  it('leaves a plain ( auto-closing as before', () => {
    expect(show(onInsert(parse('$f|'), '('))).toBe('$f(|)')
  })
})
