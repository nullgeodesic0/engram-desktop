import { describe, it, expect } from 'vitest'
import { scanLatex, pairAtCaret, describeScan } from './latexSyntax'

const at = (src: string, text: string) => src.indexOf(text)

describe('scanLatex — math spans', () => {
  it('pairs inline and display delimiters', () => {
    const r = scanLatex('a $x$ b $$y$$ c')
    expect(r.mathSpans).toBe(2)
    expect(r.problems).toEqual([])
    expect(r.tokens.map((t) => t.text)).toEqual(['$', '$', '$$', '$$'])
    expect(r.tokens[0].partner).toBe(1)
    expect(r.tokens[2].partner).toBe(3)
  })

  it('flags an unterminated span at its opener, not at the end', () => {
    const r = scanLatex('the value $x = 1 and more prose')
    expect(r.mathSpans).toBe(0)
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0].at).toBe(at('the value $x = 1 and more prose', '$'))
    expect(r.problems[0].message).toContain('never closed')
  })

  it('catches a $$ closing a $ span — the silent killer', () => {
    const r = scanLatex('$x$$')
    expect(r.problems.some((p) => p.message.includes('closing a `$` span'))).toBe(true)
  })

  it('ignores an escaped dollar', () => {
    const r = scanLatex('costs \\$5 and \\$6')
    expect(r.tokens).toEqual([])
    expect(r.problems).toEqual([])
  })
})

describe('scanLatex — groups are math-scoped', () => {
  it('ignores parentheses in prose', () => {
    const r = scanLatex('a normal sentence (with an aside) and [brackets]')
    expect(r.tokens).toEqual([])
    expect(r.problems).toEqual([])
  })

  it('tokenises groups inside math', () => {
    const r = scanLatex('$f(x)$')
    expect(r.tokens.map((t) => t.text)).toEqual(['$', '(', ')', '$'])
    expect(r.problems).toEqual([])
  })

  it('assigns nesting depth for colour cycling', () => {
    const r = scanLatex('$\\frac{a}{b(c[d])}$')
    const depths = Object.fromEntries(r.tokens.filter((t) => t.open).map((t) => [t.text + t.start, t.depth]))
    // math is 0; each nested group one deeper
    expect(r.tokens[0].depth).toBe(0)
    expect(Math.max(...Object.values(depths))).toBeGreaterThanOrEqual(3)
    expect(r.problems).toEqual([])
  })

  it('flags a closer with nothing open', () => {
    const r = scanLatex('$a)$')
    expect(r.problems[0].message).toContain('nothing open')
  })

  it('flags a mismatched family', () => {
    const r = scanLatex('$(a]$')
    expect(r.problems.some((p) => p.message.includes('closing a'))).toBe(true)
  })

  it('reports a group left open when the span ends', () => {
    const r = scanLatex('$\\frac{a$ then prose')
    expect(r.problems.some((p) => p.message.includes('never closed'))).toBe(true)
  })
})

describe('scanLatex — \\left and \\right', () => {
  it('pairs sized delimiters and includes the word in the token', () => {
    const r = scanLatex('$\\left( x \\right)$')
    const sized = r.tokens.filter((t) => t.sized)
    expect(sized.map((t) => t.text)).toEqual(['\\left(', '\\right)'])
    expect(sized[0].partner).toBe(r.tokens.indexOf(sized[1]))
    expect(r.problems).toEqual([])
  })

  it('does NOT read \\leftarrow as \\left + arrow', () => {
    const r = scanLatex('$a \\leftarrow b$')
    expect(r.tokens.filter((t) => t.sized)).toEqual([])
    expect(r.problems).toEqual([])
  })

  it('handles escaped brace targets and the null delimiter', () => {
    expect(scanLatex('$\\left\\{ x \\right\\}$').problems).toEqual([])
    expect(scanLatex('$\\left. x \\right)$').problems).toEqual([])
  })

  it('allows whitespace between the word and its target', () => {
    const r = scanLatex('$\\left ( x \\right )$')
    expect(r.tokens.filter((t) => t.sized).map((t) => t.text)).toEqual(['\\left (', '\\right )'])
  })

  it('flags a \\right with no \\left', () => {
    const r = scanLatex('$x \\right)$')
    expect(r.problems.some((p) => p.message.includes('no `\\left`'))).toBe(true)
  })

  it('flags \\right closing a plain opener', () => {
    const r = scanLatex('$( x \\right)$')
    expect(r.problems.some((p) => p.message.includes('plain opener'))).toBe(true)
  })
})

