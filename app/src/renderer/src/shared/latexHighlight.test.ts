import { describe, it, expect } from 'vitest'
import { highlightLatexSymbol } from './latexHighlight'

const C = '#e8a857'
const wrap = (s: string) => `{\\textcolor{${C}}{${s}}}`

describe('highlightLatexSymbol — control sequences', () => {
  it('tints every occurrence of a command', () => {
    expect(highlightLatexSymbol('Z = \\sum e^{-\\beta E}, \\beta > 0', '\\beta', C)).toBe(
      `Z = \\sum e^{-${wrap('\\beta')} E}, ${wrap('\\beta')} > 0`,
    )
  })

  it('does not match a longer command that starts with the same letters', () => {
    // `\be` must not fire inside `\beta`.
    expect(highlightLatexSymbol('\\beta + \\be', '\\be', C)).toBe(`\\beta + ${wrap('\\be')}`)
  })
})

describe('highlightLatexSymbol — bare identifiers', () => {
  it('tints a standalone letter', () => {
    expect(highlightLatexSymbol('E = mc^2', 'E', C)).toBe(`${wrap('E')} = mc^2`)
  })

  it('never matches inside a control sequence', () => {
    // The regression this guard exists for: a naive replace produces
    // `\textcolor{..}{E}psilon`, which is a different expression.
    expect(highlightLatexSymbol('\\Epsilon + \\exp(E)', 'E', C)).toBe(`\\Epsilon + \\exp(${wrap('E')})`)
  })

  it('never matches inside a word', () => {
    expect(highlightLatexSymbol('Q_{\\text{Enc}} + E', 'E', C)).toBe(`Q_{\\text{Enc}} + ${wrap('E')}`)
  })

  it('allows a preceding digit or operator', () => {
    expect(highlightLatexSymbol('2E + 3E', 'E', C)).toBe(`2${wrap('E')} + 3${wrap('E')}`)
  })

  it('handles a subscripted identifier', () => {
    expect(highlightLatexSymbol('k_B T', 'k_B', C)).toBe(`${wrap('k_B')} T`)
  })
})

describe('highlightLatexSymbol — declines rather than guesses', () => {
  it('leaves the source alone when the symbol is absent', () => {
    const src = 'E = mc^2'
    expect(highlightLatexSymbol(src, '\\mu', C)).toBe(src)
  })

  it('leaves the source alone for an unanchorable symbol', () => {
    const src = 'a + b'
    for (const sym of ['', '   ', '\\', '{', '_']) {
      expect(highlightLatexSymbol(src, sym, C)).toBe(src)
    }
  })

  it('leaves the source alone when the symbol saturates the expression', () => {
    // 13 occurrences — tinting all of them says nothing.
    const src = Array.from({ length: 13 }, () => 'x').join(' + ')
    expect(highlightLatexSymbol(src, 'x', C)).toBe(src)
    // 12 is still a legitimate pointing gesture.
    const twelve = Array.from({ length: 12 }, () => 'x').join(' + ')
    expect(highlightLatexSymbol(twelve, 'x', C)).toContain('\\textcolor')
  })

  it('rejects a colour KaTeX would not accept', () => {
    const src = 'E = mc^2'
    for (const bad of ['var(--color-ink-warm)', 'red', '#12', 'rgb(1,2,3)', '#e8a85']) {
      expect(highlightLatexSymbol(src, 'E', bad)).toBe(src)
    }
    expect(highlightLatexSymbol(src, 'E', '#fff')).toContain('\\textcolor{#fff}')
  })

  it('never throws on adversarial input', () => {
    const nasty = ['\\frac{1}{2}', '(((', '$$$', '\\begin{pmatrix}a\\end{pmatrix}', 'a'.repeat(5000)]
    for (const s of nasty) for (const sym of nasty) {
      expect(() => highlightLatexSymbol(s, sym, C)).not.toThrow()
    }
  })
})

describe('highlightLatexSymbol — the KaTeX-red regressions', () => {
  // The real renderer, so these assert against the same parser the card uses.
  const katexValid = (tex: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const katex = require('katex')
    try {
      katex.renderToString(tex, { throwOnError: true, displayMode: true })
      return true
    } catch {
      return false
    }
  }

  it('braces the replacement so a superscript position still parses', () => {
    // `x^\textcolor{..}{N}` is "Got function '\textcolor' with no arguments".
    const out = highlightLatexSymbol('x^N + y', 'N', C, katexValid)
    expect(out).toBe(`x^${wrap('N')} + y`)
    expect(katexValid(out)).toBe(true)
  })

  it('same for a subscript position', () => {
    const out = highlightLatexSymbol('a_N', 'N', C, katexValid)
    expect(out).toBe(`a_${wrap('N')}`)
    expect(katexValid(out)).toBe(true)
  })

  it('declines entirely where no wrapper can be legal', () => {
    // An array column spec takes a literal alignment char — braces don't help.
    const src = '\\begin{array}{c} a \\\\ b \\end{array}'
    expect(highlightLatexSymbol(src, 'c', C, katexValid)).toBe(src)
  })

  it('every rewrite it DOES return parses', () => {
    const cases: [string, string][] = [
      ['x^N + y', 'N'],
      ['a_N', 'N'],
      ['e^{-\\beta E}', 'E'],
      ['\\sqrt[N]{x}', 'N'],
      ['\\frac{Q}{4\\pi\\epsilon_0 r^2}', 'Q'],
      ['\\begin{array}{c} a \\\\ b \\end{array}', 'c'],
      ['\\oint \\vec E\\cdot d\\vec a = 4\\pi r^2 E(r)', 'E'],
      ['\\Omega(E) = \\frac{1}{h^{3N}N!}', 'N'],
    ]
    for (const [tex, sym] of cases) {
      const out = highlightLatexSymbol(tex, sym, C, katexValid)
      expect(katexValid(out), `${sym} in ${tex} -> ${out}`).toBe(true)
    }
  })

  it('falls back to the source when the validator throws', () => {
    const src = 'E = mc^2'
    expect(highlightLatexSymbol(src, 'E', C, () => { throw new Error('boom') })).toBe(src)
  })
})