describe('scanLatex — control sequences are opaque', () => {
  it('never scans inside a command name', () => {
    // `\{` inside `\text{...}` still counts, but the command word itself is
    // consumed whole — no phantom tokens from its letters.
    const r = scanLatex('$\\alpha \\beta \\Omega$')
    expect(r.tokens.map((t) => t.text)).toEqual(['$', '$'])
  })

  it('treats \\{ and \\} as escaped literals, not a pair', () => {
    // In TeX these print brace GLYPHS; they do not open or close a group.
    const r = scanLatex('$\\{ a \\}$')
    expect(r.tokens.filter((t) => t.family === 'brace')).toEqual([])
    expect(r.problems).toEqual([])
  })

  it('never pairs a real group opener with a literal \\}', () => {
    // `${a\}$` is an unclosed group NEXT TO a literal brace — not a match.
    const r = scanLatex('${a\\}$')
    expect(r.problems.some((p) => p.message.includes('never closed'))).toBe(true)
  })

  it('still pairs \\left\\{ with \\right\\}', () => {
    // The carve-out: sized delimiters are read off `\left`, never off `\{`.
    const r = scanLatex('$\\left\\{ a \\right\\}$')
    const sized = r.tokens.filter((t) => t.sized)
    expect(sized.map((t) => t.text)).toEqual(['\\left\\{', '\\right\\}'])
    expect(sized[0].partner).not.toBeNull()
    expect(r.problems).toEqual([])
  })
})

describe('scanLatex — real expressions from this app', () => {
  const cases = [
    '$\\oint \\vec E\\cdot d\\vec a = 4\\pi r^2 E(r) = \\frac{Q_{\\text{enc}}(r)}{\\epsilon_0}$',
    '$$\\Omega(E) = \\frac{1}{h^{3N}N!}\\int d^{3N}q\\,d^{3N}p$$',
    'For $r<a$ we get $E_{\\text{in}}(r)=\\frac{Ar^2}{4\\epsilon_0}$ (SI).',
    '$$Z=\\sum_i e^{-\\beta E_i}$$ where $\\beta = 1/k_BT$.',
  ]
  it('finds no problems in well-formed expressions', () => {
    for (const c of cases) {
      expect(scanLatex(c).problems, c).toEqual([])
    }
  })
})

describe('pairAtCaret', () => {
  const src = '$f(x)$'
  const r = scanLatex(src)

  it('matches on either side of a delimiter', () => {
    // caret just after the '('
    expect(pairAtCaret(r.tokens, at(src, '(') + 1)).toEqual({ a: 1, b: 2 })
    // caret just before the ')'
    expect(pairAtCaret(r.tokens, at(src, ')'))).toEqual({ a: 2, b: 1 })
  })

  it('returns null away from any delimiter', () => {
    // `$f(x)$` is too tight to test this — every caret in it is adjacent to
    // something. Needs a token with real interior.
    const wide = scanLatex('$abc$')
    expect(pairAtCaret(wide.tokens, 2)).toBeNull()
    expect(pairAtCaret(wide.tokens, 3)).toBeNull()
  })

  it('points an unmatched delimiter at itself', () => {
    const u = scanLatex('$a(b$')
    const idx = u.tokens.findIndex((t) => t.text === '(')
    expect(pairAtCaret(u.tokens, u.tokens[idx].end)).toEqual({ a: idx, b: idx })
  })
})

describe('describeScan', () => {
  it('says nothing when there is no math at all', () => {
    expect(describeScan(scanLatex('just prose'))).toBeNull()
  })

  it('confirms balance', () => {
    expect(describeScan(scanLatex('$x$'))).toBe('1 math span · balanced')
    expect(describeScan(scanLatex('$x$ $y$'))).toBe('2 math spans · balanced')
  })

  it('names the first problem and counts the rest', () => {
    const d = describeScan(scanLatex('$a( b] $'))
    expect(d).toContain('closing a')
  })
})
